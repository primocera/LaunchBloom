// v11 SC-03 / v12 SC-V12-03 — run the authenticated browser matrix.
//
// A wrapper rather than an inline env assignment in package.json, because
// `E2E_AUTH=1 playwright test` is not portable to the shell npm uses on
// Windows, and a script that silently runs the WRONG projects would report a
// green public suite as if the signed-in journey had been covered.
//
// v12 adds three things the launch gate depends on:
//   - PASS / FAIL / BLOCKED / FORBIDDEN are distinct, and everything except a
//     clean pass exits non-zero. Missing env or a forbidden target never exits
//     zero as "skipped".
//   - RC_GATE=1 (release-candidate mode) makes any skipped required test a hard
//     failure — a required journey that did not execute is not evidence.
//   - Raw machine-readable evidence (candidate SHA, environment class, project
//     names, counts, timestamps) is written for docs/launch, with no secrets.

import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const guard = require('../backend/lib/e2e-guard.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS = ['authenticated', 'authenticated-mobile', 'authenticated-keyboard'];
const JSON_OUT = path.join(ROOT, 'test-results', 'e2e-auth-report.json');
const EVIDENCE_OUT = path.join(ROOT, 'test-results', 'e2e-auth-evidence.json');

function candidateSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function blocked(reason) {
  console.error('\nAUTHENTICATED E2E BLOCKED — the signed-in journey was NOT verified.\n');
  console.error(`${reason}\n`);
  console.error('This is a release blocker, not a skip. Record `e2e_authenticated` as');
  console.error('`skipped` in docs/launch/launch-state.json; the launch gate will hold');
  console.error('NO-GO / CONDITIONAL GO. See docs/RUNBOOK_AUTH_E2E.md.\n');
  process.exit(1);
}

// --- preflight: env present, and a target the runner is allowed to touch ----
const pre = guard.preflight(process.env);
if (pre.state === 'BLOCKED') {
  blocked(pre.reason);
}
if (pre.state === 'FORBIDDEN') {
  console.error('\nAUTHENTICATED E2E REFUSED — the configured target must not be seeded.\n');
  console.error(`${pre.reason}\n`);
  console.error('The authenticated matrix seeds and deletes data. It must point at a');
  console.error('DISPOSABLE non-production Supabase project — never Scalvya production and');
  console.error('never the Mellowa project. See docs/RUNBOOK_AUTH_E2E.md.\n');
  process.exit(1);
}

if (guard.isReleaseGate(process.env)) {
  console.log('\nRelease-candidate mode (RC_GATE=1): any skipped required test is a hard failure.\n');
}

// --- run Playwright, capturing a machine-readable report --------------------
mkdirSync(path.dirname(JSON_OUT), { recursive: true });
const startedAtUtc = new Date().toISOString();

// --workers=1: the three authenticated projects share ONE seeding webServer and
// each seeds/deletes its own auth user in afterEach. Run in parallel, a trailing
// request from a torn-down test races another test's seed and the shared server
// cold-starts under load — producing non-deterministic timeouts (billing) and
// focus-timing failures (keyboard) that all pass in isolation. A release-gate
// suite must be deterministic, so the authenticated matrix runs single-worker;
// the public suite (playwright.config.js) keeps workers:2. Speed is a non-issue
// here — this is a local, opt-in gate, not CI.
const child = spawn(
  'npx',
  ['playwright', 'test', '--workers=1', '--reporter=list,json', ...PROJECTS.flatMap((p) => ['--project', p])],
  {
    stdio: 'inherit',
    shell: true,
    cwd: ROOT,
    env: { ...process.env, E2E_AUTH: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: JSON_OUT },
  },
);

child.on('exit', (playwrightCode) => {
  const endedAtUtc = new Date().toISOString();
  const summary = summarize(JSON_OUT);

  // Evidence is written whatever the outcome — a failed or partial run is still
  // a fact worth pinning. Secrets never enter it: buildEvidence takes counts,
  // project names and the environment class, never values.
  const evidence = guard.buildEvidence({
    sha: candidateSha(),
    env: process.env,
    projects: PROJECTS,
    summary,
    startedAtUtc,
    endedAtUtc,
    // Report + traces (retained only on failure by playwright.config.js).
    artifactPaths: [
      path.relative(ROOT, JSON_OUT).replace(/\\/g, '/'),
      'test-results/',
      'playwright-report/',
    ],
  });
  writeFileSync(EVIDENCE_OUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`\nEvidence written to ${path.relative(ROOT, EVIDENCE_OUT)} (no secrets, counts only):`);
  console.log(`  SHA ${evidence.candidate_sha || 'unknown'} · ${evidence.environment_class} · `
    + `pass ${evidence.counts.passed} / fail ${evidence.counts.failed} / skip ${evidence.counts.skipped}`);

  const verdict = guard.classifyRun(summary, process.env);
  if (!verdict.ok) {
    console.error(`\nAUTHENTICATED E2E FAILED: ${verdict.reasons.join('; ')}\n`);
    process.exit(verdict.exitCode || 1);
  }
  // Honour Playwright's own exit code too (a non-zero we did not model).
  process.exit(playwrightCode ?? 0);
});

/** Reduce the Playwright JSON report to pass/fail/skip/flaky counts. */
function summarize(reportPath) {
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report.stats && typeof report.stats === 'object') {
      const s = report.stats;
      return {
        passed: s.expected || 0,
        failed: s.unexpected || 0,
        skipped: s.skipped || 0,
        flaky: s.flaky || 0,
      };
    }
  } catch {
    // No report means Playwright never produced results — treated as no run.
  }
  return { passed: 0, failed: 0, skipped: 0, flaky: 0 };
}
