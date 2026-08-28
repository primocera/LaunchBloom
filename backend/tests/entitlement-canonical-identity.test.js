// ---------------------------------------------------------------------------
// SV-22-01 (v22) — Defect B: canonical entitlement identity.
//
// Before v22, resolveEntitlement()/planFor() keyed on the BARE EMAIL, while the
// customer row under STRIPE_OWNERSHIP_ENFORCED is owned by the stable app_user_id
// (email is mutable display data). So an email change silently detached a paying
// customer from their subscription: the account plan display showed "free" AND the
// duplicate-subscription guard (which reads the same resolver) would let a SECOND
// subscription be created.
//
// These tests drive resolveEntitlement()/planFor() directly against a stateful
// Supabase fake and prove the fix: under enforcement entitlement is resolved by
// app_user_id (survives an email change), multiple/ambiguous rows and read errors
// FAIL CLOSED, an email-only row is never treated as canonical ownership, and the
// pre-enforcement email path (plus the legacy bare-string arg) is preserved.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro'; // a configured Scalvya price

const { stubModule } = require('./helpers');

// ── stateful supabase fake keyed the way the runtime queries ────────────────
const customersByAppUser = new Map(); // userId -> array<{id}> | 'ERROR'
const customersByEmail = new Map();   // email  -> {id} | 'ERROR'
const subsByCustomer = new Map();     // customerId -> array<subRow> | 'ERROR'
const paymentsByCustomer = new Map(); // customerId -> true (has succeeded payment)

function builder(table) {
  const st = { table, filters: {} };
  const api = {
    select() { return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    in(k, v) { st.filters[`in_${k}`] = v; return api; },
    order() { return api; },
    limit() { return api; },
    not() { return api; },
    is(k, v) { st.filters[`is_${k}`] = v; return api; },
    single() { return Promise.resolve(resolveSingle(st)); },
    then(res, rej) { return Promise.resolve(resolveMany(st)).then(res, rej); },
  };
  return api;
}

function resolveSingle(st) {
  if (st.table === 'customers' && 'email' in st.filters) {
    const row = customersByEmail.get(st.filters.email);
    if (row === 'ERROR') return { data: null, error: { code: 'XX000' } };
    if (row) return { data: row, error: null };
    return { data: null, error: { code: 'PGRST116' } };
  }
  if (st.table === 'payments') {
    const has = paymentsByCustomer.get(st.filters.customer_id);
    if (has === 'ERROR') return { data: null, error: { code: 'XX000' } };
    if (has) return { data: { id: 'pay_1' }, error: null };
    return { data: null, error: { code: 'PGRST116' } };
  }
  return { data: null, error: { code: 'PGRST116' } };
}

function resolveMany(st) {
  if (st.table === 'customers' && 'app_user_id' in st.filters) {
    const rows = customersByAppUser.get(st.filters.app_user_id);
    if (rows === 'ERROR') return { data: null, error: { code: 'XX000' } };
    return { data: rows || [], error: null };
  }
  if (st.table === 'subscriptions') {
    const rows = subsByCustomer.get(st.filters.customer_id);
    if (rows === 'ERROR') return { data: null, error: { code: 'XX000' } };
    return { data: rows || [], error: null };
  }
  return { data: [], error: null };
}

stubModule('lib/supabase.js', { from: builder });

const { resolveEntitlement, planFor } = require('../routes/customers');
const { isEntitlementUnavailable } = require('../lib/subscription-state');

const activeProSub = {
  status: 'active', stripe_price_id: 'price_pro',
  stripe_subscription_id: 'sub_1', stripe_event_at: '2026-08-01T00:00:00Z',
};

function reset() {
  customersByAppUser.clear(); customersByEmail.clear();
  subsByCustomer.clear(); paymentsByCustomer.clear();
  delete process.env.STRIPE_OWNERSHIP_ENFORCED;
}

// ── enforcement: identity rides on the stable app_user_id ───────────────────

test('SV-22-01: an active subscriber who changed email STILL resolves paid (app_user_id)', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  customersByAppUser.set('u1', [{ id: 'c1' }]);
  subsByCustomer.set('c1', [activeProSub]);
  // The email now on the session is a NEW one that has no customers.email row.
  customersByEmail.clear();

  const r = await resolveEntitlement({ userId: 'u1', email: 'changed@example.com' });
  assert.deepEqual(r, { state: 'entitled', plan: 'pro' });
  assert.equal(await planFor({ userId: 'u1', email: 'changed@example.com' }), 'pro',
    'paid access persists across an email change — this is also what blocks a second checkout');
  reset();
});

