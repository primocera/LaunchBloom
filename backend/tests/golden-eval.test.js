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
