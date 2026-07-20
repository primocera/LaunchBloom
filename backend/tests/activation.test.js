const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveActivation, profileBaselineComplete } = require('../lib/activation');

const FULL_PROFILE = {
  business_type: 'ecommerce',
  products: 'Cooling towels',
  audience_segments: ['runners'],
  language: 'English',
};

test('profile baseline mirrors the frontend minimum-viable rules (incl. structured records)', () => {
  assert.equal(profileBaselineComplete(null), false);
  assert.equal(profileBaselineComplete(FULL_PROFILE), true);
  assert.equal(profileBaselineComplete({ ...FULL_PROFILE, products: '' }), false);
  // structured records satisfy product/audience/language too
  assert.equal(profileBaselineComplete({
    brand_name: 'X',
    products_list: [{ name: 'Towel' }],
    audiences: [{ name: 'Runners' }],
    languages: ['en'],
  }), true);
});

test('activation is fully derived — four steps, resume at first incomplete', () => {
  const a = deriveActivation({ profile: null, campaigns: [], assetCount: 0, reviewedCount: 0 });
  assert.equal(a.total, 4);
  assert.equal(a.done, 0);
  assert.equal(a.next.key, 'brand_baseline');
  assert.ok(a.steps.every((s) => s.to && s.hint));
});

test('steps flip from real state; approved-but-archived campaigns do not count', () => {
  const a = deriveActivation({
    profile: FULL_PROFILE,
    campaigns: [{ brief_approved: true, archived: true }],
    assetCount: 0,
    reviewedCount: 0,
  });
  assert.equal(a.steps.find((s) => s.key === 'brand_baseline').done, true);
  assert.equal(a.steps.find((s) => s.key === 'campaign_brief').done, false);
  assert.equal(a.next.key, 'campaign_brief');
});

test('a completed loop reports done and no next step', () => {
  const a = deriveActivation({
    profile: FULL_PROFILE,
    campaigns: [{ brief_approved: true, archived: false }],
    assetCount: 3,
    reviewedCount: 1,
  });
  assert.equal(a.done, 4);
  assert.equal(a.next, null);
});
