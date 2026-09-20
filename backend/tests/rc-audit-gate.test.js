// v23 SV-23-02 — the production dependency audit must be a real, mandatory,
// fail-closed step of the release-candidate workflow, and check-audit.js must
// block on advisories and on an unavailable audit. These tests are the contract
// that stops the audit from being quietly dropped or turned into a no-op.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'release-candidate.yml');
const CHECK_AUDIT = path.join(ROOT, 'backend', 'scripts', 'check-audit.js');

function workflowText() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

// Return the YAML lines belonging to the step whose `- name:` matches `re`,
// i.e. from that `- name:` up to (but excluding) the next `- name:`.
function stepBlock(text, re) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*-\s*name:/.test(l) && re.test(l));
  assert.notEqual(start, -1, `no workflow step named /${re.source}/`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*-\s*name:/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('release-candidate workflow runs a real production audit step', () => {
  const text = workflowText();
  const block = stepBlock(text, /audit/i);
  assert.match(block, /npm audit --omit=dev/, 'audit step must run `npm audit --omit=dev`');
  assert.match(block, /check-audit\.js/, 'audit step must evaluate the result via check-audit.js (fail closed)');
});

test('the audit step is NOT neutralised by continue-on-error', () => {
  const text = workflowText();
  const block = stepBlock(text, /audit/i);
  assert.doesNotMatch(
    block,
    /continue-on-error\s*:\s*true/,
    'the audit step must not carry continue-on-error: true — that would let a vulnerable candidate stay green',
  );
});

test('the audit gate lives in the required candidate-gate job, before the heavy checks', () => {
  const text = workflowText();
  const jobIdx = text.indexOf('candidate-gate:');
  const auditIdx = text.search(/name:.*audit/i);
  const e2eIdx = text.search(/Public browser suite/);
  assert.ok(jobIdx !== -1 && auditIdx !== -1, 'candidate-gate job and audit step must exist');
  assert.ok(auditIdx > jobIdx, 'the audit step must be inside the candidate-gate job');
  assert.ok(auditIdx < e2eIdx, 'the audit step must run before the browser suite (fail fast)');
});

test('audit is recorded in the SHA-pinned evidence summary checks list', () => {
  const text = workflowText();
  assert.match(text, /checks=npm-audit,/, 'evidence summary must list npm-audit as an executed check');
  assert.match(text, /audit_artifact=audit-summary-/, 'evidence summary must name the SHA-pinned audit artifact');
});

// --- check-audit.js behaviour ---------------------------------------------

function runCheckAudit(rawJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const raw = path.join(dir, 'audit-TESTSHA.json');
  fs.writeFileSync(raw, rawJson);
  let code = 0;
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [CHECK_AUDIT, raw, 'TESTSHA'], { encoding: 'utf8' });
  } catch (err) {
    code = err.status;
    stdout = `${err.stdout || ''}${err.stderr || ''}`;
  }
  let summary = null;
  const summaryPath = path.join(dir, 'audit-summary-TESTSHA.json');
  if (fs.existsSync(summaryPath)) summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  return { code, stdout, summary };
}

test('check-audit: 0 advisories → exit 0, verdict pass, SHA-pinned summary', () => {
  const r = runCheckAudit(JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  }));
  assert.equal(r.code, 0);
  assert.ok(r.summary, 'must write a summary artifact');
  assert.equal(r.summary.verdict, 'pass');
  assert.equal(r.summary.total, 0);
  assert.equal(r.summary.candidate_sha, 'TESTSHA');
  assert.match(r.summary.generated_at_utc, /Z$/);
});

test('check-audit: any advisory → exit 1, verdict failed (fail closed)', () => {
  const r = runCheckAudit(JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 3, high: 0, critical: 0, total: 3 } },
  }));
  assert.equal(r.code, 1);
  assert.equal(r.summary.verdict, 'failed');
  assert.equal(r.summary.total, 3);
  assert.equal(r.summary.severity_counts.moderate, 3);
});

test('check-audit: empty output → exit 2, verdict unavailable (never a pass)', () => {
  const r = runCheckAudit('');
  assert.equal(r.code, 2);
  assert.equal(r.summary.verdict, 'unavailable');
});

test('check-audit: registry error object → exit 2, unavailable', () => {
  const r = runCheckAudit(JSON.stringify({ error: { code: 'ENETUNREACH', summary: 'registry unreachable' } }));
  assert.equal(r.code, 2);
  assert.equal(r.summary.verdict, 'unavailable');
});

test('check-audit: shapeless JSON (no vulnerabilities) → exit 2, unavailable', () => {
  const r = runCheckAudit(JSON.stringify({ something: 'else' }));
  assert.equal(r.code, 2);
  assert.equal(r.summary.verdict, 'unavailable');
});
