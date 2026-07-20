const test = require('node:test');
const assert = require('node:assert/strict');

const { runConsistencyChecks, FINDING_META, RULES_VERSION } = require('../lib/consistency');

const CAMPAIGN = {
  id: 'c-1',
  audience: 'busy parents',
  offer_summary: 'Summer bundle',
  promo_terms: '20% off with code SUMMER20, ends July 31',
  proof: '4.8 stars from 900 reviews',
  key_message: 'Cooler summers',
  start_date: '2026-07-01',
  end_date: '2026-07-31',
};

const snap = (over = {}) => ({
  audience: 'busy parents', offer_summary: 'Summer bundle',
  promo_terms: '20% off with code SUMMER20, ends July 31',
  key_message: 'Cooler summers', start_date: '2026-07-01', end_date: '2026-07-31',
  deadline: null, ...over,
});

function codes(findings) { return findings.map((f) => f.code); }

test('a fully consistent campaign across three studios is clean — with honest wording', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    website_pages: [{ id: 'w1', title: 'Home', cta: 'Shop the sale https://shop.example.com/sale', brief_snapshot: snap() }],
    email_assets: [{ id: 'e1', subject_line: '20% off ends soon', body_copy: 'Use code SUMMER20 at https://shop.example.com/sale', cta: 'Shop now', brief_snapshot: snap() }],
    social_assets: [{ id: 's1', hook: 'Summer!', caption: '20% off with SUMMER20', cta: 'Shop the sale', brief_snapshot: snap() }],
  });
  assert.deepEqual(findings, []);
});

test('missing CTA is flagged per asset in CTA-carrying tables only', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    email_assets: [{ id: 'e1', subject_line: 'Hi', cta: '', brief_snapshot: snap() }],
    seo_assets: [{ id: 'q1', h1: 'Guide' }], // SEO ideas carry no CTA — not flagged
  });
  assert.deepEqual(codes(findings), ['missing_primary_cta']);
  assert.equal(findings[0].assets[0].table, 'email_assets');
});

test('conflicting destination URLs across channels are a high finding', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    website_pages: [{ id: 'w1', cta: 'Buy at https://shop.example.com/sale', brief_snapshot: snap() }],
    creative_assets: [{ id: 'a1', headline: 'Sale', primary_text: 'x', cta: 'Go to https://other.example.com/deal', brief_snapshot: snap() }],
  });
  const f = findings.find((x) => x.code === 'conflicting_cta_url');
  assert.ok(f);
  assert.equal(f.severity, 'high');
  assert.equal(f.assets.length, 2);
});

test('a different discount or promo code contradicts the brief', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    email_assets: [{ id: 'e1', subject_line: '30% off everything', cta: 'Shop', brief_snapshot: snap() }],
    social_assets: [{ id: 's1', caption: 'Use code WINTER50', cta: 'Shop', brief_snapshot: snap() }],
  });
  const hits = findings.filter((f) => f.code === 'promotion_term_mismatch');
  assert.equal(hits.length, 2);
  assert.match(hits[0].expected, /SUMMER20/);
});

test('an ISO date outside the campaign window is flagged', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    website_pages: [{ id: 'w1', title: 'Ends 2026-09-15', cta: 'Shop', brief_snapshot: snap() }],
  });
  const f = findings.find((x) => x.code === 'date_or_timezone_mismatch');
  assert.ok(f);
  assert.equal(f.observed, '2026-09-15');
});

test('proof placeholders without brief proof are unsupported claims', () => {
  const noProof = { ...CAMPAIGN, proof: '' };
  const findings = runConsistencyChecks(noProof, {
    website_pages: [{ id: 'w1', title: 'Loved by [number] customers', cta: 'Shop', brief_snapshot: snap() }],
  });
  assert.ok(codes(findings).includes('unsupported_claim_reference'));
});

test('leftover placeholders are flagged; audience snapshot drift is a review finding', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    email_assets: [{
      id: 'e1', subject_line: 'Hello [first name]', cta: 'Shop',
      brief_snapshot: snap({ audience: 'college students' }),
    }],
  });
  assert.ok(codes(findings).includes('unresolved_placeholder'));
  const aud = findings.find((f) => f.code === 'audience_mismatch');
  assert.equal(aud.expected, 'busy parents');
  assert.equal(aud.observed, 'college students');
  assert.equal(FINDING_META.audience_mismatch.ackable, true);
});

test('a materially changed brief marks assets with brief_snapshot_mismatch', () => {
  const findings = runConsistencyChecks(
    { ...CAMPAIGN, promo_terms: '25% off with code SUMMER25' },
    { social_assets: [{ id: 's1', caption: 'x', cta: 'Shop', brief_snapshot: snap() }] }
  );
  const f = findings.find((x) => x.code === 'brief_snapshot_mismatch');
  assert.ok(f);
  assert.match(f.observed, /promo_terms/);
});

test('recomputation is idempotent: same inputs produce identical fingerprints', () => {
  const input = {
    email_assets: [{ id: 'e1', subject_line: '30% off', cta: '', brief_snapshot: snap() }],
  };
  const a = runConsistencyChecks(CAMPAIGN, input);
  const b = runConsistencyChecks(CAMPAIGN, input);
  assert.deepEqual(a.map((f) => f.fingerprint), b.map((f) => f.fingerprint));
  assert.ok(a.every((f) => f.rule_version === RULES_VERSION));
});

test('fixing the issue changes the fingerprint set (resolved findings reopen on change)', () => {
  const broken = runConsistencyChecks(CAMPAIGN, {
    email_assets: [{ id: 'e1', subject_line: '30% off', cta: 'Shop', brief_snapshot: snap() }],
  });
  const fixed = runConsistencyChecks(CAMPAIGN, {
    email_assets: [{ id: 'e1', subject_line: '20% off', cta: 'Shop', brief_snapshot: snap() }],
  });
  assert.ok(broken.length > 0);
  assert.deepEqual(fixed, []);
});

test('every finding links to exact assets and explains itself', () => {
  const findings = runConsistencyChecks(CAMPAIGN, {
    creative_assets: [{ id: 'a1', headline: '50% off', primary_text: 'y', cta: '', brief_snapshot: snap() }],
  });
  for (const f of findings) {
    assert.ok(f.assets.length >= 1);
    assert.ok(f.assets[0].id);
    assert.ok(f.why && f.resolution && f.detection);
    assert.ok(['high', 'medium'].includes(f.severity));
  }
});
