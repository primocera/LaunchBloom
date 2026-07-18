// ---------------------------------------------------------------------------
// Fail-closed launch configuration (playbook v6, Prompt 1).
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
// ---------------------------------------------------------------------------

const { legalPlaceholders } = require('./brand');

function launchMode() {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (process.env.NODE_ENV === 'production') {
    return stripeKey.startsWith('sk_live') ? 'production' : 'preview';
  }
  return 'test';
}

/** Every problem that must be resolved before taking real money. */
function launchConfigProblems() {
  const problems = [];

  for (const missing of legalPlaceholders()) problems.push(`legal: ${missing} not set`);

  const publicUrl = process.env.PUBLIC_URL || '';
  if (!publicUrl) problems.push('PUBLIC_URL not set');
  else if (!publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must be HTTPS');

  if (!process.env.ALLOWED_ORIGINS) problems.push('ALLOWED_ORIGINS not set (exact origins required)');
  if (!process.env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET not set');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('Supabase keys not set');
  if (!process.env.SESSION_SECRET) problems.push('SESSION_SECRET not set');
  if (!process.env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY not set (production must not serve mock output)');

  // Live/test key consistency: live secret key must pair with live price ids.
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (stripeKey.startsWith('sk_live')) {
    const { missingStripeEnv } = require('./plan-catalog');
    for (const v of missingStripeEnv()) problems.push(`stripe: ${v} not set`);
  }

  return problems;
}

/**
 * Middleware: in real production (live Stripe key), refuse money-taking and
 * money-costing routes while required configuration is missing. In test and
 * preview modes it only warns once.
 */
let warned = false;
function requireLaunchReady(kind) {
  return function (req, res, next) {
    const mode = launchMode();
    const problems = launchConfigProblems();
    if (!problems.length) return next();

    if (mode === 'production') {
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

module.exports = { launchMode, launchConfigProblems, requireLaunchReady };
