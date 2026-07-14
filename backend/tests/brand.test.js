const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

// Guard (audit Prompt 2): the old "OfferFlow" brand must never return to any
// customer-facing surface. The whole frontend (app-src) is user-facing, plus
// the specific backend strings that reach customers (transactional email,
// Stripe app info, the AI system prompt).
//
// NOTE: infrastructure identifiers that are NOT customer-facing are
// intentionally excluded — e.g. the Supabase storage bucket name
// 'offerflow-data' (renaming it is a data migration, not a branding fix) and
// internal code comments.

const ROOT = path.join(__dirname, '..', '..');
const OLD_BRAND = /offerflow/i;

const FRONTEND_DIR = path.join(ROOT, 'app-src');
const BACKEND_CUSTOMER_FILES = [
  'backend/lib/brand.js',
  'backend/routes/webhooks.js', // welcome email
  'backend/lib/stripe.js',      // Stripe appInfo
  'backend/lib/ai.js',          // BASE_SYSTEM (affects generated output)
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('no OfferFlow branding in the frontend (app-src)', () => {
  const offenders = [];
  for (const file of walk(FRONTEND_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    if (OLD_BRAND.test(text)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `Old brand found in: ${offenders.join(', ')}`);
});

test('no OfferFlow branding in customer-facing backend strings', () => {
  const offenders = [];
  for (const rel of BACKEND_CUSTOMER_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (OLD_BRAND.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `Old brand found in: ${offenders.join(', ')}`);
});

test('brand config exposes the required customer-facing fields', () => {
  const { BRAND, emailFrom } = require('../lib/brand');
  for (const key of ['name', 'siteUrl', 'supportEmail', 'senderName', 'senderEmail', 'legalName']) {
    assert.ok(BRAND[key], `BRAND.${key} must be set`);
  }
  assert.equal(BRAND.name, 'LaunchBloom');
  assert.match(emailFrom(), /^LaunchBloom <.+@.+>$/);
});
