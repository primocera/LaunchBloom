// ---------------------------------------------------------------------------
// SV-21-01 (v21) — canonical Stripe ownership: enforcement + invoice ownership.
//
// The v21 MVP-launch-closure gap: billing identity must ride on the stable
// app_user_id and canonical ownership proof, never on email or a configured
// price alone. This suite proves:
//   - the price-only fallback is sunset by STRIPE_OWNERSHIP_ENFORCED (reversible);
//   - invoice ownership is decided by the SUBSCRIPTION, never the invoice line
//     price — a foreign source stamp on a configured price is ignored;
//   - unavailable ownership reads fail closed (retryable), never adopted/dropped;
//   - the local customer row is resolved by app_user_id under enforcement, with
//     multiple rows / read errors failing closed;
//   - the rollout-readiness classifier is fail-closed for paid.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro'; // a configured Scalvya price

const { stubModule } = require('./helpers');

// ── controllable supabase + stripe stubs (module state the stubs read) ───────
const subsMirror = new Map();       // subId -> stored mirror row | 'ERROR'
const customersByAppUser = new Map(); // userId -> array of rows | 'ERROR'
const customersByEmail = new Map(); // email -> single row
const stripeSubs = new Map();       // subId -> object | { __throw: code }
const stripeCustomers = new Map();  // custId -> object | { __throw: code }
const writes = [];                  // recorded customers upserts/updates

