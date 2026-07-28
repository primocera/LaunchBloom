#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v8 LB-S10 — release readiness gate. Verifies a frozen commit is configured to
// take real money and run the derived-state features, WITHOUT printing any
// secret value (presence only). Exit 0 = ready, 1 = blocked.
//
//   node backend/scripts/release-check.js            (human report)
//   node backend/scripts/release-check.js --json      (machine report)
//
// This is a read-only inspector: it mutates nothing, calls no external system,
// and never runs a migration. Live steps stay owner-operated.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// The gate reads process.env, but only server.js loaded backend/.env — so run
// from a shell this script reported EVERY variable missing and always printed
// BLOCKED, whatever was configured. A gate that is red no matter what is worse
// than no gate: it teaches you to ignore it, and it made a genuine production
// misconfiguration indistinguishable from running the command.
//
// `override: false` is the point: a real environment (CI, Vercel, an exported
// shell) always wins over the local file, so this can only ever fill in gaps —
// it can never mask what production actually has set. Loaded before
// launch-config, which reads process.env at require time.
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false,
});

const { launchMode, launchConfigProblems } = require('../lib/launch-config');
const { RULES_VERSION } = require('../lib/consistency');
const { DEPENDENCIES_VERSION } = require('../lib/brief-impact');
const { missingStripeEnv } = require('../lib/plan-catalog');

// Migrations that must exist for the v8 value loop (names, not contents).
const REQUIRED_MIGRATIONS = [
  '028_campaign_deliverables.sql',
  '029_consistency_findings.sql',
  '030_brief_reviews.sql',
  '031_evidence.sql',
  '032_workspace_templates.sql',
  '033_analytics_dedupe.sql',
];

// present() reports whether an env var is set — never its value.
const present = (name) => Boolean(process.env[name] && String(process.env[name]).trim());

function collect() {
  const checks = [];
  const add = (name, ok, detail, level = 'blocker') =>
    checks.push({ name, ok: Boolean(ok), detail, level });

  const mode = launchMode();

  // 1. Required migrations are on disk (order + presence).
  const migDir = path.join(__dirname, '..', 'migrations');
  const onDisk = new Set(fs.readdirSync(migDir));
  for (const m of REQUIRED_MIGRATIONS) {
    add(`migration:${m}`, onDisk.has(m), onDisk.has(m) ? 'present' : 'MISSING from backend/migrations');
  }

  // 2. Rule/dependency versions are pinned (drift would silently reinterpret findings).
  add('rules:consistency_version', /^v\d/.test(RULES_VERSION), `RULES_VERSION=${RULES_VERSION}`);
  add('rules:dependencies_version', /^v\d/.test(DEPENDENCIES_VERSION), `DEPENDENCIES_VERSION=${DEPENDENCIES_VERSION}`);

  // 3. Legal + domain + core config (delegated to the fail-closed launch config).
  const cfgProblems = launchConfigProblems();
  add('launch:config', cfgProblems.length === 0,
    cfgProblems.length ? cfgProblems.join('; ') : 'all launch-config requirements met');

  // 4. Stripe live price allowlist — only enforced as a blocker under a live key.
  const liveStripe = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live');
  const missingPrices = missingStripeEnv();
  add('stripe:price_allowlist', !liveStripe || missingPrices.length === 0,
    liveStripe
      ? (missingPrices.length ? `missing: ${missingPrices.join(', ')}` : 'all live prices set')
      : 'test-mode key — live prices not required yet',
    liveStripe ? 'blocker' : 'external');

  // 5. Cron secret (backfills / lifecycle triggers must be authenticated).
  add('cron:secret', present('CRON_SECRET'), present('CRON_SECRET') ? 'set' : 'CRON_SECRET not set',
    mode === 'production' ? 'blocker' : 'external');

  // 6. Email delivery configuration (presence only).
  const emailOk = present('RESEND_API_KEY') && present('BRAND_SENDER_EMAIL');
  add('email:delivery', emailOk,
    emailOk ? 'Resend key + sender configured' : 'RESEND_API_KEY / BRAND_SENDER_EMAIL incomplete',
    mode === 'production' ? 'blocker' : 'external');

  // 7. v11 SC-06: a daily AI spend ceiling. Without one, a runaway loop or an
  //    abusive account spends real money with nothing to stop it — and the
  //    readiness endpoint has been reporting `ai_spend_ceiling_usd: not set`
  //    since v10. Presence is not enough: an unparseable or non-positive value
  //    disables the cap just as completely as an absent one, so the format is
  //    validated and anything invalid fails CLOSED.
  const ceiling = spendCeiling();
  add('ai:spend_ceiling', ceiling.ok, ceiling.detail,
    mode === 'production' ? 'blocker' : 'external');

  return { mode, checks };
}

