// ---------------------------------------------------------------------------
// v13 SC-P0-01 — "we could not verify the plan" must never be served as
// "verified free". Covers the four entitlement states, the fail-closed
// checkout, and the non-destructive verify-plan read.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';

const { stubModule, makeFakeSupabase, mockRes } = require('./helpers');

// Mutable per-test result set — builderFor() reads results[table] at call time.
const results = {
  customers: { data: { id: 'cust-1' }, error: null },
  subscriptions: { data: null, error: null },
  payments: { data: null, error: { code: 'PGRST116' } },
};
stubModule('lib/supabase.js', makeFakeSupabase(results));

const {
  resolveEntitlement,
  planFor,
  verifyPlanHandler,
} = require('../routes/customers');
const { isEntitlementUnavailable, PLAN_UNAVAILABLE_MESSAGE } = require('../lib/subscription-state');

const DB_DOWN = { code: '08006', message: 'connection to server failed' };

function reset() {
  results.customers = { data: { id: 'cust-1' }, error: null };
  results.subscriptions = { data: null, error: null };
  results.payments = { data: null, error: { code: 'PGRST116' } };
}

// ── the four states ───────────────────────────────────────────────────────

test('state 1 — verified free: no customer row is a real answer, not a failure', async () => {
  reset();
  results.customers = { data: null, error: { code: 'PGRST116' } };
  assert.deepEqual(await resolveEntitlement('nobody@example.com'), { state: 'free', plan: null });
  assert.equal(await planFor('nobody@example.com'), null);
});

test('state 2 — verified paid: mapped price resolves to its plan', async () => {
  reset();
  results.subscriptions = { data: [{ status: 'active', stripe_price_id: 'price_pro_y' }], error: null };
  assert.deepEqual(await resolveEntitlement('paid@example.com'), { state: 'entitled', plan: 'pro' });
});

test('state 3 — entitling subscription on an UNKNOWN price is its own state, not free', async () => {
  reset();
  results.subscriptions = { data: [{ status: 'active', stripe_price_id: 'price_retired' }], error: null };
  const r = await resolveEntitlement('mystery@example.com');
  assert.equal(r.state, 'unmapped');
  assert.equal(r.plan, null); // still never silently granted
});

test('state 4 — infrastructure error is UNAVAILABLE, never null/free', async () => {
  reset();
  results.customers = { data: null, error: DB_DOWN };
  const r = await resolveEntitlement('paid@example.com');
  assert.equal(r.state, 'unavailable');
  assert.notEqual(r.state, 'free');

  // planFor() throws rather than letting a caller read the failure as "no plan".
  await assert.rejects(() => planFor('paid@example.com'), (e) => {
    assert.ok(isEntitlementUnavailable(e));
    assert.equal(e.code, 'PLAN_UNAVAILABLE');
    return true;
  });
});

test('a subscriptions-table failure is unavailable too (not a downgrade)', async () => {
  reset();
  results.subscriptions = { data: null, error: DB_DOWN };
  assert.equal((await resolveEntitlement('paid@example.com')).state, 'unavailable');
});

test('a payments-table failure is unavailable too', async () => {
  reset();
  results.payments = { data: null, error: DB_DOWN };
  assert.equal((await resolveEntitlement('paid@example.com')).state, 'unavailable');
});

// ── regression: the normal plans still resolve ────────────────────────────

test('regression — free, trial, starter, pro and lifetime still resolve', async () => {
  reset();
  assert.equal(await planFor('free@example.com'), null);

  results.subscriptions = { data: [{ status: 'trialing', stripe_price_id: 'price_starter_m' }], error: null };
  assert.equal(await planFor('t@example.com'), 'trial');

  results.subscriptions = { data: [{ status: 'active', stripe_price_id: 'price_starter_m' }], error: null };
  assert.equal(await planFor('s@example.com'), 'starter');

  results.subscriptions = { data: null, error: null };
  results.payments = { data: { id: 'pay-1' }, error: null };
  assert.equal(await planFor('lifetime@example.com'), 'pro');
});

test('regression — a retired price beside the current one still returns the paid plan', async () => {
  reset();
  results.subscriptions = {
    data: [
      { status: 'active', stripe_price_id: 'price_retired', stripe_event_at: '2026-02-01T00:00:00Z' },
      { status: 'active', stripe_price_id: 'price_pro_y', stripe_event_at: '2026-01-01T00:00:00Z' },
    ],
    error: null,
  };
  assert.equal(await planFor('overlap@example.com'), 'pro');
});

// ── verify-plan: a paying user is not downgraded during a lookup error ────

test('verify-plan returns 503 unavailable — never active:false — on a lookup error', async () => {
  reset();
  results.customers = { data: null, error: DB_DOWN };
  const res = mockRes();
  await verifyPlanHandler({ userEmail: 'paid@example.com' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'PLAN_UNAVAILABLE');
  assert.equal(res.body.error, PLAN_UNAVAILABLE_MESSAGE);
  assert.equal(res.body.active, null, 'must NOT report active:false');
  assert.notEqual(res.body.active, false);
});

test('verify-plan still answers normally when the lookup succeeds', async () => {
  reset();
  results.subscriptions = { data: [{ status: 'active', stripe_price_id: 'price_pro_y' }], error: null };
  const ok = mockRes();
  await verifyPlanHandler({ userEmail: 'paid@example.com' }, ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { active: true, plan: 'pro' });

  reset();
  const free = mockRes();
  await verifyPlanHandler({ userEmail: 'free@example.com' }, free);
  assert.deepEqual(free.body, { active: false, plan: null });
});

// ── no raw provider text ever reaches the user ────────────────────────────

test('the unavailable response carries no provider/DB detail', async () => {
  reset();
  results.customers = { data: null, error: DB_DOWN };
  const res = mockRes();
  await verifyPlanHandler({ userEmail: 'paid@example.com' }, res);
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('connection to server'));
  assert.ok(!body.includes('08006'));
});
