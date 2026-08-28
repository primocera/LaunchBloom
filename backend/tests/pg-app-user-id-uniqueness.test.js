// ---------------------------------------------------------------------------
// SV-22-01 (v22) — REAL PostgreSQL proof of the canonical billing conflict key.
//
// Defect A was: migration 039 created a PARTIAL unique index on
// customers(app_user_id) WHERE app_user_id IS NOT NULL, while the runtime upserts
// with Supabase `onConflict: 'app_user_id'` — which PostgREST emits as a plain
// `ON CONFLICT (app_user_id)` with NO predicate. PostgreSQL cannot infer a partial
// index as that statement's arbiter, so the canonical customer upsert would fail
// in production under enforcement.
//
// A mock that only asserts the onConflict string cannot catch this — the bug is in
// PostgreSQL's arbiter inference, not in our JS. So this suite runs the ACTUAL
// migration SQL (038 backfill, 039 partial index, 040 corrective non-partial index
// + probe) against a REAL embedded PostgreSQL engine (pglite, in-process, no
// service) and proves the exact ON CONFLICT behaviour PostgREST/Supabase produce.
//
// It also proves migration 038's hardened UUID cast cannot be aborted by one
// malformed Stripe metadata value.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8');

// The subset of the real `customers` table the ownership migrations touch. The
// migrations (038/039/040) ALTER/INDEX this table; they never CREATE it, so the
// test creates the minimal shape and then applies the unmodified migration SQL.
const CREATE_CUSTOMERS = `
  create table public.customers (
    id                serial primary key,
    email             text,
    stripe_customer_id text,
    metadata          jsonb not null default '{}'::jsonb
  );
`;

// The exact runtime upsert PostgREST/Supabase emits for `onConflict: 'app_user_id'`.
const CANONICAL_UPSERT = (uid, email) => `
  insert into public.customers (app_user_id, email, metadata)
  values ('${uid}', '${email}', jsonb_build_object('app_user_id', '${uid}'))
  on conflict (app_user_id) do update set email = excluded.email;
`;

async function freshDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(CREATE_CUSTOMERS);
  return db;
}

const UID_A = '11111111-1111-1111-1111-111111111111';
const UID_B = '22222222-2222-2222-2222-222222222222';

test('039 partial index CANNOT be inferred as the ON CONFLICT (app_user_id) arbiter', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql')); // adds app_user_id column
  await db.exec(MIG('039_stripe_ownership_enforcement.sql')); // partial index only

  await assert.rejects(
    () => db.query(CANONICAL_UPSERT(UID_A, 'a@example.com')),
    (err) => {
      // This is the exact production failure the audit predicted.
      assert.match(String(err.message), /no unique or exclusion constraint matching the ON CONFLICT/i);
      return true;
    },
    'the partial 039 index must NOT satisfy a predicate-less ON CONFLICT (app_user_id)',
  );
  await db.close();
});

test('040 non-partial unique index IS a valid ON CONFLICT (app_user_id) arbiter', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));
  await db.exec(MIG('039_stripe_ownership_enforcement.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql')); // corrective swap

  // First insert.
  await db.query(CANONICAL_UPSERT(UID_A, 'a@example.com'));
  // Repeated upsert (retry / re-checkout) must CONVERGE on ONE row, not duplicate.
  await db.query(CANONICAL_UPSERT(UID_A, 'a2@example.com'));
  await db.query(CANONICAL_UPSERT(UID_A, 'a3@example.com'));
  const one = await db.query(`select count(*)::int n, max(email) email from public.customers where app_user_id = '${UID_A}';`);
  assert.equal(one.rows[0].n, 1, 'repeated canonical upserts converge on exactly one row');
  assert.equal(one.rows[0].email, 'a3@example.com', 'the conflict target updates in place');

  // A different user is a distinct row.
  await db.query(CANONICAL_UPSERT(UID_B, 'b@example.com'));
  const total = await db.query(`select count(*)::int n from public.customers;`);
  assert.equal(total.rows[0].n, 2);
  await db.close();
});

test('040 permits MULTIPLE NULL app_user_id legacy rows (normal UNIQUE allows many NULLs)', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql'));

  await db.query(`insert into public.customers (app_user_id, email) values (null, 'legacy1@example.com');`);
  await db.query(`insert into public.customers (app_user_id, email) values (null, 'legacy2@example.com');`);
  const nulls = await db.query(`select count(*)::int n from public.customers where app_user_id is null;`);
  assert.equal(nulls.rows[0].n, 2, 'two un-backfilled legacy NULL rows remain permitted');
  await db.close();
});

test('040 rejects a second row with the SAME non-null app_user_id', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql'));

  await db.query(`insert into public.customers (app_user_id, email) values ('${UID_A}', 'a@example.com');`);
  await assert.rejects(
    () => db.query(`insert into public.customers (app_user_id, email) values ('${UID_A}', 'dupe@example.com');`),
    /duplicate key value violates unique constraint/i,
    'two identical non-null app_user_id rows must be rejected',
  );
  await db.close();
});

