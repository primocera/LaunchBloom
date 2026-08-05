// ---------------------------------------------------------------------------
// v15 SC-02 — idempotent Stripe customer creation and orphan recovery.
//
// The v14 fix proved ONE failed attempt creates no Checkout Session. It did not
// prove RETRY safety: stripe.customers.create() ran without an idempotency key,
// and Stripe does not deduplicate Customer objects by email, so a retry after a
// failed link write could mint a second customer. These tests drive
// ensureStripeCustomer() directly against a Stripe fake that honours the
// idempotency key and a metadata search, and a stateful Supabase fake, proving
// that repeated and concurrent attempts converge on ONE customer — and that
// multiple candidates fail closed instead of being arbitrarily chosen.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';

const { stubModule } = require('./helpers');

const DB_ERROR = { code: '08006', message: 'connection refused' };
const NO_ROW = { code: 'PGRST116', message: 'no rows' };
const USER = 'user-uuid-1';
const EMAIL = 'buyer@example.com';

// --- stateful Stripe fake -------------------------------------------------
const stripe = {
  _created: [],
  _byKey: new Map(),
  actualCreations: 0,
  reset() { this._created = []; this._byKey = new Map(); this.actualCreations = 0; },
  // Pre-seed a customer that already exists in Stripe (an orphan, a foreign
  // product's customer, or a duplicate) without counting it as a create.
  seed(id, metadata, { deleted = false } = {}) {
    const c = { id, deleted, email: EMAIL, metadata: metadata || {} };
    this._created.push(c);
    return c;
  },
  customers: {
    create: async (params, opts) => {
      const key = opts && opts.idempotencyKey;
      if (key && stripe._byKey.has(key)) return stripe._byKey.get(key); // idempotent replay
      stripe.actualCreations += 1;
      const c = { id: `cus_${stripe._created.length + 1}`, deleted: false, email: params.email, metadata: params.metadata || {} };
      stripe._created.push(c);
      if (key) stripe._byKey.set(key, c);
      return c;
    },
    retrieve: async (id) => {
      const c = stripe._created.find((x) => x.id === id);
      if (!c) { const e = new Error('No such customer'); e.code = 'resource_missing'; throw e; }
      return c;
    },
    search: async ({ query }) => {
      const uid = (query.match(/app_user_id'\]:'([^']+)'/) || [])[1];
      const src = (query.match(/source'\]:'([^']+)'/) || [])[1];
      const data = stripe._created.filter(
        (c) => !c.deleted && c.metadata && c.metadata.app_user_id === uid && c.metadata.source === src,
      );
      return { data };
    },
  },
};

// --- stateful Supabase fake ----------------------------------------------
const db = {
  rows: new Map(), // email -> { id, stripe_customer_id, metadata }
  readError: null,
  upsertError: null,
  // Arm a concurrent writer that overwrites our link between upsert and
  // read-back (the race the SC-02 conflict check must catch).
  raceTo: null,
  reset() { this.rows = new Map(); this.readError = null; this.upsertError = null; this.raceTo = null; },
};

stubModule('lib/supabase.js', {
  from(table) {
    let op = 'select';
    let email = null;
    let vals = null;
    const b = {
      select() { op = 'select'; return b; },
      upsert(v) { op = 'upsert'; vals = v; return b; },
      eq(col, val) { if (col === 'email') email = val; return b; },
      single() {
        if (table !== 'customers') return Promise.resolve({ data: null, error: null });
        if (db.readError) return Promise.resolve({ data: null, error: db.readError });
        const row = db.rows.get(email);
        if (!row) return Promise.resolve({ data: null, error: NO_ROW });
        return Promise.resolve({ data: row, error: null });
      },
      then(onOk, onErr) {
        if (op === 'upsert' && table === 'customers') {
          if (db.upsertError) return Promise.resolve({ error: db.upsertError }).then(onOk, onErr);
          db.rows.set(vals.email, { id: `row-${vals.email}`, stripe_customer_id: vals.stripe_customer_id, metadata: vals.metadata });
          // A concurrent writer lands after our upsert, before our read-back.
          if (db.raceTo) db.rows.set(vals.email, { id: `row-${vals.email}`, stripe_customer_id: db.raceTo, metadata: vals.metadata });
          return Promise.resolve({ error: null }).then(onOk, onErr);
        }
        return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
      },
    };
    return b;
  },
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
});

stubModule('lib/stripe.js', stripe);

const payments = require('../routes/payments');
const { ensureStripeCustomer, stripeCustomerIdempotencyKey, CustomerReconciliationRequiredError, APP_STRIPE_SOURCE } = payments;
const { isEntitlementUnavailable } = require('../lib/subscription-state');

function reset() { stripe.reset(); db.reset(); }

// --- the SC-02 required regressions ---------------------------------------

test('customer-table read error → zero Stripe calls, fails closed', async () => {
  reset();
  db.readError = DB_ERROR;
  await assert.rejects(() => ensureStripeCustomer(EMAIL, USER), (e) => isEntitlementUnavailable(e));
  assert.equal(stripe.actualCreations, 0);
});

test('missing stable user id → fails closed before any Stripe call (no email fallback)', async () => {
  reset();
  await assert.rejects(() => ensureStripeCustomer(EMAIL, ''), (e) => isEntitlementUnavailable(e));
  assert.equal(stripe.actualCreations, 0);
});

test('verified no customer → exactly one create, durably linked', async () => {
  reset();
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(stripe.actualCreations, 1);
  assert.equal(db.rows.get(EMAIL).stripe_customer_id, id);
  // No PII / mutable email in the identity: metadata carries the stable user id.
  const created = stripe._created.find((c) => c.id === id);
  assert.equal(created.metadata.app_user_id, USER);
  assert.equal(created.metadata.source, APP_STRIPE_SOURCE);
});

test('link upsert fails → throws unavailable, orphan not deleted, single customer only', async () => {
  reset();
  db.upsertError = DB_ERROR;
  await assert.rejects(() => ensureStripeCustomer(EMAIL, USER), (e) => isEntitlementUnavailable(e));
  assert.equal(stripe.actualCreations, 1, 'the Stripe customer WAS created');
  assert.equal(stripe._created.filter((c) => !c.deleted).length, 1, 'exactly one — not deleted, not doubled');
});

test('immediate retry after a failed link write reuses the same customer — no second Customer', async () => {
  reset();
  // Attempt 1: link write fails, leaving an orphan in Stripe.
  db.upsertError = DB_ERROR;
  await assert.rejects(() => ensureStripeCustomer(EMAIL, USER));
  assert.equal(stripe.actualCreations, 1);
  const orphanId = stripe._created[0].id;
  // Attempt 2: link write succeeds. Recovery must reclaim the orphan by
  // metadata rather than mint a second customer.
  db.upsertError = null;
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, orphanId, 'the same customer must be reused');
  assert.equal(stripe.actualCreations, 1, 'NO second Customer object may be created');
  assert.equal(db.rows.get(EMAIL).stripe_customer_id, orphanId);
});

test('concurrent duplicate requests converge on one logical customer', async () => {
  reset();
  const [a, b] = await Promise.all([
    ensureStripeCustomer(EMAIL, USER),
    ensureStripeCustomer(EMAIL, USER),
  ]);
  assert.equal(a, b, 'both requests resolve to the same customer');
  assert.equal(stripe.actualCreations, 1, 'the idempotency key collapses concurrent creates to one');
});

test('existing valid linked customer → no create call', async () => {
  reset();
  const seeded = stripe.seed('cus_existing', { app_user_id: USER, source: APP_STRIPE_SOURCE });
  db.rows.set(EMAIL, { id: 'row-1', stripe_customer_id: seeded.id, metadata: { app_user_id: USER } });
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, 'cus_existing');
  assert.equal(stripe.actualCreations, 0);
});

test('stale/deleted linked customer → deterministic recovery of the live orphan, no new create', async () => {
  reset();
  // The DB points at a customer Stripe no longer has (resource_missing), but a
  // live Scalvya-owned orphan exists for the same user.
  db.rows.set(EMAIL, { id: 'row-1', stripe_customer_id: 'cus_gone', metadata: { app_user_id: USER } });
  const live = stripe.seed('cus_live_orphan', { app_user_id: USER, source: APP_STRIPE_SOURCE });
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, live.id);
  assert.equal(stripe.actualCreations, 0, 'recovery reused the orphan rather than creating');
});

test('multiple recovery candidates → reconciliation-required failure, no arbitrary pick', async () => {
  reset();
  stripe.seed('cus_dup_1', { app_user_id: USER, source: APP_STRIPE_SOURCE });
  stripe.seed('cus_dup_2', { app_user_id: USER, source: APP_STRIPE_SOURCE });
  await assert.rejects(
    () => ensureStripeCustomer(EMAIL, USER),
    (e) => e instanceof CustomerReconciliationRequiredError && e.candidateCount === 2,
  );
  assert.equal(stripe.actualCreations, 0, 'never create while duplicates are unresolved');
});

test('a foreign-product customer with the same email/user is never adopted', async () => {
  reset();
  // Same email and same app_user_id value, but a DIFFERENT product's source tag.
  stripe.seed('cus_mellowa', { app_user_id: USER, source: 'mellowa' });
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.notEqual(id, 'cus_mellowa', 'must not adopt the foreign customer');
  assert.equal(stripe.actualCreations, 1, 'creates its own Scalvya-owned customer instead');
  assert.equal(stripe._created.find((c) => c.id === id).metadata.source, APP_STRIPE_SOURCE);
});

test('link race (concurrent writer wins) → uses the persisted live winner, not our create', async () => {
  reset();
  const winner = stripe.seed('cus_winner', { app_user_id: USER, source: APP_STRIPE_SOURCE });
  db.raceTo = winner.id; // a concurrent writer links cus_winner after our upsert
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, winner.id, 'the DB winner is the durable truth');
});

test('the idempotency key is namespaced, deterministic and carries no email/PII', () => {
  const key = stripeCustomerIdempotencyKey(USER);
  assert.equal(key, stripeCustomerIdempotencyKey(USER), 'deterministic');
  assert.ok(key.startsWith('scalvya:'), 'app-namespaced');
  assert.ok(key.includes(USER));
  assert.ok(!/@/.test(key), 'no email');
});

test('logs on the stale-id path leak neither the full email nor a secret payload', async () => {
  reset();
  db.rows.set(EMAIL, { id: 'row-1', stripe_customer_id: 'cus_gone', metadata: { app_user_id: USER } });
  const lines = [];
  const orig = { warn: console.warn, error: console.error, log: console.log };
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await ensureStripeCustomer(EMAIL, USER); // creates fresh (no orphan seeded)
  } finally {
    Object.assign(console, orig);
  }
  const blob = lines.join('\n');
  assert.ok(!blob.includes(EMAIL), 'the full email must never be logged');
  assert.ok(!/sk_|whsec_|connection refused|PGRST/.test(blob), 'no secret or raw provider payload');
});
