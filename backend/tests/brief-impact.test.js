const test = require('node:test');
const assert = require('node:assert/strict');

const {
  briefDiffForAsset, diffFingerprint, campaignImpact, MATERIAL_FIELDS,
} = require('../lib/brief-impact');

const BRIEF = {
  offer_summary: 'Summer bundle', promo_terms: '20% off SUMMER20',
  key_message: 'Cooler summers', audience: 'busy parents',
  start_date: '2026-07-01', end_date: '2026-07-31', deadline: null, restrictions: '',
};
const snapOf = (over = {}) => ({ ...BRIEF, ...over });

test('a one-field CTA-relevant change identifies only dependent assets with exact old/new values', () => {
  const campaign = { ...BRIEF, promo_terms: '25% off SUMMER25' };
  const changed = briefDiffForAsset(campaign, 'email_assets', { id: 'e1', brief_snapshot: snapOf() });
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0], {
    field: 'promo_terms', label: 'Promo terms',
    old_value: '20% off SUMMER20', new_value: '25% off SUMMER25',
  });
  // promo_terms is not material for SEO ideas — not affected
  const seo = briefDiffForAsset(campaign, 'seo_assets', { id: 'q1', brief_snapshot: snapOf() });
  assert.deepEqual(seo, []);
});

test('assets without a snapshot are never marked stale (no false claims)', () => {
  assert.deepEqual(briefDiffForAsset(BRIEF, 'email_assets', { id: 'e1' }), []);
});

test('campaignImpact resolves each asset independently and never rewrites statuses', () => {
  const campaign = { ...BRIEF, audience: 'college students' };
  const impact = campaignImpact(campaign, {
    email_assets: [{ id: 'e1', subject_line: 'Hi', status: 'ready', brief_snapshot: snapOf() }],
    social_assets: [{ id: 's1', hook: 'Yo', status: 'draft', brief_snapshot: snapOf() }],
  }, []);
  assert.equal(impact.affected.length, 2);
  assert.equal(impact.open, 2);
  // customer-facing status is reported untouched
  assert.equal(impact.affected.find((a) => a.id === 'e1').status, 'ready');
  assert.ok(impact.affected.every((a) => a.review_state === 'review_brief_changes'));
});

test('keep-snapshot decisions hold only for the exact diff; further changes reopen', () => {
  const campaign1 = { ...BRIEF, audience: 'college students' };
  const asset = { id: 'e1', brief_snapshot: snapOf() };
  const changed1 = briefDiffForAsset(campaign1, 'email_assets', asset);
  const fp1 = diffFingerprint('email_assets', 'e1', changed1);

  const kept = campaignImpact(campaign1, { email_assets: [asset] },
    [{ asset_table: 'email_assets', asset_id: 'e1', diff_fingerprint: fp1, reviewed_at: 'now' }]);
  assert.equal(kept.affected[0].review_state, 'snapshot_kept');
  assert.equal(kept.open, 0);

  // brief changes again → new fingerprint → review reopens automatically
  const campaign2 = { ...campaign1, promo_terms: '50% off FLASH50' };
  const reopened = campaignImpact(campaign2, { email_assets: [asset] },
    [{ asset_table: 'email_assets', asset_id: 'e1', diff_fingerprint: fp1, reviewed_at: 'now' }]);
  assert.equal(reopened.affected[0].review_state, 'review_brief_changes');
  assert.equal(reopened.open, 1);
});

test('field-dependency mapping covers all five studios and is versioned', () => {
  assert.deepEqual(Object.keys(MATERIAL_FIELDS),
    ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets']);
  const { DEPENDENCIES_VERSION } = require('../lib/brief-impact');
  assert.ok(DEPENDENCIES_VERSION);
});

test('duplicate/restored assets are handled per-asset (same snapshot, distinct fingerprints)', () => {
  const campaign = { ...BRIEF, key_message: 'New message' };
  const a1 = { id: 'e1', brief_snapshot: snapOf() };
  const a2 = { id: 'e2', brief_snapshot: snapOf() }; // duplicate keeps the snapshot
  const impact = campaignImpact(campaign, { email_assets: [a1, a2] }, []);
  assert.equal(impact.affected.length, 2);
  assert.notEqual(impact.affected[0].diff_fingerprint, impact.affected[1].diff_fingerprint);
});
