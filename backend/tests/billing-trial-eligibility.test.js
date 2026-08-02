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