// Bounded positive dollars per day. The upper bound is deliberate: a ceiling
// of 1e9 is a typo, not a policy, and would read as configured while capping
// nothing.
const MAX_SENSIBLE_CEILING_USD = 10000;

function spendCeiling() {
  const raw = process.env.AI_SPEND_DAILY_CEILING_USD;
  if (!raw || !String(raw).trim()) {
    return { ok: false, detail: 'AI_SPEND_DAILY_CEILING_USD not set — no daily cap on AI spend' };
  }
  const value = Number(String(raw).trim());
  if (!Number.isFinite(value)) {
    return { ok: false, detail: 'AI_SPEND_DAILY_CEILING_USD is not a number' };
  }
  if (value <= 0) {
    return { ok: false, detail: 'AI_SPEND_DAILY_CEILING_USD must be greater than 0' };
  }
  if (value > MAX_SENSIBLE_CEILING_USD) {
    return {
      ok: false,
      detail: `AI_SPEND_DAILY_CEILING_USD exceeds ${MAX_SENSIBLE_CEILING_USD} — that caps nothing in practice`,
    };
  }
  // The value itself is operational configuration, not a secret, and the
  // owner needs to see what was read to trust the gate.
  return { ok: true, detail: `daily ceiling set to $${value}` };
}

// v9 SC-00: a machine-readable release evidence record. Pins the commit SHA,
// migration set and built-bundle hash plus the deterministic check results, so
// a release can be reproduced and audited. Contains NO secrets — env vars are
// reported as presence booleans only (via collect()).
function releaseEvidence() {
  let commit = process.env.GITHUB_SHA || null;
  if (!commit) {
    try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
    catch { commit = null; }
  }

  const migDir = path.join(__dirname, '..', 'migrations');
  const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  // Built bundle hash: the vite output filenames already encode content hashes;
  // fold them into one deterministic digest of the release artifact.
  const assetsDir = path.join(__dirname, '..', '..', 'app', 'assets');
  let bundleFiles = [];
  try { bundleFiles = fs.readdirSync(assetsDir).sort(); } catch { /* not built */ }
  const buildHash = bundleFiles.length
    ? crypto.createHash('sha256').update(bundleFiles.join('|')).digest('hex').slice(0, 16)
    : null;

  const { mode, checks } = collect();
  const blockers = checks.filter((c) => !c.ok && c.level === 'blocker');
  return {
    generated_at: new Date().toISOString(),
    commit,
    mode,
    ready: blockers.length === 0,
    migrations,
    migration_count: migrations.length,
    build_hash: buildHash,
    bundle_files: bundleFiles,
    rules: { consistency: RULES_VERSION, dependencies: DEPENDENCIES_VERSION },
    checks,
  };
}

function main() {
  if (process.argv.includes('--evidence')) {
    const evidence = releaseEvidence();
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(evidence.ready ? 0 : 1);
  }
  const asJson = process.argv.includes('--json');
  const { mode, checks } = collect();
  const blockers = checks.filter((c) => !c.ok && c.level === 'blocker');
  const external = checks.filter((c) => !c.ok && c.level === 'external');
  const ready = blockers.length === 0;

  if (asJson) {
    console.log(JSON.stringify({ mode, ready, blockers: blockers.length, external: external.length, checks }, null, 2));
  } else {
    console.log(`\nRelease check — mode: ${mode}\n`);
    for (const c of checks) {
      const mark = c.ok ? 'PASS' : (c.level === 'external' ? 'EXTERNAL' : 'BLOCK');
      console.log(`  [${mark.padEnd(8)}] ${c.name} — ${c.detail}`);
    }
    console.log(`\n${ready ? 'READY (automated gates)' : `BLOCKED — ${blockers.length} blocker(s)`}` +
      (external.length ? `; ${external.length} owner/external action(s) outstanding` : '') + '\n');
    console.log('Note: automated readiness is NOT a paid-launch GO. A live low-value');
    console.log('checkout + cancel/recover rehearsal with owner-recorded evidence is required.\n');
  }
  process.exit(ready ? 0 : 1);
}

if (require.main === module) main();

module.exports = { collect, releaseEvidence, REQUIRED_MIGRATIONS, spendCeiling, MAX_SENSIBLE_CEILING_USD };