// Stub supabase builder. Records customers writes; the upsert().select().single()
// chain used by checkout resolves to the written row id; findCustomerRow's
// app_user_id lookup resolves via the terminal .then to an array (or an error).
function makeSupabaseWithUpsertSingle() {
  function builder(table) {
    const st = { table, op: 'select', filters: {}, payload: null, opts: null };
    const api = {
      select() { return api; },
      upsert(p, opts) { st.op = 'upsert'; st.payload = p; st.opts = opts; return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      not() { return api; },
      is(k, v) { st.filters[`is_${k}`] = v; return api; },
      limit() { return api; },
      single() {
        if (st.table === 'customers' && st.op === 'upsert') {
          writes.push({ op: 'upsert', payload: st.payload, onConflict: st.opts && st.opts.onConflict });
          return Promise.resolve({ data: { id: 'cust_row_1' }, error: null });
        }
        if (st.table === 'customers' && 'email' in st.filters) {
          const row = customersByEmail.get(st.filters.email);
          if (row === 'ERROR') return Promise.resolve({ data: null, error: { code: 'XX000' } });
          if (row) return Promise.resolve({ data: row, error: null });
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
        }
        if (st.table === 'subscriptions') {
          const row = subsMirror.get(st.filters.stripe_subscription_id);
          if (row === 'ERROR') return Promise.resolve({ data: null, error: { code: 'XX000' } });
          if (row) return Promise.resolve({ data: row, error: null });
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
        }
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      },
      then(res, rej) {
        if (st.table === 'customers' && st.op === 'update') {
          writes.push({ op: 'update', payload: st.payload });
          return Promise.resolve({ error: null }).then(res, rej);
        }
        if (st.table === 'customers' && 'app_user_id' in st.filters) {
          const rows = customersByAppUser.get(st.filters.app_user_id);
          if (rows === 'ERROR') return Promise.resolve({ data: null, error: { code: 'XX000' } }).then(res, rej);
          return Promise.resolve({ data: rows || [], error: null }).then(res, rej);
        }
        if (st.table === 'subscriptions' && st.op === 'update') {
          return Promise.resolve({ error: null }).then(res, rej);
        }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      },
    };
    return api;
  }
  return { from: builder };
}

const stripeStub = {
  subscriptions: {
    retrieve: async (id) => {
      const v = stripeSubs.get(id);
      if (!v) { const e = new Error('missing'); e.code = 'resource_missing'; throw e; }
      if (v.__throw) { const e = new Error('api'); e.code = v.__throw; throw e; }
      return v;
    },
  },
  customers: {
    retrieve: async (id) => {
      const v = stripeCustomers.get(id);
      if (!v) { const e = new Error('missing'); e.code = 'resource_missing'; throw e; }
      if (v.__throw) { const e = new Error('api'); e.code = v.__throw; throw e; }
      return v;
    },
  },
};

stubModule('lib/supabase.js', makeSupabaseWithUpsertSingle());
stubModule('lib/stripe.js', stripeStub);

const ownership = require('../lib/stripe-ownership');
const webhooks = require('../routes/webhooks');
const { classifyOwnershipReadiness, STATE } = require('../lib/ownership-readiness');

function reset() {
  subsMirror.clear(); customersByAppUser.clear(); customersByEmail.clear();
  stripeSubs.clear(); stripeCustomers.clear(); writes.length = 0;
  delete process.env.STRIPE_OWNERSHIP_ENFORCED;
}

// ── enforcement flag semantics ──────────────────────────────────────────────

test('ownershipEnforced reflects STRIPE_OWNERSHIP_ENFORCED=1 only', () => {
  reset();
  assert.equal(ownership.ownershipEnforced(), false);
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  assert.equal(ownership.ownershipEnforced(), true);
  process.env.STRIPE_OWNERSHIP_ENFORCED = 'true';
  assert.equal(ownership.ownershipEnforced(), false, 'only the exact "1" enables it');
  reset();
});

test('isOwning sunsets the price-only fallback under enforcement', () => {
  const { OWNERSHIP } = ownership;
  // Not enforced: legacy_price is owning (capped-beta behaviour preserved).
  assert.equal(ownership.isOwning(OWNERSHIP.LEGACY_PRICE, { enforced: false }), true);
  // Enforced: legacy_price no longer grants ownership.
  assert.equal(ownership.isOwning(OWNERSHIP.LEGACY_PRICE, { enforced: true }), false);
  // Exact / mapped ownership is unaffected by the flag; ambiguous/unavailable never own.
  assert.equal(ownership.isOwning(OWNERSHIP.OWNED, { enforced: true }), true);
  assert.equal(ownership.isOwning(OWNERSHIP.LEGACY_MAPPED, { enforced: true }), true);
  assert.equal(ownership.isOwning(OWNERSHIP.AMBIGUOUS, { enforced: false }), false);
  assert.equal(ownership.isOwning(OWNERSHIP.UNAVAILABLE, { enforced: false }), false);
});

// ── invoiceSubscriptionId across Stripe API shapes ──────────────────────────

test('invoiceSubscriptionId resolves the classic and 2025+/2026 shapes', () => {
  assert.equal(webhooks.invoiceSubscriptionId({ subscription: 'sub_a' }), 'sub_a');
  assert.equal(webhooks.invoiceSubscriptionId({ subscription: { id: 'sub_b' } }), 'sub_b');
  assert.equal(webhooks.invoiceSubscriptionId(
    { parent: { subscription_details: { subscription: 'sub_c' } } }), 'sub_c');
  assert.equal(webhooks.invoiceSubscriptionId({ lines: { data: [{ subscription: 'sub_d' }] } }), 'sub_d');
  assert.equal(webhooks.invoiceSubscriptionId({ total: 0 }), null, 'a non-subscription invoice has no sub id');
});

// ── classifyInvoiceOwnership — the headline fix ─────────────────────────────

test('a configured price with a FOREIGN source stamp is NOT ours (price is never proof)', async () => {
  reset();
  stripeSubs.set('sub_foreign', { id: 'sub_foreign', metadata: { app: 'mellowa', supabase_user_id: 'm1' },
    items: { data: [{ price: { id: 'price_pro' } }] } });
  const inv = { id: 'in_1', subscription: 'sub_foreign', lines: { data: [{ price: { id: 'price_pro' } }] } };
  const r = await webhooks.classifyInvoiceOwnership(inv);
  assert.equal(r.ours, false, 'a foreign-stamped subscription is never adopted from a shared price');
  assert.equal(r.state, ownership.OWNERSHIP.FOREIGN);
});

test('an exact launchbloom-stamped subscription invoice is ours (event-before-row race)', async () => {
  reset();
  stripeSubs.set('sub_ours', { id: 'sub_ours', metadata: { source: 'launchbloom', app_user_id: 'u1' },
    items: { data: [{ price: { id: 'price_pro' } }] } });
  const inv = { id: 'in_2', subscription: 'sub_ours', lines: { data: [{ price: { id: 'price_pro' } }] } };
  const r = await webhooks.classifyInvoiceOwnership(inv);
  assert.equal(r.ours, true);
  assert.equal(r.state, ownership.OWNERSHIP.OWNED);
});

test('an unstamped subscription on a configured price is legacy_price — owning OFF, dropped ON', async () => {
  reset();
  stripeSubs.set('sub_legacy', { id: 'sub_legacy', metadata: {},
    items: { data: [{ price: { id: 'price_pro' } }] } });
  const inv = { id: 'in_3', subscription: 'sub_legacy', lines: { data: [{ price: { id: 'price_pro' } }] } };

  const off = await webhooks.classifyInvoiceOwnership(inv);
  assert.equal(off.ours, true, 'capped beta keeps the price-only fallback');
  assert.equal(off.legacy, true, 'and measures it');
  assert.equal(off.state, ownership.OWNERSHIP.LEGACY_PRICE);

  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  const on = await webhooks.classifyInvoiceOwnership(inv);
  assert.equal(on.ours, false, 'enforcement sunsets the price-only fallback');
  reset();
});

test('a foreign price with no stamp is dropped WITHOUT a Stripe read (cheap negative filter)', async () => {
  reset();
  // No stripeSubs entry — if we retrieved, it would throw resource_missing. The
  // cheap filter must short-circuit on the unconfigured price + no stamp.
  const inv = { id: 'in_4', subscription: 'sub_mellowa', lines: { data: [{ price: { id: 'price_mellowa' } }] } };
  const r = await webhooks.classifyInvoiceOwnership(inv);
  assert.equal(r.ours, false);
  assert.equal(r.state, ownership.OWNERSHIP.FOREIGN);
});

test('a trusted mirror row is ours; a foreign-stamped mirror still fails closed', async () => {
  reset();
  // Unstamped mirror (older row) → ours, no Stripe read needed.
  subsMirror.set('sub_m1', { stripe_subscription_id: 'sub_m1', metadata: {} });
  const r1 = await webhooks.classifyInvoiceOwnership({ id: 'in_5', subscription: 'sub_m1', lines: { data: [] } });
  assert.equal(r1.ours, true);

  // A mirror whose stored metadata proves foreign is rejected (defense in depth).
  subsMirror.set('sub_m2', { stripe_subscription_id: 'sub_m2', metadata: { app: 'mellowa', supabase_user_id: 'x' } });
  const r2 = await webhooks.classifyInvoiceOwnership({ id: 'in_6', subscription: 'sub_m2', lines: { data: [] } });
  assert.equal(r2.ours, false);
  assert.equal(r2.state, ownership.OWNERSHIP.FOREIGN);
});

test('a DB read failure on the mirror lookup fails closed (unavailable → retry)', async () => {
  reset();
  subsMirror.set('sub_err', 'ERROR');
  const r = await webhooks.classifyInvoiceOwnership({ id: 'in_7', subscription: 'sub_err', lines: { data: [] } });
  assert.equal(r.unavailable, true);
  assert.equal(r.ours, false);
  assert.equal(r.state, ownership.OWNERSHIP.UNAVAILABLE);
});

test('a transient Stripe retrieve failure fails closed; resource_missing is not-ours', async () => {
  reset();
  stripeSubs.set('sub_transient', { __throw: 'StripeConnectionError' });
  const transient = await webhooks.classifyInvoiceOwnership(
    { id: 'in_8', subscription: 'sub_transient', lines: { data: [{ price: { id: 'price_pro' } }] } });
  assert.equal(transient.unavailable, true, 'a transient provider error is retryable, never adopted or dropped');

  // resource_missing (no such subscription) is a clean not-ours, not unavailable.
  const gone = await webhooks.classifyInvoiceOwnership(
    { id: 'in_9', subscription: 'sub_gone', lines: { data: [{ price: { id: 'price_pro' } }] } });
  assert.equal(gone.unavailable, false);
  assert.equal(gone.ours, false);
});

test('a non-subscription invoice is not ours', async () => {
  reset();
  const r = await webhooks.classifyInvoiceOwnership({ id: 'in_10', total: 0, lines: { data: [] } });
  assert.equal(r.ours, false);
});

// ── enforced checkout.session.completed identity ────────────────────────────

test('enforced checkout adopts ONLY a customer whose exact source + app_user_id match', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  // Right user, exact stamp → persisted, keyed by app_user_id.
  stripeCustomers.set('cus_ok', { id: 'cus_ok', email: 'a@b.com', metadata: { source: 'launchbloom', app_user_id: 'u1' } });
  await webhooks.onCheckoutSessionCompleted({
    id: 'cs_1', customer: 'cus_ok', metadata: { scalvya: '1', app_user_id: 'u1' }, mode: 'payment',
  });
  assert.equal(writes.length, 1, 'the owned customer is persisted');
  assert.equal(writes[0].onConflict, 'app_user_id', 'the canonical conflict key is app_user_id, never email');
  assert.equal(writes[0].payload.app_user_id, 'u1');
  reset();
});

