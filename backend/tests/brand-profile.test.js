const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { formatBrandContext } = require('../lib/brand-profile');

test('empty profile → no context, not flagged as present', () => {
  const r = formatBrandContext(null);
  assert.equal(r.hasProfile, false);
  assert.equal(r.text, '');
  assert.deepEqual(r.summary, []);

  const r2 = formatBrandContext({});
  assert.equal(r2.hasProfile, false);
});

test('populated profile builds ground-truth context + summary', () => {
  const r = formatBrandContext({
    brand_name: 'Bloom & Co',
    markets: ['US', 'UK'],
    words_to_avoid: ['cheap'],
    tone: 'warm, direct',
  });
  assert.equal(r.hasProfile, true);
  assert.match(r.text, /BRAND PROFILE/);
  assert.match(r.text, /Bloom & Co/);
  assert.match(r.text, /Target markets: US, UK/);
  // grounding rules must instruct placeholders, not invention
  assert.match(r.text, /bracketed placeholder/i);
  assert.match(r.text, /never invent/i);
  assert.ok(r.summary.includes('Brand name'));
  assert.ok(r.summary.includes('Target markets'));
});
