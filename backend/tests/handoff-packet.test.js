// v9 SC-07 — the professional handoff packet. Pure tests over the canonical
// manifest builder + deterministic fingerprint: same state → same fingerprint,
// a material change → a different one (so staleness is visible), unresolved
// items are never hidden, and analytics bands leak no counts.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
const { stubModule } = require('./helpers');
stubModule('lib/supabase.js', { from: () => ({}) }); // never called by the pure fns

const { handoffManifest, packetFingerprint, stableStringify, handoffBand } = require('../routes/campaigns');

const CAMPAIGN = {
  name: 'Summer Sale', objective: 'Sell the drop', audience: 'Gift buyers',
  offer_summary: 'Summer bundle', promo_terms: '20% off SUMMER20', key_message: 'Cooler summers',
  proof: '4.8 stars', restrictions: 'No health claims', markets: 'US', language: 'English',
  start_date: '2026-07-01', end_date: '2026-07-31', brief_approved: true, brief_approved_at: '2026-06-20T00:00:00Z',
};
const PLAN = [{ deliverable_code: 'email_flow', requirement_state: 'required' }];
const Q = () => ({
  assets: [
    { table: 'email_assets', title: 'Welcome', status: 'ready', archived: false, brief_snapshot_at: '2026-06-21T00:00:00Z' },
    { table: 'social_assets', title: 'Old teaser', status: 'draft', archived: true, brief_snapshot_at: null },
  ],
  blocking: [{ code: 'conflicting_cta_url', assets: [{ title: 'Welcome' }] }],
  findings: [{ code: 'audience_mismatch', status: 'acknowledged', severity: 'medium', assets: [{ title: 'Welcome' }] }],
  stale: [{ title: 'Welcome', changed: [{ field: 'promo_terms' }] }],
  needs_review_assets: [{ title: 'Welcome' }],
  evidence_reminders: [{ label: 'Trustpilot rating' }],
  evidence: [{ label: 'Trustpilot rating', type: 'review', checked_date: '2026-06-01', source_url: 'https://x.example.com', source_ref: null }],
});

test('the manifest splits included vs excluded (archived) assets', () => {
  const m = handoffManifest(CAMPAIGN, Q(), PLAN);
  assert.equal(m.included_assets.length, 1);
  assert.equal(m.included_assets[0].title, 'Welcome');
  assert.equal(m.excluded_assets.length, 1);
  assert.equal(m.excluded_assets[0].reason, 'archived');
});

test('unresolved items are never hidden from the manifest', () => {
  const m = handoffManifest(CAMPAIGN, Q(), PLAN);
  assert.equal(m.unresolved.blocking.length, 1);
  assert.equal(m.unresolved.findings[0].status, 'acknowledged'); // ack is disclosed, not erased
  assert.equal(m.unresolved.brief_changes[0].fields[0], 'promo_terms');
  assert.deepEqual(m.unresolved.needs_review, ['Welcome']);
  assert.deepEqual(m.unresolved.evidence_reminders, ['Trustpilot rating']);
});

test('responsibilities disclose that publishing/approval remain with the user', () => {
  const m = handoffManifest(CAMPAIGN, Q(), PLAN);
  assert.ok(m.responsibilities.some((r) => /not an approval/i.test(r)));
  assert.ok(m.responsibilities.some((r) => /Scalvya does none of these/i.test(r)));
});

test('the fingerprint is deterministic and order-independent', () => {
  const a = packetFingerprint(handoffManifest(CAMPAIGN, Q(), PLAN));
  const b = packetFingerprint(handoffManifest(CAMPAIGN, Q(), PLAN));
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{16}$/);
  // Property order in the input must not change the hash.
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
});

test('a material brief change produces a different fingerprint (staleness visible)', () => {
  const before = packetFingerprint(handoffManifest(CAMPAIGN, Q(), PLAN));
  const after = packetFingerprint(handoffManifest({ ...CAMPAIGN, promo_terms: '30% off WINTER30' }, Q(), PLAN));
  assert.notEqual(before, after);
});

test('resolving a blocker changes the fingerprint too', () => {
  const withBlock = packetFingerprint(handoffManifest(CAMPAIGN, Q(), PLAN));
  const q2 = Q(); q2.blocking = [];
  const cleared = packetFingerprint(handoffManifest(CAMPAIGN, q2, PLAN));
  assert.notEqual(withBlock, cleared);
});

test('analytics bands bucket counts without leaking exact numbers', () => {
  assert.equal(handoffBand(0), '0');
  assert.equal(handoffBand(2), '1-3');
  assert.equal(handoffBand(7), '4-10');
  assert.equal(handoffBand(50), '10+');
});