test('enforced checkout NEVER persists a wrong-user or foreign customer even if email matches', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  // Same email, but the live customer belongs to a DIFFERENT app_user_id.
  stripeCustomers.set('cus_wrong', { id: 'cus_wrong', email: 'a@b.com', metadata: { source: 'launchbloom', app_user_id: 'u_other' } });
  await webhooks.onCheckoutSessionCompleted({
    id: 'cs_2', customer: 'cus_wrong', metadata: { scalvya: '1', app_user_id: 'u1' }, mode: 'payment',
  });
  assert.deepEqual(writes, [], 'a wrong-user customer is acked but never adopted');
  reset();
});

test('enforced checkout with a transient customer read throws (retryable), persists nothing', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  stripeCustomers.set('cus_t', { __throw: 'StripeConnectionError' });
  await assert.rejects(() => webhooks.onCheckoutSessionCompleted({
    id: 'cs_3', customer: 'cus_t', metadata: { scalvya: '1', app_user_id: 'u1' }, mode: 'payment',
  }));
  assert.deepEqual(writes, []);
  reset();
});

// ── findCustomerRow canonical identity ──────────────────────────────────────

test('findCustomerRow keys on app_user_id under enforcement and fails closed on multiples', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  const { findCustomerRow } = require('../routes/customers');

  customersByAppUser.set('u1', [{ id: 'c1', stripe_customer_id: 'cus_1' }]);
  const one = await findCustomerRow({ userId: 'u1', email: 'a@b.com' });
  assert.equal(one.id, 'c1');

  customersByAppUser.set('u2', [{ id: 'c2' }, { id: 'c3' }]);
  await assert.rejects(() => findCustomerRow({ userId: 'u2' }),
    (e) => e.code === 'CUSTOMER_RECONCILIATION_REQUIRED', 'multiple rows never pick an arbitrary winner');

  customersByAppUser.set('u3', 'ERROR');
  await assert.rejects(() => findCustomerRow({ userId: 'u3' }), 'a read error fails closed');

  const none = await findCustomerRow({ userId: 'u_none' });
  assert.equal(none, null, 'a verified no-row is null');
  reset();
});

