// ---------------------------------------------------------------------------
// v13 SC-P1-08 — trial eligibility, the "no double-trialing" invariant.
//
// hadTrialOrActiveSubscription() decides whether a fresh checkout applies the
// 3-day trial. A first-time email is eligible; anyone who has already had a
// trial (trial_end recorded) or holds an active/trialing/past_due row is not.
// These are the "eligible first trial" and "already-used trial" matrix states,
// proven at the unit layer with a mocked Supabase — no Stripe, no network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const { stubModule, makeFakeSupabase } = require('./helpers');

// A mutable results object: builderFor() re-reads it on every call, so mutating
// these fields between tests changes what customers/subscriptions return.
const results = { customers: { data: null, error: null }, subscriptions: { data: null, error: null } };
stubModule('lib/supabase.js', makeFakeSupabase(results));

const { hadTrialOrActiveSubscription } = require('../routes/payments');

function setCustomer(customer) { results.customers = { data: customer, error: null }; }
function setSubs(subs) { results.subscriptions = { data: subs, error: null }; }

test('a brand-new email has no customer → eligible for the first trial', async () => {
  setCustomer(null);
  setSubs(null);
  assert.equal(await hadTrialOrActiveSubscription('new@synthetic.test'), false);
});

test('a customer with no subscriptions is still eligible', async () => {
  setCustomer({ id: 'cus_synthetic_1' });
  setSubs([]);
  assert.equal(await hadTrialOrActiveSubscription('nobody@synthetic.test'), false);
});

test('a recorded trial_end means the trial was already used → NOT eligible', async () => {
  setCustomer({ id: 'cus_synthetic_1' });
  setSubs([{ status: 'canceled', trial_end: '2026-07-01T00:00:00Z' }]);
  assert.equal(await hadTrialOrActiveSubscription('used@synthetic.test'), true);
});

test('an active subscription blocks a second trial', async () => {
  setCustomer({ id: 'cus_synthetic_1' });
  setSubs([{ status: 'active', trial_end: null }]);
  assert.equal(await hadTrialOrActiveSubscription('active@synthetic.test'), true);
});

test('a past_due subscription blocks a second trial (no free re-trial to dodge dunning)', async () => {
  setCustomer({ id: 'cus_synthetic_1' });
  setSubs([{ status: 'past_due', trial_end: null }]);
  assert.equal(await hadTrialOrActiveSubscription('pastdue@synthetic.test'), true);
});

test('an empty email is never treated as a returning trialer', async () => {
  assert.equal(await hadTrialOrActiveSubscription(''), false);
  assert.equal(await hadTrialOrActiveSubscription(null), false);
});

// --- v14 SC-02: FAIL CLOSED on read failure ------------------------------
// A Supabase outage is NOT evidence of "no prior trial". Treating a read error
// as absence is exactly how a returning user is handed a second free trial, so
// every real read error must throw the canonical unavailable error, and only a
// VERIFIED no-row (PGRST116) may return eligible.

const DB_ERROR = { code: '08006', message: 'connection refused' };

test('a customer read ERROR fails closed → throws, never "eligible"', async () => {
  results.customers = { data: null, error: DB_ERROR };
  results.subscriptions = { data: null, error: null };
  await assert.rejects(
    () => hadTrialOrActiveSubscription('err@synthetic.test'),
    (e) => e.code === 'PLAN_UNAVAILABLE'
  );
  results.customers = { data: null, error: null };
});

test('a subscription-history read ERROR fails closed → throws', async () => {
  setCustomer({ id: 'cus_synthetic_1' });
  results.subscriptions = { data: null, error: DB_ERROR };
  await assert.rejects(
    () => hadTrialOrActiveSubscription('suberr@synthetic.test'),
    (e) => e.code === 'PLAN_UNAVAILABLE'
  );
  results.subscriptions = { data: null, error: null };
});

test('a VERIFIED no-customer (PGRST116) is still eligible for the first trial', async () => {
  results.customers = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  results.subscriptions = { data: null, error: null };
  assert.equal(await hadTrialOrActiveSubscription('norow@synthetic.test'), false);
  results.customers = { data: null, error: null };
});
