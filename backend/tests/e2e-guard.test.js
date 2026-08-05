// v12 SC-V12-03 — the authenticated-E2E preflight, refusal and evidence logic.
//
// These are the decisions that keep a signed-in suite from being skipped
// silently or pointed at the wrong database: missing env is BLOCKED (non-zero),
// a production/other-app target is FORBIDDEN, a release-candidate run treats any
// skip as a failure, and the evidence it emits carries counts and identifiers
// but never a secret value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('../lib/e2e-guard');

const FULL_ENV = Object.freeze({
  SUPABASE_URL: 'https://e2ethrowaway.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  E2E_SEED_SECRET: 'x'.repeat(32),
});

test('missing environment is BLOCKED, and names only the absent variables', () => {
  const pre = guard.preflight({ ...FULL_ENV, SUPABASE_URL: '', E2E_SEED_SECRET: '' });
  assert.equal(pre.state, 'BLOCKED');
  assert.match(pre.reason, /SUPABASE_URL/);
  assert.match(pre.reason, /E2E_SEED_SECRET/);
  // Presence only — a set variable's value never appears.
  assert.ok(!pre.reason.includes('service-key'));
});

test('a fully configured throwaway target is READY', () => {
  assert.deepEqual(guard.preflight(FULL_ENV), { state: 'READY', reason: null });
});

test('a LIVE Stripe key is FORBIDDEN — the matrix must never touch live money', () => {
  const pre = guard.preflight({ ...FULL_ENV, STRIPE_SECRET_KEY: 'sk_live_ABC123deadbeef' });
  assert.equal(pre.state, 'FORBIDDEN');
  assert.match(pre.reason, /LIVE Stripe key/);
  // The key value itself is never echoed.
  assert.ok(!pre.reason.includes('ABC123deadbeef'));
});

test('a restricted LIVE Stripe key (rk_live_) is also FORBIDDEN', () => {
  assert.equal(guard.liveStripeRefusal({ STRIPE_SECRET_KEY: 'rk_live_zzz' }),
    guard.liveStripeRefusal({ STRIPE_SECRET_KEY: 'rk_live_zzz' }));
  assert.match(guard.liveStripeRefusal({ STRIPE_SECRET_KEY: 'rk_live_zzz' }), /LIVE Stripe key/);
});

test('a TEST-mode Stripe key does not trip the refusal', () => {
  assert.equal(guard.liveStripeRefusal({ STRIPE_SECRET_KEY: 'sk_test_abc' }), null);
  assert.equal(guard.liveStripeRefusal({}), null);
  assert.equal(guard.preflight({ ...FULL_ENV, STRIPE_SECRET_KEY: 'sk_test_abc' }).state, 'READY');
});

test('a project on the forbidden ref list is FORBIDDEN, and the ref is never printed', () => {
  const env = {
    ...FULL_ENV,
    SUPABASE_URL: 'https://scalvyaprod.supabase.co',
    E2E_FORBIDDEN_SUPABASE_REFS: 'scalvyaprod, mellowaprod',
  };
  const pre = guard.preflight(env);
  assert.equal(pre.state, 'FORBIDDEN');
  assert.match(pre.reason, /forbidden production\/other-app reference/);
  assert.ok(!pre.reason.includes('scalvyaprod'), 'the refusal must not echo the project ref');
});

test('the Mellowa project is refused just like Scalvya production', () => {
  const env = {
    ...FULL_ENV,
    SUPABASE_URL: 'https://mellowaprod.supabase.co',
    E2E_FORBIDDEN_SUPABASE_REFS: 'scalvyaprod,mellowaprod',
  };
  assert.equal(guard.preflight(env).state, 'FORBIDDEN');
});

test('an UNRECOGNIZED target (not a Supabase project, not local) is FORBIDDEN', () => {
  // v13 SC-P1-08: a production database behind a custom domain or proxy returns
  // no project ref and must NOT be waved through as if it were a local stack.
  const env = { ...FULL_ENV, SUPABASE_URL: 'https://db.customer-domain.example/rest/v1' };
  const pre = guard.preflight(env);
  assert.equal(pre.state, 'FORBIDDEN');
  assert.match(pre.reason, /unrecognized target/);
});

test('a non-local E2E_BASE_URL is FORBIDDEN — the matrix drives only the local app', () => {
  const env = { ...FULL_ENV, E2E_BASE_URL: 'https://app.scalvya.com' };
  const pre = guard.preflight(env);
  assert.equal(pre.state, 'FORBIDDEN');
  assert.match(pre.reason, /non-local origin/);
});

test('a local E2E_BASE_URL and a local stack both pass', () => {
  assert.equal(guard.baseUrlRefusal({ E2E_BASE_URL: 'http://127.0.0.1:4173' }), null);
  assert.equal(guard.baseUrlRefusal({ E2E_BASE_URL: 'http://localhost:4173' }), null);
  assert.equal(guard.isLocalUrl('http://127.0.0.1:54321'), true);
  assert.equal(guard.isLocalUrl('https://app.scalvya.com'), false);
});