test('findCustomerRow keys on email before enforcement (unchanged beta behaviour)', async () => {
  reset();
  const { findCustomerRow } = require('../routes/customers');
  customersByEmail.set('a@b.com', { id: 'c1', stripe_customer_id: 'cus_1' });
  const row = await findCustomerRow({ userId: 'u1', email: 'A@B.com' });
  assert.equal(row.id, 'c1', 'email is normalised and used as the legacy key');
  reset();
});

// ── ownership rollout readiness — fail closed for paid ──────────────────────

test('classifyOwnershipReadiness distinguishes the rollout states', () => {
  // SV-22-01: uniquenessReady is now a measured precondition (the non-partial
  // ON CONFLICT arbiter from migration 040), so the fully-prepared base carries it.
  const base = { migrationApplied: true, unbackfilledCount: 0, ambiguousCount: 0, uniquenessReady: true };
  assert.equal(classifyOwnershipReadiness({ ...base, migrationApplied: false }).state, STATE.MIGRATION_MISSING);
  assert.equal(classifyOwnershipReadiness({ ...base, unbackfilledCount: 3 }).state, STATE.BACKFILL_INCOMPLETE);
  assert.equal(classifyOwnershipReadiness({ ...base, ambiguousCount: 2 }).state, STATE.AMBIGUOUS_PRESENT);
  assert.equal(classifyOwnershipReadiness({ ...base, enforced: false }).state, STATE.FALLBACK_ENABLED);
  assert.equal(classifyOwnershipReadiness({ ...base, enforced: true }).state, STATE.ENFORCEMENT_ACTIVE);
});

