// v11 SC-01 — the acquisition path and the signup form's semantics.
//
// Source-level guarantees only; the geometry and keyboard behaviour these
// rules exist to produce are asserted in a real browser by
// e2e/signup-conversion.spec.js. Both are required: the stretched-checkbox
// defect was invisible to unit tests, and the CTA destination was invisible to
// the browser tests that only checked the fields existed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app-src');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const landing = read(path.join('routes', 'Landing.jsx'));
const signup = read(path.join('routes', 'Signup.jsx'));
const styles = read('styles.css');

test('every "Create my campaign" CTA sends an anonymous visitor to signup', () => {
  // Anchor on the CTA label so a new CTA cannot quietly reintroduce the detour.
  const ctas = [...landing.matchAll(/<Link\s+className="(lp-cta|lp-header-cta)"\s+to="([^"]+)"[^>]*>\s*Create my campaign/g)];
  assert.ok(ctas.length >= 3, `expected the header, hero and closing CTAs, found ${ctas.length}`);
  for (const [, cls, dest] of ctas) {
    assert.equal(dest, '/app/signup', `${cls} CTA points at ${dest}; anonymous visitors land on login there`);
  }
});

test('returning users still have an unambiguous, separately labelled login link', () => {
  assert.match(landing, /<Link to="\/app\/login">Sign in<\/Link>/);
  // Signup and login stay distinct routes — never one merged, ambiguous form.
  assert.match(signup, /Already have an account\? <Link to="\/app\/login">/);
});

test('the full-width text-input rule cannot stretch a checkbox', () => {
  assert.ok(
    styles.includes(".login-card input:not([type='checkbox'])"),
    '.login-card input must be scoped away from checkboxes',
  );
  // The unscoped form must not come back alongside it.
  assert.ok(
    !/\.login-card input\s*\{/.test(styles),
    'an unscoped `.login-card input {` rule would stretch the consent checkboxes again',
  );
});

test('the consent row pins the checkbox size and gives the label a 44px target', () => {
  const rule = styles.slice(styles.indexOf(".login-card .consent {"));
  assert.match(rule, /min-height:\s*44px/, 'the label is the interactive target and must be at least 44px tall');
  const box = styles.slice(styles.indexOf(".login-card .consent input[type='checkbox'] {"));
  assert.match(box, /flex:\s*0 0 18px/, 'the checkbox must not be flexible, or a parent can stretch it');
  assert.match(box, /width:\s*18px/);
  assert.match(styles, /\.login-card \.consent input\[type='checkbox'\]:focus-visible/, 'keyboard focus must be visible on the checkbox');
});

test('verification copy describes the cross-device behaviour the backend actually has', () => {
  // The link carries a token hash verified server-side (backend/routes/auth.js
  // /api/auth/callback), so it is not bound to the requesting device.
  assert.ok(!/on this device/i.test(signup), 'device-limiting verification copy is inaccurate');
  assert.match(signup, /any\s+device/i);
  assert.match(signup, /expire/i, 'the user must be told what to do when a link has expired');
  assert.match(signup, /only be used once/i);
});

test('verification copy promises nothing about delivery time or inbox placement', () => {
  for (const claim of [/within \d+ (seconds|minutes)/i, /check your spam/i, /arrives? instantly/i]) {
    assert.ok(!claim.test(signup), `unsupported delivery claim: ${claim}`);
  }
});

test('validation errors are announced and associated with the field that caused them', () => {
  assert.match(signup, /id="signup-error"/);
  assert.match(signup, /role="alert"/);
  assert.match(signup, /aria-describedby=\{describedBy\('accept'\)\}/, 'the consent error must point at the consent checkbox');
  assert.match(signup, /aria-invalid=\{invalid\('confirm'\)\}/);
  assert.match(signup, /aria-required="true"/);
});

test('a second submit cannot create a second account attempt', () => {
  assert.match(signup, /if \(busy\) return;/);
  assert.match(signup, /disabled=\{busy \|\|/);
});

test('consent is never pre-checked and the legal links stay in the label', () => {
  assert.match(signup, /useState\(false\);\s*\/\/|const \[accept, setAccept\] = useState\(false\)/);
  assert.match(signup, /I agree to the <Link to="\/legal\/terms">Terms<\/Link>/);
  assert.match(signup, /<Link to="\/legal\/privacy">Privacy Policy<\/Link>/);
  assert.match(signup, /\(optional\)/, 'the marketing opt-in must be visibly optional and separate');
});
