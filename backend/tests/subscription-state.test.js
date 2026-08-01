// v12 SC-V12-04 — the canonical subscription state machine.
//
// Entitlement must be a pure function of the mirrored row's status and price,
// so planFor() and the webhook handler can never disagree about what a given
// Stripe state grants.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  entitlementFor, isEntitled, isStale, ENTITLING_STATUSES, KNOWN_STATUSES,
} = require('../lib/subscription-state');

const PLANS = { price_pro: 'pro', price_starter: 'starter' };

test('only active and trialing grant access', () => {
  assert.deepEqual([...ENTITLING_STATUSES], ['active', 'trialing']);
  assert.equal(isEntitled('active'), true);
  assert.equal(isEntitled('trialing'), true);
  for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(isEntitled(status), false, `${status} must not grant access`);
  }
});

test('trialing grants the limited trial plan on any price', () => {
  assert.equal(entitlementFor({ status: 'trialing', stripe_price_id: 'price_pro' }, PLANS), 'trial');
  assert.equal(entitlementFor({ status: 'trialing', stripe_price_id: 'anything' }, PLANS), 'trial');
});

test('active maps its price to a plan', () => {
  assert.equal(entitlementFor({ status: 'active', stripe_price_id: 'price_pro' }, PLANS), 'pro');
  assert.equal(entitlementFor({ status: 'active', stripe_price_id: 'price_starter' }, PLANS), 'starter');
});

test('active on an UNMAPPED price grants nothing — never a silent default', () => {
  assert.equal(entitlementFor({ status: 'active', stripe_price_id: 'price_unknown' }, PLANS), null);
  assert.equal(entitlementFor({ status: 'active', stripe_price_id: undefined }, PLANS), null);
});

test('past_due revokes entitlement — this is the recovery-safety invariant', () => {
  // A failed payment holds access back until recovery flips the row to active.
  assert.equal(entitlementFor({ status: 'past_due', stripe_price_id: 'price_pro' }, PLANS), null);
});

test('canceled and unknown statuses grant nothing', () => {
  assert.equal(entitlementFor({ status: 'canceled', stripe_price_id: 'price_pro' }, PLANS), null);
  assert.equal(entitlementFor({ status: 'something_new', stripe_price_id: 'price_pro' }, PLANS), null);
  assert.equal(entitlementFor(null, PLANS), null);
  assert.equal(entitlementFor(undefined, PLANS), null);
});

test('KNOWN_STATUSES documents every status the mapping reasons about', () => {
  for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.ok(KNOWN_STATUSES.includes(s), `${s} should be documented`);
  }
});

test('isStale reflects out-of-order reconciliation, and a first event is never stale', () => {
  const older = '2026-08-01T00:00:00Z';
  const newer = '2026-08-01T01:00:00Z';
  assert.equal(isStale(newer, older), true, 'an older incoming event is stale against a newer stored one');
  assert.equal(isStale(older, newer), false, 'a newer incoming event is applied');
  assert.equal(isStale(null, older), false, 'no stored timestamp means nothing to be stale against');
});