test('SV-22-01: a missing/partial uniqueness arbiter fails closed', () => {
  const base = { migrationApplied: true, unbackfilledCount: 0, ambiguousCount: 0 };
  // 039-only partial index (or none): probe returns false → not paid-ready.
  const missing = classifyOwnershipReadiness({ ...base, uniquenessReady: false, enforced: false });
  assert.equal(missing.state, STATE.UNIQUENESS_MISSING);
  assert.equal(missing.paid_ready, false);
  // Enforcement flipped on WITHOUT the arbiter is an explicit blocker (the
  // canonical upsert would fail with an ON CONFLICT mismatch).
  const enforcedNoArbiter = classifyOwnershipReadiness({ ...base, uniquenessReady: false, enforced: true });
  assert.equal(enforcedNoArbiter.state, STATE.UNIQUENESS_MISSING);
  assert.ok(enforcedNoArbiter.blockers.includes('enforcement_on_without_uniqueness_arbiter'));
  assert.equal(enforcedNoArbiter.paid_ready, false);
  // Unmeasured uniqueness is never healthy.
  const unmeasured = classifyOwnershipReadiness({ ...base, uniquenessReady: null });
  assert.equal(unmeasured.state, STATE.UNKNOWN);
  assert.ok(unmeasured.blockers.includes('uniqueness_state_unmeasured'));
});

test('paid_ready is fail-closed: true only in enforcement_active', () => {
  const base = { migrationApplied: true, unbackfilledCount: 0, ambiguousCount: 0, uniquenessReady: true };
  assert.equal(classifyOwnershipReadiness({ ...base, enforced: true }).paid_ready, true);
  assert.equal(classifyOwnershipReadiness({ ...base, enforced: false }).paid_ready, false);
  assert.equal(classifyOwnershipReadiness({ ...base, ambiguousCount: 1, enforced: true }).paid_ready, false);
  // An unmeasured precondition is never healthy.
  const unknown = classifyOwnershipReadiness({ migrationApplied: null });
  assert.equal(unknown.state, STATE.UNKNOWN);
  assert.equal(unknown.paid_ready, false);
});

test('enforcement claimed without satisfied preconditions surfaces a blocker', () => {
  const r = classifyOwnershipReadiness({ enforced: true, migrationApplied: false });
  assert.ok(r.blockers.includes('enforcement_on_without_migration'));
  assert.equal(r.paid_ready, false);
});
