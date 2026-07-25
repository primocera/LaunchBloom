// Playbook v6 Prompt 12 — golden structural eval gate (mock-mode; no live
// Anthropic calls in CI). Scores schema validity, claim safety and SEO
// honesty across representative briefs. A regression here must block release,
// so these are hard assertions, not warnings.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

delete process.env.ANTHROPIC_API_KEY; // force mock mode
process.env.NODE_ENV = 'test';

const { generateJson, validateAgainstSchema } = require('../lib/ai');
const {
  positioningSchema, offersSchema, websiteKitSchema, emailFlowSchema,
  socialCaptionSchema, creativeIdeasSchema, seoIdeasSchema,
} = require('../lib/schemas');
const { qualityWarnings } = require('../lib/quality-checks');
const { rejectFabricatedMetrics } = require('../lib/seo-provider');
const { REGISTRY, CURRENT_PROMPT_VERSION, activePromptVersion } = require('../lib/prompt-registry');

// Language that must never appear in generated output (claim safety).
const BANNED = /(guaranteed (results|income)|will rank|10x your|skyrocket|unleash|passive income guaranteed)/i;

const SCHEMAS = {
  positioning: positioningSchema,
  offers: offersSchema,
  website: websiteKitSchema,
  email_flow: emailFlowSchema,
  social: socialCaptionSchema,
  creative: creativeIdeasSchema,
  seo_ideas: seoIdeasSchema,
};

for (const [name, schema] of Object.entries(SCHEMAS)) {
  test(`golden: ${name} output is schema-valid and claim-safe`, async () => {
    const out = await generateJson({ system: 'test', prompt: 'test brief', schema });
    const problems = validateAgainstSchema(out, schema);
    assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
    assert.ok(!BANNED.test(JSON.stringify(out)), `${name}: banned claim language in output`);
  });
}

test('golden: SEO ideas contain no fabricated metrics or ranking promises', async () => {
  const out = await generateJson({ system: 'test', prompt: 'test brief', schema: seoIdeasSchema });
  const violations = rejectFabricatedMetrics(
    (out.items || []).map((i) => ({ keyword: i.keyword, title: i.seo_title, meta_description: i.meta_description }))
  );
  assert.deepEqual(violations, []);
});

test('golden: quality checks accept clean seo output shape', async () => {
  const out = await generateJson({ system: 'test', prompt: 'test brief', schema: seoIdeasSchema });
  const warnings = qualityWarnings('seo', { items: (out.items || []).map((i) => ({ ...i, title: i.seo_title })) });
  assert.deepEqual(warnings, []);
});

test('prompt registry: current version registered, immutable, and active', () => {
  assert.ok(REGISTRY[CURRENT_PROMPT_VERSION]);
  assert.equal(activePromptVersion(), process.env.AI_PROMPT_VERSION && REGISTRY[process.env.AI_PROMPT_VERSION]
    ? process.env.AI_PROMPT_VERSION : CURRENT_PROMPT_VERSION);
  // Frozen: attempted mutation must not change the entry.
  const entry = REGISTRY[CURRENT_PROMPT_VERSION];
  try { entry.change_note = 'tampered'; } catch { /* strict mode throws */ }
  assert.notEqual(entry.change_note, 'tampered');
});

