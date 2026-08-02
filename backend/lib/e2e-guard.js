// ---------------------------------------------------------------------------
// v12 SC-V12-03 — authenticated-E2E preflight and evidence, as pure functions.
//
// The runner (scripts/e2e-auth.mjs) supplies the environment and the Playwright
// result summary; this module decides what they mean. No I/O, no secrets read
// from anywhere but the passed-in env object, and nothing here ever returns a
// secret value — only presence, a project-ref comparison outcome, and counts.
//
// Three outcomes, kept distinct on purpose, because collapsing them is exactly
// how a signed-in suite that never ran got reported as green:
//
//   BLOCKED   — a precondition is missing (env, or the non-production marker).
//               Not a skip. The runner exits non-zero.
//   FORBIDDEN — the target is a known production or other-app project. The
//               runner refuses to seed it at all.
//   READY     — preconditions hold; Playwright may run.
//
// The database-level marker (backend/migrations/E2E_MARKER.sql) is still the
// ultimate backstop and cannot be faked by any environment variable. The
// project-ref denylist here is a second, earlier line: it lets the owner name
// the Scalvya-production and Mellowa-production refs so the runner refuses them
// before a single row is written, without the marker round-trip.
// ---------------------------------------------------------------------------

'use strict';

const REQUIRED_ENV = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'E2E_SEED_SECRET',
]);

const present = (v) => Boolean(String(v == null ? '' : v).trim());

/** Which required variables are absent. Presence only — never a value. */
function missingEnv(env = {}) {
  return REQUIRED_ENV.filter((name) => !present(env[name]));
}

/**
 * The Supabase project ref in a URL like https://abcdefgh.supabase.co -> "abcdefgh".
 * A ref is the subdomain and appears in the URL itself, so it is not a secret in
 * the way a key is — but this module still never prints it, only compares it.
 */
function projectRef(url) {
  const m = String(url || '').match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in|net)\b/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Refs the runner must refuse, supplied by the owner via
 * E2E_FORBIDDEN_SUPABASE_REFS (comma-separated). The owner lists their
 * Scalvya-production and Mellowa-production project refs here; nothing secret is
 * committed, and the value is read from the environment, not the repository.
 */
