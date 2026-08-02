// ---------------------------------------------------------------------------
// Fail-closed launch configuration (playbook v6 Prompt 1; hardened v13 SC-P0-04).
//
// Modes:
//   test        — local/dev, or test-mode Stripe keys: permissive; problems
//                 are warnings so the app stays fully clickable.
//   preview     — NODE_ENV=production but Stripe is test-mode/missing (our
//                 current Vercel reality): permissive, banner flag exposed.
//   production  — NODE_ENV=production AND a LIVE Stripe key: any missing
//                 required configuration HARD-DISABLES checkout and AI
//                 generation. A warning is not a commercial control; real
//                 money must never move on a placeholder config.
//
// v13 SC-P0-04 — the safe default must not depend on remembering a flag:
//   * Enforcement is AUTOMATIC in production mode. ENFORCE_LAUNCH_CONFIG=1 can
//     only ADD enforcement outside production (to rehearse it); it can never
//     be the thing that turns production safety on.
//   * The only escape hatch is UNSAFE_SKIP_LAUNCH_CONFIG_CHECK, deliberately
//     named unsafe. It works in dev/test only and is REJECTED (start refused,
//     requests blocked) when NODE_ENV=production.
//   * Errors name the offending variable and a remediation category only —
//     never a value, so no secret can leak through a config error.
// ---------------------------------------------------------------------------

const { legalPlaceholders, legalUrls } = require('./brand');

/** Explicitly-unsafe bypass. Dev/test only — rejected in production. */
const UNSAFE_BYPASS = 'UNSAFE_SKIP_LAUNCH_CONFIG_CHECK';

function launchMode() {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (process.env.NODE_ENV === 'production') {
    return stripeKey.startsWith('sk_live') ? 'production' : 'preview';
  }
  return 'test';
}

/** The operator asked for the bypass (whether or not it is honoured). */
function bypassRequested() {
  return process.env[UNSAFE_BYPASS] === '1';
}

/** The bypass is honoured only outside production. */
function bypassAllowed() {
  return bypassRequested() && process.env.NODE_ENV !== 'production';
}

// Domains that mean "nobody filled this in yet", plus local addresses that can
// never be a paid production return URL.
const PLACEHOLDER_HOST = /(example\.(com|org|net)|yourdomain|your-domain|mydomain|changeme|placeholder|tbd|\.invalid|\.test)$|^(www\.)?(example|yourdomain)\./i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$|\.local$|\.localhost$/i;

/**
 * Validate a URL-valued env var. Returns a problem string (variable name +
 * category only, NEVER the value) or null.
 */
function urlProblem(name, raw, { label = name } = {}) {
  const value = String(raw || '').trim();
  if (!value) return `${label} not set`;
  let host;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return `${label} must be HTTPS`;
    host = u.hostname;
  } catch {
    return `${label} is not a valid absolute URL`;
  }
  if (LOCAL_HOST.test(host)) return `${label} points at localhost (not a public production URL)`;
  if (PLACEHOLDER_HOST.test(host)) return `${label} uses a placeholder domain`;
  return null;
}

