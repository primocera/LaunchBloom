// v5 Prompt 15 — legal configuration: placeholders are detected, /api/legal
// serves env-backed values, and no customer-facing legal page ships bracketed
// placeholder text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase, mockRes } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { legalPlaceholders } = require('../lib/brand');
const { legalHandler } = require('../routes/plans');

test('default (unconfigured) deployment reports the missing legal env vars', () => {
  const missing = legalPlaceholders();
  assert.ok(missing.includes('BRAND_LEGAL_NAME'));
  assert.ok(missing.includes('BRAND_LEGAL_ADDRESS'));
  assert.ok(missing.includes('BRAND_GOVERNING_LAW'));
});

test('GET /api/legal exposes entity config, version and configured flag', () => {
  const res = mockRes();
  res.set = () => res;
  legalHandler({}, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.version);
  assert.equal(res.body.configured, false);
  assert.ok(res.body.support_email.includes('@'));
});

test('v9 SC-00: /api/legal fails closed — no placeholder entity leaks when unconfigured', () => {
  const res = mockRes();
  res.set = () => res;
  legalHandler({}, res);
  assert.equal(res.body.configured, false);
  assert.equal(res.body.legal_name, null, 'unconfigured deployment must not emit an entity name');
  assert.equal(res.body.legal_address, '');
  assert.equal(res.body.governing_law, '');
});

test('v9 SC-00: no customer-facing file hardcodes a "legal entity TBD" fallback', () => {
  for (const rel of [['app-src', 'brand.js'], ['app-src', 'routes', 'Legal.jsx']]) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', ...rel), 'utf8');
    assert.ok(!/legal entity TBD/i.test(src), `${rel.join('/')} still hardcodes a placeholder entity`);
  }
});

test('legal pages contain no bracketed [PLACEHOLDER] text', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app-src', 'routes', 'Legal.jsx'), 'utf8');
  assert.ok(!src.includes('[PLACEHOLDER'), 'Legal.jsx still contains placeholder legal copy');
});

test('all footer legal links resolve to a defined document slug', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app-src', 'routes', 'Legal.jsx'), 'utf8');
  for (const slug of ['terms', 'privacy', 'cookies', 'ai-disclaimer', 'refund']) {
    assert.ok(src.includes(`/legal/${slug}`) || src.includes(`'${slug}'`), `missing legal doc: ${slug}`);
  }
});
