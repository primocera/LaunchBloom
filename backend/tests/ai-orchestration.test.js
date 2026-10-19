const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { validateAgainstSchema, generateJson, AI_PROMPT_VERSION } = require('../lib/ai');

const schema = {
  type: 'object',
  required: ['title', 'items'],
  properties: {
    title: { type: 'string' },
    items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
  },
};

test('validateAgainstSchema passes valid data', () => {
  const errs = validateAgainstSchema({ title: 'Hi', items: ['a', 'b', 'c'] }, schema);
  assert.deepEqual(errs, []);
});

test('validateAgainstSchema flags missing required field', () => {
  const errs = validateAgainstSchema({ items: ['a', 'b', 'c'] }, schema);
  assert.ok(errs.some((e) => /title is required/.test(e)));
});

test('validateAgainstSchema flags wrong array count', () => {
  const errs = validateAgainstSchema({ title: 'Hi', items: ['a'] }, schema);
  assert.ok(errs.some((e) => /items needs ≥3/.test(e)));
});

test('validateAgainstSchema flags wrong types', () => {
  const errs = validateAgainstSchema({ title: 5, items: 'nope' }, schema);
  assert.ok(errs.some((e) => /title must be a string/.test(e)));
  assert.ok(errs.some((e) => /items must be an array/.test(e)));
});

test('mock mode (no API key, non-prod) returns schema-shaped data', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.NODE_ENV = 'development';
  const out = await generateJson({ system: 's', prompt: 'p', schema });
  assert.equal(typeof out.title, 'string');
  assert.equal(out.items.length, 3);
  if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
  process.env.NODE_ENV = prevEnv;
});

test('production without an API key refuses (no fabricated output)', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.NODE_ENV = 'production';
  await assert.rejects(() => generateJson({ system: 's', prompt: 'p', schema }), (e) => e.code === 'AI_NOT_CONFIGURED');
  if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
  process.env.NODE_ENV = prevEnv;
});

test('prompt version constant is exported', () => {
  assert.ok(AI_PROMPT_VERSION);
});

// Prompts tell the model to return "" for optional fields such as
// secondary_cta / exclusions. The validator must accept exactly what the prompt
// asks for, or every instruction-following answer fails as a 502.
test('validator accepts "" for allowEmpty fields and still rejects other empty required fields', () => {
  const { emailFlowSchema } = require('../lib/schemas');
  const email = {
    flow_type: 'welcome', email_order: 1, objective: 'Welcome', subject_line: 'Hi', subject_options: ['Hi', 'Hello'],
    preheader: 'p', headline: 'h', body_copy: 'Body.', cta: 'Start', secondary_cta: '', personalization_tokens: [],
    send_timing: 'day 0', segment: 'new', exclusions: '', design_notes: 'plain',
  };
  assert.deepEqual(validateAgainstSchema({ items: [email] }, emailFlowSchema), []);
  const problems = validateAgainstSchema({ items: [{ ...email, body_copy: '' }] }, emailFlowSchema);
  assert.deepEqual(problems, ['items[0].body_copy is required']);
});

test('allowEmpty is stripped from the schema sent to the API', () => {
  const { sanitizeSchema } = require('../lib/ai');
  const { emailFlowSchema, websiteKitSchema, socialCaptionSchema, campaignEmailSchema } = require('../lib/schemas');
  for (const s of [emailFlowSchema, websiteKitSchema, socialCaptionSchema, campaignEmailSchema]) {
    assert.ok(!JSON.stringify(sanitizeSchema(s)).includes('allowEmpty'));
  }
});