/** Every problem that must be resolved before taking real money. */
function launchConfigProblems() {
  const problems = [];

  // An unsafe bypass in production is itself a blocking misconfiguration.
  if (process.env.NODE_ENV === 'production' && bypassRequested()) {
    problems.push(`unsafe: ${UNSAFE_BYPASS} must not be set in production`);
  }

  for (const missing of legalPlaceholders()) problems.push(`legal: ${missing} not set`);

  // Public legal documents must be reachable, public and real.
  const urls = legalUrls();
  for (const [key, name] of [['terms', 'BRAND_TERMS_URL'], ['privacy', 'BRAND_PRIVACY_URL']]) {
    const p = urlProblem(name, urls[key], { label: name });
    if (p) problems.push(`legal: ${p}`);
  }

  const pubProblem = urlProblem('PUBLIC_URL', process.env.PUBLIC_URL);
  if (pubProblem) problems.push(pubProblem);

  if (!process.env.ALLOWED_ORIGINS) problems.push('ALLOWED_ORIGINS not set (exact origins required)');
  else {
    for (const origin of process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)) {
      const p = urlProblem('ALLOWED_ORIGINS', origin);
      if (p) { problems.push(p.replace('ALLOWED_ORIGINS', 'ALLOWED_ORIGINS entry')); break; }
    }
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET not set');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('Supabase keys not set');
  if (!process.env.SESSION_SECRET) problems.push('SESSION_SECRET not set');
  if (!process.env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY not set (production must not serve mock output)');

  // Live/test key consistency: live secret key must pair with live price ids.
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const { missingStripeEnv } = require('./plan-catalog');
  const missingPrices = missingStripeEnv();
  if (stripeKey.startsWith('sk_live')) {
    for (const v of missingPrices) problems.push(`stripe: ${v} not set`);
  }

  // Enabled currency catalogs must be COMPLETE. A currency that is switched on
  // but not fully priced/verified is exactly how a buyer sees one currency and
  // is charged another (v13 SC-P0-03).
  if (process.env.EUR_PRICING_ENABLED === '1') {
    if (process.env.EUR_PRICES_VERIFIED !== '1') {
      problems.push('currency: EUR_PRICING_ENABLED set without EUR_PRICES_VERIFIED (run npm run verify-prices)');
    }
    for (const v of missingPrices) problems.push(`currency: EUR enabled but ${v} not set`);
  }

  return problems;
}

/**
 * Is fail-closed enforcement active for this process?
 * Production ALWAYS enforces. ENFORCE_LAUNCH_CONFIG=1 additionally opts a
 * non-production environment in (to rehearse the production behaviour).
 */
function launchConfigEnforced() {
  if (launchMode() === 'production') return true;
  if (bypassAllowed()) return false;
  return process.env.ENFORCE_LAUNCH_CONFIG === '1';
}

/**
 * Startup / deploy-time check. Runs automatically from server.js so a broken
 * paid production config is visible before the first checkout request.
 * Returns a result object; only the unsafe-bypass-in-production case is fatal
 * (it is an operator error that must never boot), everything else stays as a
 * loud error plus the request-time block below (defense in depth).
 */
function startupLaunchConfigCheck({ exit = true } = {}) {
  const mode = launchMode();
  const problems = launchConfigProblems();

  if (process.env.NODE_ENV === 'production' && bypassRequested()) {
    console.error(`[launch-config] ${UNSAFE_BYPASS} is set in production — refusing to start. Remove the variable.`);
    if (exit) process.exit(1);
    return { ok: false, fatal: true, mode, problems };
  }

  if (!problems.length) return { ok: true, fatal: false, mode, problems };

  const msg = `[launch-config] ${mode} mode: ${problems.length} launch-config problem(s): ${problems.join('; ')}`;
  if (launchConfigEnforced()) {
    console.error(`${msg} — checkout and AI generation are BLOCKED until these are fixed.`);
  } else {
    console.warn(`${msg} — allowed outside enforced mode; fix before charging real customers.`);
  }
  return { ok: false, fatal: false, mode, problems };
}

/**
 * Middleware: refuse money-taking and money-costing routes while required
 * configuration is missing. Automatic in production; warn-only in dev/preview
 * unless ENFORCE_LAUNCH_CONFIG=1.
 */
let warned = false;
function requireLaunchReady(kind) {
  return function (req, res, next) {
    const mode = launchMode();
    const problems = launchConfigProblems();
    if (!problems.length) return next();

    if (launchConfigEnforced()) {
      return res.status(503).json({
        error: kind === 'checkout'
          ? 'Checkout is temporarily unavailable. Your workspace and drafts are unaffected.'
          : 'Generation is temporarily unavailable. Your workspace and drafts are unaffected.',
        code: 'LAUNCH_CONFIG_INCOMPLETE',
        req_id: req.id,
      });
    }
    if (!warned) {
      warned = true;
      console.warn(`[launch-config] ${mode} mode with incomplete launch config (${problems.length} issue(s)) — allowed outside production:`, problems.join('; '));
    }
    next();
  };
}

module.exports = {
  UNSAFE_BYPASS,
  launchMode,
  launchConfigProblems,
  launchConfigEnforced,
  startupLaunchConfigCheck,
  bypassRequested,
  bypassAllowed,
  requireLaunchReady,
};
