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