test('SV-22-01: under enforcement an email-only row is NOT canonical ownership', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  // A row exists keyed by email, but NOT by this user's app_user_id.
  customersByEmail.set('shared@example.com', { id: 'cEmail' });
  subsByCustomer.set('cEmail', [activeProSub]);

  const r = await resolveEntitlement({ userId: 'u1', email: 'shared@example.com' });
  assert.deepEqual(r, { state: 'free', plan: null },
    'an email-only row must not grant ownership when the app_user_id has no row');
  reset();
});

test('SV-22-01: multiple canonical rows for one app_user_id FAIL CLOSED', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  customersByAppUser.set('u1', [{ id: 'c1' }, { id: 'c2' }]); // ambiguous ownership

  const r = await resolveEntitlement({ userId: 'u1', email: 'a@example.com' });
  assert.equal(r.state, 'unavailable', 'ambiguous ownership never grants — it fails closed');
  assert.equal(r.plan, null);
  await assert.rejects(() => planFor({ userId: 'u1', email: 'a@example.com' }),
    (e) => isEntitlementUnavailable(e), 'planFor throws so a caller cannot read it as free');
  reset();
});

test('SV-22-01: a customers read error under enforcement fails closed (never "free")', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  customersByAppUser.set('u1', 'ERROR');

  const r = await resolveEntitlement({ userId: 'u1', email: 'a@example.com' });
  assert.equal(r.state, 'unavailable');
  assert.equal(r.plan, null);
  reset();
});

test('SV-22-01: a subscriptions read error under enforcement fails closed', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  customersByAppUser.set('u1', [{ id: 'c1' }]);
  subsByCustomer.set('c1', 'ERROR');

  const r = await resolveEntitlement({ userId: 'u1', email: 'a@example.com' });
  assert.equal(r.state, 'unavailable');
  reset();
});

test('SV-22-01: a one-time succeeded payment still grants lifetime pro under enforcement', async () => {
  reset();
  process.env.STRIPE_OWNERSHIP_ENFORCED = '1';
  customersByAppUser.set('u1', [{ id: 'c1' }]);
  subsByCustomer.set('c1', []); // no entitling subscription
  paymentsByCustomer.set('c1', true);

  const r = await resolveEntitlement({ userId: 'u1', email: 'a@example.com' });
  assert.deepEqual(r, { state: 'entitled', plan: 'pro' });
  reset();
});

// ── pre-enforcement: the historical email path is preserved ─────────────────

test('pre-enforcement resolves by email (identity object AND legacy bare string)', async () => {
  reset(); // STRIPE_OWNERSHIP_ENFORCED unset
  customersByEmail.set('legacy@example.com', { id: 'c1' });
  subsByCustomer.set('c1', [activeProSub]);

  assert.equal(await planFor({ userId: 'u1', email: 'legacy@example.com' }), 'pro',
    'before enforcement the email key is used regardless of userId');
  assert.equal(await planFor('legacy@example.com'), 'pro',
    'a bare email string still works (back-compat for existing callers/tests)');
  reset();
});

test('pre-enforcement: verified no customer row is a clean "free", not unavailable', async () => {
  reset();
  const r = await resolveEntitlement({ userId: 'u1', email: 'nobody@example.com' });
  assert.deepEqual(r, { state: 'free', plan: null });
  reset();
});

test('pre-enforcement: a customers read error still fails closed', async () => {
  reset();
  customersByEmail.set('err@example.com', 'ERROR');
  const r = await resolveEntitlement({ userId: 'u1', email: 'err@example.com' });
  assert.equal(r.state, 'unavailable');
  reset();
});
