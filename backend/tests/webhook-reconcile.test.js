// ---------------------------------------------------------------------------
// v18 S05 — pull-based webhook reconciliation diff (backend/lib/webhook-reconcile.js).
//
// The failure this guards against is silent: a subscription that exists and is
// paying in Stripe but was never mirrored locally because a webhook was missed.
// The diff must find it, reason-code it, and NEVER adopt a foreign product's
// subscription on the shared Stripe account.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { diffStripeVsLocal } = require('../lib/webhook-reconcile');
const { isOurSubscription } = require('../routes/webhooks');

const ours = (id, status, extra = {}) => ({ id, status, metadata: { scalvya: '1' }, customer: `cus_${id}`, ...extra });
const foreign = (id, status) => ({ id, status, metadata: { app: 'mellowa' }, customer: `cus_${id}` });

test('a Stripe subscription with no local row is a missing_local finding', () => {
  const { findings, counts } = diffStripeVsLocal({
    stripeSubs: [ours('sub_a', 'active')],
    localRows: [],
    isOwned: isOurSubscription,
  });
  assert.equal(counts.missing_local, 1);
  assert.deepEqual(findings, [{ reason: 'missing_local', subscription_id: 'sub_a', stripe_status: 'active', local_status: null }]);
});

test('a differing status is a status_drift finding', () => {
  const { findings, counts } = diffStripeVsLocal({
    stripeSubs: [ours('sub_b', 'active')],
    localRows: [{ stripe_subscription_id: 'sub_b', status: 'trialing' }],
    isOwned: isOurSubscription,
  });
  assert.equal(counts.status_drift, 1);
  assert.equal(findings[0].reason, 'status_drift');
  assert.equal(findings[0].stripe_status, 'active');
  assert.equal(findings[0].local_status, 'trialing');
});

test('a matched subscription is not a finding', () => {
  const { findings, counts } = diffStripeVsLocal({
    stripeSubs: [ours('sub_c', 'active')],
    localRows: [{ stripe_subscription_id: 'sub_c', status: 'active' }],
    isOwned: isOurSubscription,
  });
  assert.equal(findings.length, 0);
  assert.equal(counts.ok, 1);
});

test('a foreign subscription is skipped, never reconciled onto us', () => {
  // This is the shared-Stripe-account invariant: even if it is missing locally
  // (it should be — it is not ours), it must NOT become a missing_local repair.
  const { findings, counts } = diffStripeVsLocal({
    stripeSubs: [foreign('sub_m', 'active')],
    localRows: [],
    isOwned: isOurSubscription,
  });
  assert.equal(counts.foreign_skipped, 1);
  assert.equal(counts.owned, 0);
  assert.equal(findings.length, 0, 'a foreign subscription must never be adopted');
});

test('findings are deterministically ordered by subscription id', () => {
  const { findings } = diffStripeVsLocal({
    stripeSubs: [ours('sub_z', 'active'), ours('sub_a', 'active'), ours('sub_m', 'past_due')],
    localRows: [],
    isOwned: isOurSubscription,
  });
  assert.deepEqual(findings.map((f) => f.subscription_id), ['sub_a', 'sub_m', 'sub_z']);
});

test('malformed inputs degrade to an empty result rather than throwing', () => {
  for (const bad of [null, undefined, 42, 'x', {}]) {
    const { findings, counts } = diffStripeVsLocal({ stripeSubs: bad, localRows: bad, isOwned: isOurSubscription });
    assert.equal(findings.length, 0);
    assert.equal(counts.total, 0);
  }
});

test('mixed batch: real gaps found, foreign ignored, synced ignored', () => {
  const { counts } = diffStripeVsLocal({
    stripeSubs: [
      ours('sub_a', 'active'),                 // missing_local
      ours('sub_b', 'active'),                 // status_drift
      ours('sub_c', 'active'),                 // ok
      foreign('sub_m', 'active'),              // skipped
    ],
    localRows: [
      { stripe_subscription_id: 'sub_b', status: 'trialing' },
      { stripe_subscription_id: 'sub_c', status: 'active' },
    ],
    isOwned: isOurSubscription,
  });
  assert.deepEqual(counts, { total: 4, owned: 3, foreign_skipped: 1, missing_local: 1, status_drift: 1, ok: 1 });
});