function forbiddenRefs(env = {}) {
  return String(env.E2E_FORBIDDEN_SUPABASE_REFS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A refusal reason when the target is a known production/other-app project, or
 * null. Never includes the ref itself in the message — only the outcome.
 */
function targetRefusal(env = {}) {
  const ref = projectRef(env.SUPABASE_URL);
  if (!ref) return null; // local stack / unknown host — the DB marker still guards it
  if (forbiddenRefs(env).includes(ref)) {
    return 'target Supabase project matches a forbidden production/other-app reference '
      + '(E2E_FORBIDDEN_SUPABASE_REFS) — refusing to seed it';
  }
  return null;
}

// v13 SC-P1-08 — an UNRECOGNIZED target is refused, not treated as local.
//
// projectRef() returns null for two very different things: a genuine local
// Supabase stack (http://127.0.0.1:54321) and any other host we do not
// recognise — including a production database behind a custom domain or a
// proxy. Letting the second case through as "local" meant the seeding runner's
// only remaining protection was the DB marker. The runner now refuses anything
// that is neither a Supabase project ref (where the denylist applies) nor a
// loopback/local host.
const LOCAL_HOSTNAMES = Object.freeze([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal',
]);

/** True for a loopback / developer-machine URL. */
function isLocalUrl(url) {
  try {
    const host = new URL(String(url)).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return LOCAL_HOSTNAMES.includes(host) || host.endsWith('.local') || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** A refusal reason when SUPABASE_URL is neither a Supabase project nor local. */
function unrecognizedTargetRefusal(env = {}) {
  const url = String(env.SUPABASE_URL || '');
  if (projectRef(url)) return null; // a real project — the denylist decides
  if (isLocalUrl(url)) return null; // a local stack
  return 'SUPABASE_URL is neither a recognized Supabase project nor a local stack '
    + '— refusing to seed an unrecognized target';
}

/**
 * A refusal reason when an explicit E2E_BASE_URL points off the machine. The
 * authenticated matrix starts its own server on 127.0.0.1; pointing it at a
 * deployed origin would drive a real (possibly production) app.
 */
function baseUrlRefusal(env = {}) {
  const base = String(env.E2E_BASE_URL || '').trim();
  if (!base) return null;
  if (isLocalUrl(base)) return null;
  return 'E2E_BASE_URL points at a non-local origin — the authenticated matrix may only '
    + 'run against the locally started app';
}

/** Whether the run is a release-candidate gate, where any skip is a hard failure. */
function isReleaseGate(env = {}) {
  return String(env.RC_GATE || '') === '1';
}

/**
 * Classify preconditions before Playwright is launched.
 * Returns { state: 'BLOCKED' | 'FORBIDDEN' | 'READY', reason: string|null }.
 */
function preflight(env = {}) {
  const missing = missingEnv(env);
  if (missing.length) {
    return { state: 'BLOCKED', reason: `missing environment: ${missing.join(', ')}` };
  }
  const refusal = targetRefusal(env) || unrecognizedTargetRefusal(env) || baseUrlRefusal(env);
  if (refusal) return { state: 'FORBIDDEN', reason: refusal };
  return { state: 'READY', reason: null };
}

/**
 * Decide the process outcome from a Playwright run summary and the environment.
 * In release-candidate mode a skipped required test is a failure, because a
 * required journey that did not execute is not evidence it works.
 * Returns { ok: boolean, exitCode: number, reasons: string[] }.
 */
function classifyRun(summary = {}, env = {}) {
  const failed = Number(summary.failed || 0);
  const skipped = Number(summary.skipped || 0);
  const passed = Number(summary.passed || 0);
  const reasons = [];

  if (failed > 0) reasons.push(`${failed} test(s) failed`);
  if (passed === 0 && failed === 0) reasons.push('no tests executed');
  if (isReleaseGate(env) && skipped > 0) {
    reasons.push(`${skipped} required test(s) skipped — a skip cannot satisfy a release-candidate gate`);
  }

  return { ok: reasons.length === 0, exitCode: reasons.length === 0 ? 0 : 1, reasons };
}

/**
 * The environment class of the E2E target. The marker and the ref denylist both
 * enforce that this is never production, so the class is asserted as
 * non_production for a real run and 'unknown' only before preflight passes.
 */
function environmentClass(env = {}) {
  const ref = projectRef(env.SUPABASE_URL);
  if (present(env.SUPABASE_URL) && !ref) return 'non_production_local';
  return 'non_production';
}

/**
 * Machine-readable evidence for docs/launch — candidate SHA, environment class,
 * project names, counts and timestamps. Never a secret value or user datum.
 */
function buildEvidence({ sha, env = {}, projects = [], summary = {}, startedAtUtc, endedAtUtc }) {
  return {
    check: 'e2e_authenticated',
    candidate_sha: sha || null,
    environment_class: environmentClass(env),
    release_candidate_mode: isReleaseGate(env),
    projects: [...projects],
    counts: {
      passed: Number(summary.passed || 0),
      failed: Number(summary.failed || 0),
      skipped: Number(summary.skipped || 0),
      flaky: Number(summary.flaky || 0),
    },
    started_at_utc: startedAtUtc || null,
    ended_at_utc: endedAtUtc || null,
  };
}

module.exports = {
  REQUIRED_ENV,
  missingEnv,
  projectRef,
  forbiddenRefs,
  targetRefusal,
  isLocalUrl,
  unrecognizedTargetRefusal,
  baseUrlRefusal,
  isReleaseGate,
  preflight,
  classifyRun,
  environmentClass,
  buildEvidence,
};