test('prompt registry: unregistered env override falls back to current', () => {
  const prev = process.env.AI_PROMPT_VERSION;
  process.env.AI_PROMPT_VERSION = 'v999';
  try {
    delete require.cache[require.resolve('../lib/prompt-registry.js')];
    const { activePromptVersion: fresh } = require('../lib/prompt-registry.js');
    assert.equal(fresh(), CURRENT_PROMPT_VERSION);
  } finally {
    if (prev === undefined) delete process.env.AI_PROMPT_VERSION;
    else process.env.AI_PROMPT_VERSION = prev;
    delete require.cache[require.resolve('../lib/prompt-registry.js')];
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// v10 SC-03 — the golden campaign corpus as a release gate.
//
// The tests above prove generated output is schema-shaped. These prove the
// deterministic QUALITY GATE behaves: it catches the defects the product
// promises to catch, and — just as important — stays quiet on healthy
// campaigns. A checker that cries wolf gets ignored, which is indistinguishable
// from having no checker at all.
//
// No live model calls: the corpus is hand-written, so this costs nothing and
// cannot flake. It measures the gate, not the model.
// ═══════════════════════════════════════════════════════════════════════════

const { runConsistencyChecks, RULES_VERSION, FINDING_META } = require('../lib/consistency');
const { claimProvenanceWarnings } = require('../lib/quality-checks');
const { CORPUS_VERSION, FIXTURES, PROHIBITED_INVENTIONS } = require('./fixtures/golden-campaigns');

const codesOf = (findings) => [...new Set(findings.map((f) => f.code))].sort();

test('golden corpus: the baseline is pinned and broad enough to mean something', () => {
  assert.ok(FIXTURES.length >= 12, `corpus is ${FIXTURES.length} fixtures; the v10 floor is 12`);
  assert.match(CORPUS_VERSION, /^v\d+\.\d+$/, 'a shifting baseline must be version-stamped');
  // Every fixture id is unique, so a failure names exactly one case.
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, FIXTURES.length);
  // The sectors the pack calls for are all represented.
  const sectors = new Set(FIXTURES.map((f) => f.sector));
  for (const s of ['services', 'ecommerce', 'events', 'regulated', 'multi_audience']) {
    assert.ok(sectors.has(s), `corpus has no ${s} campaign`);
  }
  // Clean baselines exist — without them the gate could pass by flagging all.
  assert.ok(FIXTURES.filter((f) => f.expect.length === 0).length >= 4, 'too few clean fixtures to detect false positives');
});

for (const fixture of FIXTURES) {
  test(`golden corpus [${fixture.id}]: ${fixture.why}`, () => {
    const findings = runConsistencyChecks(fixture.campaign, fixture.assets);
    assert.deepEqual(
      codesOf(findings), [...fixture.expect].sort(),
      `${fixture.id}: expected ${fixture.expect.join(', ') || '(clean)'}`
    );
    // Every finding must be explainable to the user — no bare codes reach the UI.
    for (const f of findings) {
      assert.ok(FINDING_META[f.code], `${f.code} has no registered explanation`);
      assert.ok(f.why && f.resolution, `${f.code} must say what is wrong and what to do`);
      assert.equal(f.rule_version, RULES_VERSION, 'findings carry the rule version that produced them');
    }
  });
}

test('golden corpus: no fixture contains a prohibited invention', () => {
  // Guards the corpus itself. If a banned claim appears in the reference copy,
  // the fixture is the bug and every assertion built on it is worthless.
  for (const fixture of FIXTURES) {
    const blob = JSON.stringify(fixture.assets);
    for (const rx of PROHIBITED_INVENTIONS) {
      assert.ok(!rx.test(blob), `${fixture.id} contains prohibited claim language matching ${rx}`);
    }
  }
});

test('golden corpus: findings are deterministic and stably fingerprinted', () => {
  // A finding's fingerprint is what lets an acknowledgement survive a re-run.
  // If it moved between identical runs, resolved items would reappear forever.
  for (const fixture of FIXTURES) {
    const a = runConsistencyChecks(fixture.campaign, fixture.assets);
    const b = runConsistencyChecks(fixture.campaign, fixture.assets);
    assert.deepEqual(a.map((f) => f.fingerprint), b.map((f) => f.fingerprint), `${fixture.id} is not deterministic`);
  }
});

// ── Regression guards for the two failures the pack names explicitly ────────

test('golden regression: a fabricated statistic is flagged when the brief has no proof', () => {
  const pages = [{
    id: 'w1', title: 'Trusted by thousands',
    meta_description: 'Join 5,000+ customers and a 98% satisfaction rate.',
    cta: 'Start now',
  }];
  const warnings = claimProvenanceWarnings(pages, '');
  assert.ok(warnings.length > 0, 'an unsupported statistic must not pass silently');
});

test('golden regression: the same statistic passes once the brief supplies proof', () => {
  const pages = [{ id: 'w1', title: 'Trusted by thousands', meta_description: 'Join 5,000+ customers.', cta: 'Start now' }];
  const supported = claimProvenanceWarnings(pages, 'Owner-supplied export: 5,000+ customers as of 2026-06-30.');
  const unsupported = claimProvenanceWarnings(pages, '');
  assert.ok(supported.length < unsupported.length, 'supplied proof must reduce the warnings, or the check is noise');
});

test('golden regression: duplicate angles across social posts are flagged', () => {
  const { qualityWarnings: qw } = require('../lib/quality-checks');
  const post = (hook) => ({ hook, caption: 'A caption long enough to avoid unrelated checks.', cta: 'Learn more' });
  // Assert on the DUPLICATE signal specifically. A bare length > 0 would pass
  // on the unrelated caption warnings these items also produce, and would stay
  // green with duplicate detection deleted entirely.
  const dupeSignal = (warnings) => warnings.filter((w) => /same hook|distinct angle/i.test(w));

  const duplicated = dupeSignal(qw('social', {
    items: [
      post('Stop wasting money on ads that never convert'),
      post('Stop wasting money on ads that never convert'),
      post('Stop wasting money on ads that never convert'),
    ],
  }));
  assert.equal(duplicated.length, 3, 'each duplicated pair must be named: three posts, three pairs');

  const distinct = dupeSignal(qw('social', {
    items: [
      post('Your ad budget deserves a plan before it deserves a bigger number'),
      post('Three questions to ask before boosting another post today'),
      post('What a landing page must do before the traffic arrives at it'),
    ],
  }));
  assert.deepEqual(distinct, [], 'genuinely different angles must not be reported as duplicates');
});
