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

  return { mode, checks };
}

function main() {
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

module.exports = { collect, REQUIRED_MIGRATIONS };
