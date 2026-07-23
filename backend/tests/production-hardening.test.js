// v9 SC-10 — production hardening: the readiness reporter is presence-only (no
// secret values), the admin readiness route reuses the single release-check
// source and audits access, and the owner runbooks exist with real evidence
// fields. Pure fs + the release-check module; no network, no secrets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { collect } = require('../scripts/release-check');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

test('collect() reports presence booleans and a mode, never a secret value', () => {
  const { mode, checks } = collect();
  assert.ok(['production', 'preview', 'development', 'test'].includes(mode) || typeof mode === 'string');
  assert.ok(Array.isArray(checks) && checks.length);
  for (const c of checks) {
    assert.equal(typeof c.ok, 'boolean', `${c.name}.ok must be boolean`);
    assert.ok(['blocker', 'external'].includes(c.level));
    // A secret value must never ride along in the detail string.
    assert.ok(!/sk_live|sk_test|whsec_|re_[a-z0-9]{8}|service_role|eyJ/i.test(c.detail || ''),
      `${c.name} detail may leak a secret: ${c.detail}`);
  }
});

test('the admin readiness route reuses release-check, audits, and leaks no content', () => {
  const admin = read('..', 'routes', 'admin.js');
  assert.match(admin, /\/api\/admin\/readiness/);
  assert.match(admin, /requireAuth, requireAdmin/);
  assert.match(admin, /require\('\.\.\/scripts\/release-check'\)/, 'must reuse the single release-check source');
  assert.match(admin, /audit\(req, 'readiness'\)/, 'admin access must be audited');
  // The readiness handler must not select customer content columns.
  const handler = admin.slice(admin.indexOf("'/api/admin/readiness'"), admin.indexOf("failed-generations"));
  assert.ok(!/body_copy|caption|primary_text|campaign\.name|evidence.*url/i.test(handler), 'no content in readiness');
});

test('the transaction-rehearsal runbook has real evidence fields and stays owner-operated', () => {
  const rb = read('..', '..', 'docs', 'RUNBOOK_TRANSACTION_REHEARSAL.md');
  assert.match(rb, /Frozen commit SHA/);
  for (const journey of ['Eligible 3-day trial', 'Payment failed', 'Recovery', 'Duplicate webhook event', 'Refund']) {
    assert.ok(rb.includes(journey), `runbook must rehearse: ${journey}`);
  }
  assert.match(rb, /must not run any step that mutates live/i, 'must forbid live mutation by the agent');
  assert.match(rb, /GO for cohort expansion/);
});

test('the incident runbook keeps signals secret-safe and content-free', () => {
  const rb = read('..', '..', 'docs', 'RUNBOOK_INCIDENTS.md');
  assert.match(rb, /without accessing customer content/i);
  assert.match(rb, /request ID/i);
  assert.match(rb, /readiness/);
  assert.match(rb, /no SLA is published unless it is operationally staffed/i);
});