test('projectRef extracts the subdomain and ignores non-Supabase hosts', () => {
  assert.equal(guard.projectRef('https://abcdefgh.supabase.co'), 'abcdefgh');
  assert.equal(guard.projectRef('https://abcdefgh.supabase.co/rest/v1'), 'abcdefgh');
  assert.equal(guard.projectRef('http://127.0.0.1:54321'), null);
  assert.equal(guard.projectRef(''), null);
});

test('a local Supabase stack is allowed but classed as non_production_local', () => {
  const env = { ...FULL_ENV, SUPABASE_URL: 'http://127.0.0.1:54321' };
  assert.equal(guard.preflight(env).state, 'READY');
  assert.equal(guard.environmentClass(env), 'non_production_local');
});

test('a cloud target is classed non_production (the marker and denylist enforce it)', () => {
  assert.equal(guard.environmentClass(FULL_ENV), 'non_production');
});

test('a failed test always fails the run, in any mode', () => {
  const r = guard.classifyRun({ passed: 5, failed: 1, skipped: 0 }, FULL_ENV);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.match(r.reasons.join(' '), /1 test\(s\) failed/);
});

test('no tests executed is a failure, never a silent pass', () => {
  const r = guard.classifyRun({ passed: 0, failed: 0, skipped: 0 }, FULL_ENV);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /no tests executed/);
});

test('a skip passes an ordinary run but FAILS a release-candidate gate', () => {
  const summary = { passed: 20, failed: 0, skipped: 3 };
  assert.equal(guard.classifyRun(summary, FULL_ENV).ok, true, 'ordinary run tolerates a skip');

  const rc = guard.classifyRun(summary, { ...FULL_ENV, RC_GATE: '1' });
  assert.equal(rc.ok, false, 'a release-candidate gate must not tolerate a skip');
  assert.match(rc.reasons.join(' '), /3 required test\(s\) skipped/);
});

test('a clean pass is ok even in release-candidate mode', () => {
  const rc = guard.classifyRun({ passed: 20, failed: 0, skipped: 0 }, { ...FULL_ENV, RC_GATE: '1' });
  assert.deepEqual(rc, { ok: true, exitCode: 0, reasons: [] });
});

test('evidence carries SHA, environment class, projects, counts and timestamps — never a secret', () => {
  const evidence = guard.buildEvidence({
    sha: 'a'.repeat(40),
    env: { ...FULL_ENV, RC_GATE: '1' },
    projects: ['authenticated', 'authenticated-mobile', 'authenticated-keyboard'],
    summary: { passed: 18, failed: 0, skipped: 0, flaky: 1 },
    startedAtUtc: '2026-08-01T00:00:00Z',
    endedAtUtc: '2026-08-01T00:05:00Z',
    artifactPaths: ['test-results/e2e-auth-report.json', 'playwright-report/'],
  });

  assert.equal(evidence.check, 'e2e_authenticated');
  assert.equal(evidence.candidate_sha, 'a'.repeat(40));
  assert.equal(evidence.environment_class, 'non_production');
  assert.equal(evidence.release_candidate_mode, true);
  assert.deepEqual(evidence.projects, ['authenticated', 'authenticated-mobile', 'authenticated-keyboard']);
  assert.equal(evidence.counts.passed, 18);
  assert.equal(evidence.counts.flaky, 1);
  assert.deepEqual(evidence.artifact_paths, ['test-results/e2e-auth-report.json', 'playwright-report/']);
  assert.equal(evidence.started_at_utc, '2026-08-01T00:00:00Z');

  // No secret value from the environment may appear anywhere in the evidence.
  const serialized = JSON.stringify(evidence);
  for (const secret of ['anon-key', 'service-key', FULL_ENV.E2E_SEED_SECRET]) {
    assert.ok(!serialized.includes(secret), `evidence leaked ${secret}`);
  }
});

test('the runner wires the guard — preflight, run classification and evidence', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'e2e-auth.mjs'), 'utf8');
  // A future refactor must not quietly drop the refusal, the RC-gate skip rule
  // or the evidence write and reintroduce silent skipping.
  assert.match(runner, /guard\.preflight\(/, 'the runner must classify preconditions');
  assert.match(runner, /FORBIDDEN/, 'the runner must refuse a forbidden target');
  assert.match(runner, /guard\.classifyRun\(/, 'the runner must apply the pass/fail/skip rule');
  assert.match(runner, /guard\.buildEvidence\(/, 'the runner must emit machine-readable evidence');
  assert.match(runner, /process\.exit\(1\)/, 'BLOCKED / REFUSED / FAIL must exit non-zero');
});
