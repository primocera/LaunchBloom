// ---------------------------------------------------------------------------
// v10 SC-02: the campaign asset-row decisions, unit-tested.
//
// These live behind a login, and the Playwright harness is credential-free by
// design (auth validates sb_access against Supabase Auth), so a signed-in
// browser journey cannot run here. Keeping the logic pure is what makes it
// testable at all — the same approach as campaign-next-action.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The app is ESM/JSX; this module is plain ESM, so transpile the exports away
// rather than adding a build step to the test runner.
const SRC = path.join(__dirname, '..', '..', 'app-src', 'lib', 'asset-rows.js');
const code = fs.readFileSync(SRC, 'utf8').replace(/export function/g, 'function');
const module_ = {};
new Function('module', `${code}\nmodule.exports = { blockersByAsset, isStale };`)(module_);
const { blockersByAsset, isStale } = module_.exports;

test('a high-severity unacknowledged finding blocks export', () => {
  const map = blockersByAsset({
    findings: [{ severity: 'high', why: 'Price conflicts with the brief', assets: [{ table: 'website_pages', id: 'w1' }] }],
  });
  assert.equal(map['website_pages:w1'].label, 'Blocks export');
  assert.equal(map['website_pages:w1'].detail, 'Price conflicts with the brief');
});

test('an acknowledged finding is resolved and never a blocker', () => {
  const map = blockersByAsset({
    findings: [{ severity: 'high', status: 'acknowledged', why: 'Reviewed', assets: [{ table: 'website_pages', id: 'w1' }] }],
  });
  assert.deepEqual(map, {}, 'acknowledging is a decision, not a permanent flag');
});

test('the highest-ranked blocker wins when several apply to one asset', () => {
  const map = blockersByAsset({
    findings: [{ severity: 'high', why: 'Conflict', assets: [{ table: 'email_assets', id: 'e1' }] }],
    stale: [{ table: 'email_assets', id: 'e1' }],
    needs_review_assets: [{ table: 'email_assets', id: 'e1' }],
  });
  assert.equal(map['email_assets:e1'].label, 'Blocks export');
});

test('a stale asset outranks a merely edited one', () => {
  const map = blockersByAsset({
    stale: [{ table: 'social_assets', id: 's1' }],
    needs_review_assets: [{ table: 'social_assets', id: 's1' }],
  });
  assert.equal(map['social_assets:s1'].label, 'Brief changed since generated');
});

test('a low-severity finding asks for a decision rather than blocking', () => {
  const map = blockersByAsset({
    findings: [{ severity: 'low', code: 'tone_mismatch', assets: [{ table: 'seo_assets', id: 'q1' }] }],
  });
  assert.equal(map['seo_assets:q1'].label, 'Needs a decision');
  assert.equal(map['seo_assets:q1'].detail, 'tone mismatch', 'a bare code is humanised, never shown raw');
});

test('malformed review payloads never throw', () => {
  assert.deepEqual(blockersByAsset(null), {});
  assert.deepEqual(blockersByAsset({}), {});
  assert.deepEqual(blockersByAsset({ findings: [{ assets: [{ id: null }] }] }), {}, 'an asset with no table is skipped');
});

test('staleness compares brief versions and never guesses', () => {
  assert.equal(isStale({ brief_version: 1 }, { brief_version: 2 }), true);
  assert.equal(isStale({ brief_version: 2 }, { brief_version: 2 }), false);
  assert.equal(isStale({ brief_version: 3 }, { brief_version: 2 }), false, 'a newer asset is not stale');
  assert.equal(isStale({}, { brief_version: 2 }), false, 'an unknown version is not evidence of staleness');
  assert.equal(isStale({ brief_version: 1 }, {}), false);
  assert.equal(isStale(null, null), false);
});
