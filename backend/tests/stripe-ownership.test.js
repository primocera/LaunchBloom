// ---------------------------------------------------------------------------
// SV-01 (v20) — the canonical typed ownership service and legacy backfill planner.
//
// These lock the ownership rule as ONE pure decision table with distinct typed
// states (owned / foreign / legacy_mapped / legacy_price / ambiguous), the
// non-negotiable that email and price are never sufficient proof, and that
// ambiguous/foreign objects are never adopted by the backfill.
// ---------------------------------------------------------------------------

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ownership = require('../lib/stripe-ownership');
const { planBackfill } = require('../scripts/backfill-stripe-ownership');
const { OWNERSHIP } = ownership;

const USER = '11111111-2222-3333-4444-555555555555';
const isConfiguredPrice = (id) => id === 'price_starter_m' || id === 'price_pro_m';
const sub = (metadata, priceId) => ({
  id: 'sub_x',
  metadata: metadata || {},
  items: priceId ? { data: [{ price: { id: priceId } }] } : undefined,
});

test('an exact source/scalvya stamp is OWNED — no email, no price needed', () => {
  assert.equal(ownership.classifySubscription(sub({ source: 'launchbloom' })), OWNERSHIP.OWNED);
  assert.equal(ownership.classifySubscription(sub({ scalvya: '1' })), OWNERSHIP.OWNED);
});

test('a foreign stamp is FOREIGN even on one of OUR configured prices', () => {
  assert.equal(ownership.classifySubscription(sub({ source: 'mellowa' }, 'price_starter_m'), { isConfiguredPrice }), OWNERSHIP.FOREIGN);
  assert.equal(ownership.classifySubscription(sub({ supabase_user_id: 'm' }, 'price_pro_m'), { isConfiguredPrice }), OWNERSHIP.FOREIGN);
  assert.equal(ownership.classifySubscription(sub({ app: 'frost' }), { isConfiguredPrice }), OWNERSHIP.FOREIGN);
});

test('conflicting exact+foreign stamps are AMBIGUOUS, never OWNED (no laundering)', () => {
  assert.equal(ownership.classifySubscription(sub({ source: 'launchbloom', mellowa: '1' })), OWNERSHIP.AMBIGUOUS);
  assert.equal(ownership.classifySubscription(sub({ scalvya: '1', supabase_user_id: 'm' })), OWNERSHIP.AMBIGUOUS);
});

test('a configured price with no foreign stamp is the narrow LEGACY_PRICE fallback', () => {
  assert.equal(ownership.classifySubscription(sub({}, 'price_starter_m'), { isConfiguredPrice }), OWNERSHIP.LEGACY_PRICE);
  // bare app_user_id is NOT sufficient proof on its own
  assert.equal(ownership.classifySubscription(sub({ app_user_id: USER }), { isConfiguredPrice }), OWNERSHIP.FOREIGN);
});

test('an explicit owner-verified legacy mapping beats the generic price fallback', () => {
  const legacyMap = new Set(['sub_x']);
  assert.equal(ownership.classifySubscription(sub({}, 'price_mellowa'), { isConfiguredPrice, legacyMap }), OWNERSHIP.LEGACY_MAPPED);
});

test('an unconfigured price with no stamp is FOREIGN (fail safe)', () => {
  assert.equal(ownership.classifySubscription(sub({}, 'price_unknown'), { isConfiguredPrice }), OWNERSHIP.FOREIGN);
  assert.equal(ownership.classifySubscription(sub({})), OWNERSHIP.FOREIGN);
});

test('classifyCustomer requires exact source AND exact app_user_id — email is never proof', () => {
  assert.equal(ownership.classifyCustomer({ metadata: { source: 'launchbloom', app_user_id: USER } }, USER), OWNERSHIP.OWNED);
  // right app, wrong user
  assert.equal(ownership.classifyCustomer({ metadata: { source: 'launchbloom', app_user_id: 'other' } }, USER), OWNERSHIP.FOREIGN);
  // foreign app
  assert.equal(ownership.classifyCustomer({ metadata: { source: 'mellowa', app_user_id: USER } }, USER), OWNERSHIP.FOREIGN);
  // deleted object is never owned
  assert.equal(ownership.classifyCustomer({ deleted: true, metadata: { source: 'launchbloom', app_user_id: USER } }, USER), OWNERSHIP.FOREIGN);
});

test('classifyChargeMeta: OWNED/FOREIGN/AMBIGUOUS by stamp, null when undecided', () => {
  assert.equal(ownership.classifyChargeMeta({ metadata: { source: 'launchbloom' } }), OWNERSHIP.OWNED);
  assert.equal(ownership.classifyChargeMeta({ metadata: { source: 'mellowa' } }), OWNERSHIP.FOREIGN);
  assert.equal(ownership.classifyChargeMeta({ metadata: { scalvya: '1', frost: '1' } }), OWNERSHIP.AMBIGUOUS);
  assert.equal(ownership.classifyChargeMeta({ metadata: {} }), null);
});

test('isOwning grants only owned/legacy_mapped/legacy_price; unavailable/ambiguous fail closed', () => {
  assert.equal(ownership.isOwning(OWNERSHIP.OWNED), true);
  assert.equal(ownership.isOwning(OWNERSHIP.LEGACY_MAPPED), true);
  assert.equal(ownership.isOwning(OWNERSHIP.LEGACY_PRICE), true);
  assert.equal(ownership.isOwning(OWNERSHIP.AMBIGUOUS), false);
  assert.equal(ownership.isOwning(OWNERSHIP.UNAVAILABLE), false);
  assert.equal(ownership.isOwning(OWNERSHIP.FOREIGN), false);
});

// --- backfill planner --------------------------------------------------------

test('backfill adopts only safe legacy_price matches carrying a user id', () => {
  const plan = planBackfill([
    { id: 'sub_owned', metadata: { source: 'launchbloom' } },
    { id: 'sub_foreign', metadata: { source: 'mellowa' }, items: { data: [{ price: { id: 'price_starter_m' } }] } },
    { id: 'sub_legacy', metadata: { app_user_id: USER }, items: { data: [{ price: { id: 'price_pro_m' } }] } },
    { id: 'sub_legacy_nouser', metadata: {}, items: { data: [{ price: { id: 'price_pro_m' } }] } },
    { id: 'sub_ambiguous', metadata: { source: 'launchbloom', mellowa: '1' } },
  ], { isConfiguredPrice });

  assert.deepEqual(plan.adopt.map((a) => a.id), ['sub_legacy']);
  assert.equal(plan.adopt[0].app_user_id, USER);
  // ambiguous + user-less legacy price go to review, never adopt
  assert.deepEqual(plan.review.map((r) => r.id).sort(), ['sub_ambiguous', 'sub_legacy_nouser']);
  // owned + foreign are skipped
  assert.deepEqual(plan.skip.map((s) => s.id).sort(), ['sub_foreign', 'sub_owned']);
});

test('backfill is idempotent: an already-mapped id is skipped, never re-adopted', () => {
  const plan = planBackfill(
    [{ id: 'sub_legacy', metadata: { app_user_id: USER }, items: { data: [{ price: { id: 'price_pro_m' } }] } }],
    { isConfiguredPrice, legacyMap: new Set(['sub_legacy']) },
  );
  assert.equal(plan.adopt.length, 0);
  assert.deepEqual(plan.skip.map((s) => s.reason), ['already_mapped']);
});
