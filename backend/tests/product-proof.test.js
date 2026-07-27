// v11 SC-04 — the landing page's real-product proof must stay true.
//
// A proof section is the easiest place in a product to start lying: one
// invented number, one borrowed logo, one status that does not exist. These
// tests pin it to the product's own vocabulary and to synthetic data.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app-src');
const preview = fs.readFileSync(path.join(APP, 'components', 'ProductPreview.jsx'), 'utf8');
const landing = fs.readFileSync(path.join(APP, 'routes', 'Landing.jsx'), 'utf8');
const statusLabels = fs.readFileSync(path.join(APP, 'lib', 'status-labels.js'), 'utf8');

test('the proof section renders statuses through the canonical helper', () => {
  // Hard-coded label strings would drift the moment a status is renamed.
  assert.match(preview, /import \{ statusLabelFor \} from '\.\.\/lib\/status-labels'/);
  assert.match(preview, /statusLabelFor\(a\.status\)/);
  for (const literal of ['Draft', 'Needs review', 'Ready to export', 'Published']) {
    assert.ok(
      !new RegExp(`>${literal}<`).test(preview),
      `${literal} is written literally; it must come from statusLabelFor()`,
    );
  }
});

test('every status it shows is one the product actually has', () => {
  const used = [...preview.matchAll(/status:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 3, 'the sequence should show more than one state');
  for (const status of used) {
    assert.match(statusLabels, new RegExp(`\\b${status}:`), `unknown status "${status}"`);
  }
});

test('it shows the five canonical creation paths and no sixth', () => {
  const channels = [...preview.matchAll(/channel:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(channels, ['Website', 'Email', 'Social', 'Ads & Creative', 'SEO Ideas']);
});

test('it is labelled a product view, never a customer result', () => {
  assert.match(preview, /product view/i);
  assert.match(preview, /not a customer result/i);
});

test('it invents no metric, outcome, testimonial or logo', () => {
  const banned = [
    /\d+\s*%\s*(more|faster|increase|conversion|growth)/i,
    /saved? \d+ hours/i,
    /\btestimonial\b/i,
    /\b\d[\d,]*\s*(customers|users|agencies|brands)\b/i,
    /trusted by/i,
    /case stud/i,
    /\bROI\b/i,
  ];
  for (const pattern of banned) {
    assert.ok(!pattern.test(preview), `the proof section makes an unsupported claim: ${pattern}`);
  }
});

test('it repeats the launch-ready limitation rather than implying approval', () => {
  assert.match(preview, /never approved, compliant or published/i);
});

test('its data matches the synthetic fixture the authenticated matrix seeds', () => {
  const seed = fs.readFileSync(path.join(__dirname, '..', 'routes', 'e2e-seed.js'), 'utf8');
  // Same brand and campaign, so the public proof depicts what the fixture
  // really produces rather than a hand-written ideal.
  assert.match(seed, /Autumn cohort launch/);
  assert.match(preview, /Autumn cohort launch/);
  assert.match(seed, /One repeatable offer beats five scattered ones/);
  assert.match(preview, /One repeatable offer beats five scattered ones/);
});

test('it carries no real account email, URL or secret', () => {
  assert.ok(!/@(?!e2e\.invalid)[a-z0-9-]+\.[a-z]{2,}/i.test(preview), 'a real-looking email address appears');
  assert.ok(!/https?:\/\//i.test(preview), 'an external URL appears in a public fixture');
});

test('the landing page actually renders it', () => {
  assert.match(landing, /import ProductPreview from '\.\.\/components\/ProductPreview'/);
  assert.match(landing, /<ProductPreview \/>/);
});
