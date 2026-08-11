// LB-V17-05 — the production-readiness evidence validator distinguishes a clean
// observed pass from a wrong-candidate, non-production, stale, not-ready,
// blocker-bearing, unattested or PII/secret-bearing record. Synthetic fixtures
// only; running this proves nothing about production — the owner observes that.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReadinessRecord, emptyRecord } = require('../lib/readiness-evidence');

const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-08-11T00:00:00Z');

function goodRecord(over = {}) {
  return {
    schema: 'readiness-record-1',
    candidate_sha: SHA,
    deploy_class: 'production',
    deploy_ref: 'deploy_9f2c',
    observed_at_utc: '2026-08-10T12:00:00Z',
    http_status: 200,
    ready: true,
    blocker_count: 0,
    blocker_categories: [],
    operator: 'PC',
    attestation: 'Observed against the deployed candidate; ready=true, 0 blockers.',
    ...over,
  };
}

const opts = { candidateSha: SHA, now: NOW };

test('a clean production-readiness record validates', () => {
  assert.deepEqual(validateReadinessRecord(goodRecord(), opts), []);
});

test('a wrong candidate is rejected', () => {
  const p = validateReadinessRecord(goodRecord({ candidate_sha: 'b'.repeat(40) }), opts);
  assert.ok(p.some((m) => /does not match the pinned candidate/.test(m)));
});

test('a non-production deploy class cannot satisfy the production gate', () => {
  const p = validateReadinessRecord(goodRecord({ deploy_class: 'preview' }), opts);
  assert.ok(p.some((m) => /cannot satisfy the production-readiness gate/.test(m)));
});

test('a stale observation is rejected', () => {
  const p = validateReadinessRecord(goodRecord({ observed_at_utc: '2026-07-01T00:00:00Z' }), opts);
  assert.ok(p.some((m) => /stale/.test(m)));
});

test('a future observation is rejected', () => {
  const p = validateReadinessRecord(goodRecord({ observed_at_utc: '2026-09-01T00:00:00Z' }), opts);
  assert.ok(p.some((m) => /future/.test(m)));
});

test('ready=false and blockers>0 are rejected', () => {
  const p1 = validateReadinessRecord(goodRecord({ ready: false }), opts);
  assert.ok(p1.some((m) => /ready is not true/.test(m)));
  const p2 = validateReadinessRecord(goodRecord({ blocker_count: 2, blocker_categories: ['config'] }), opts);
  assert.ok(p2.some((m) => /blocker_count/.test(m)));
  assert.ok(p2.some((m) => /outstanding blockers/.test(m)));
});

test('http_status other than 200 is rejected', () => {
  const p = validateReadinessRecord(goodRecord({ http_status: 503 }), opts);
  assert.ok(p.some((m) => /http_status/.test(m)));
});

test('a missing operator attestation is rejected', () => {
  const p = validateReadinessRecord(goodRecord({ operator: null, attestation: null }), opts);
  assert.ok(p.some((m) => /operator attestation handle is missing/.test(m)));
  assert.ok(p.some((m) => /attestation statement is missing/.test(m)));
});

test('PII, secrets, bearer tokens and full bodies are rejected', () => {
  assert.ok(validateReadinessRecord(goodRecord({ operator: 'owner@example.com' }), opts).some((m) => /email/.test(m)));
  assert.ok(validateReadinessRecord(goodRecord({ deploy_ref: 'sk_live_abc123DEF456' }), opts).some((m) => /secret/.test(m)));
  assert.ok(validateReadinessRecord(goodRecord({ attestation: 'Authorization: Bearer eyJhbGciOi.abc.def' }), opts).some((m) => /bearer token/.test(m)));
  assert.ok(validateReadinessRecord(goodRecord({ attestation: 'body was {"checks": {"db":"ok"}}' }), opts).some((m) => /response body/.test(m)));
});

test('the empty record skeleton is NOT_RUN (never a pass)', () => {
  const p = validateReadinessRecord(emptyRecord(SHA), opts);
  assert.ok(p.length > 0, 'a blank skeleton must not validate as ready');
});

test('the shipped template is a not-run skeleton, not a fabricated pass', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'evidence', 'readiness-record.template.json'), 'utf8'));
  const p = validateReadinessRecord(tpl, { candidateSha: SHA, now: NOW });
  assert.ok(p.length > 0, 'the template must not validate — it is a fill-in skeleton');
});