test('040 preflight ABORTS (never picks a winner) when duplicate non-null ids already exist', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql')); // adds app_user_id, no uniqueness yet
  // Seed a pre-existing duplicate that the uniqueness migration must refuse to
  // collapse. (In production this is exactly the state the preflight guards.)
  await db.query(`insert into public.customers (app_user_id, email) values ('${UID_A}', 'one@example.com');`);
  await db.query(`insert into public.customers (app_user_id, email) values ('${UID_A}', 'two@example.com');`);

  await assert.rejects(
    () => db.exec(MIG('040_customers_app_user_id_unique_fix.sql')),
    (err) => {
      assert.match(String(err.message), /preflight/i);
      return true;
    },
    'the DO-block preflight must raise, leaving both rows intact for manual reconciliation',
  );
  // Both rows are untouched — nothing was deleted or merged.
  const rows = await db.query(`select count(*)::int n from public.customers where app_user_id = '${UID_A}';`);
  assert.equal(rows.rows[0].n, 2);
  await db.close();
});

test('040 is idempotent: re-applying on an already-fixed schema is a no-op', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));
  await db.exec(MIG('039_stripe_ownership_enforcement.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql')); // second apply
  await db.query(CANONICAL_UPSERT(UID_A, 'a@example.com'));
  const one = await db.query(`select count(*)::int n from public.customers where app_user_id = '${UID_A}';`);
  assert.equal(one.rows[0].n, 1);
  await db.close();
});

test('the readiness probe reports FALSE for the 039 partial index and TRUE after 040', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));
  await db.exec(MIG('039_stripe_ownership_enforcement.sql'));
  await db.exec(MIG('040_customers_app_user_id_unique_fix.sql')); // defines the probe fn + fixes the index

  const ready = await db.query(`select public.stripe_ownership_uniqueness_ready() as ok;`);
  assert.equal(ready.rows[0].ok, true, 'probe must confirm a valid non-partial arbiter after 040');

  // Simulate a rollback to the partial index and confirm the probe fails closed.
  await db.exec(`drop index if exists public.customers_app_user_id_key;
                 create unique index customers_app_user_id_key on public.customers (app_user_id) where app_user_id is not null;`);
  const notReady = await db.query(`select public.stripe_ownership_uniqueness_ready() as ok;`);
  assert.equal(notReady.rows[0].ok, false, 'probe must reject a partial index as an arbiter');
  await db.close();
});

test('038 hardened backfill: one malformed metadata value cannot abort the bounded backfill', async () => {
  const db = await freshDb();
  await db.exec(MIG('038_stripe_object_ownership.sql'));

  // Seed rows AFTER the migration ran, then re-run only its backfill statement —
  // the same idempotent UPDATE a re-apply would run. One valid UUID, two malformed
  // values (a 36-char all-dashes string and a plainly bad token). The OLD loose
  // regex `^[0-9a-fA-F-]{36}$` accepted the 36-dash string and then `::uuid`
  // aborted the whole statement; the hardened exact-format regex must not.
  await db.query(`insert into public.customers (email, metadata) values
    ('good@example.com', jsonb_build_object('app_user_id', '${UID_A}')),
    ('dashes@example.com', jsonb_build_object('app_user_id', '------------------------------------')),
    ('bad@example.com', jsonb_build_object('app_user_id', 'not-a-uuid'));`);

  const BACKFILL = `
    update public.customers
       set app_user_id = (metadata ->> 'app_user_id')::uuid
     where app_user_id is null
       and metadata ? 'app_user_id'
       and (metadata ->> 'app_user_id')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  `;
  await assert.doesNotReject(() => db.query(BACKFILL), 'hardened backfill must not abort on malformed metadata');

  const good = await db.query(`select app_user_id from public.customers where email = 'good@example.com';`);
  assert.equal(good.rows[0].app_user_id, UID_A, 'the valid UUID is backfilled');
  const bad = await db.query(`select count(*)::int n from public.customers where email in ('dashes@example.com','bad@example.com') and app_user_id is null;`);
  assert.equal(bad.rows[0].n, 2, 'malformed values are left NULL for reconciliation, never coerced');

  // Prove the OLD loose regex genuinely aborts on the 36-dash value (the defect).
  const OLD_BACKFILL = `
    update public.customers
       set app_user_id = (metadata ->> 'app_user_id')::uuid
     where app_user_id is null
       and metadata ? 'app_user_id'
       and (metadata ->> 'app_user_id') ~ '^[0-9a-fA-F-]{36}$';
  `;
  await assert.rejects(() => db.query(OLD_BACKFILL), /invalid input syntax for type uuid/i,
    'the old loose regex would let a malformed 36-char value reach ::uuid and abort');
  await db.close();
});
