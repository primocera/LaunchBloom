// ---------------------------------------------------------------------------
// Product analytics (audit Prompt 15, hardened in v5 Prompt 18): a single
// append-only events ledger, abstracted behind track() so a future provider
// swap doesn't touch call sites.
//
// Privacy rules (enforced by sanitizeProperties, not just convention): never
// store prompt text, generated content, passwords, tokens or sensitive profile
// fields. Only small, non-content facts (plan, feature, interval, source, error
// codes, counts) survive. Failures never break the request.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

// ── Canonical funnel events, each with a documented definition (Prompt 18). ──
// The definition string is the single source of truth for what the event means.
const CANONICAL_EVENTS = {
  landing_viewed: 'The public landing page was rendered.',
  landing_pricing_viewed: 'The pricing section/plans were viewed.',
  signup_started: 'The user opened or began the signup form.',
  signup_completed: 'A new account row was created (pre-verification).',
  email_verified: 'The user confirmed their email via the verification link.',
  onboarding_started: 'The Brand Profile onboarding wizard was opened.',
  onboarding_step_completed: 'One onboarding step was completed.',
  onboarding_completed: 'The Brand Profile onboarding wizard was finished.',
  paywall_viewed: 'The trial paywall modal was shown before a generation.',
  checkout_started: 'A Stripe Checkout session was created.',
  checkout_completed: 'Stripe reported a completed checkout session.',
  trial_started: 'A subscription entered the trialing state.',
  first_generation: 'The account produced its first successful generation.',
  first_asset_saved: 'The account saved its first generated asset.',
  campaign_created: 'A campaign was created.',
  limit_reached: 'A plan limit was hit (402 UPGRADE).',
  subscription_activated: 'A subscription became active (paid).',
  subscription_canceled: 'A subscription was canceled or scheduled to cancel.',
  feedback_submitted: 'The user submitted beta feedback.',
};

// Activation (Prompt 18): a documented, testable definition.
const ACTIVATION = {
  definition: 'Verified account + minimum Brand Profile (business + one product + one audience) + at least one successfully saved generation.',
  isActivated({ emailVerified = false, brandProfileComplete = false, savedGenerations = 0 } = {}) {
    return Boolean(emailVerified) && Boolean(brandProfileComplete) && Number(savedGenerations) > 0;
  },
};

// Events the client is allowed to fire directly via POST /api/events. Backend
// -only events (signup, generation_*, subscription_*, …) are tracked from the
// routes/webhooks that already know they happened.
const CLIENT_EVENTS = new Set([
  'landing_viewed',
  'landing_pricing_viewed',
  'signup_started',
  'onboarding_started',
  'onboarding_step_completed',
  'onboarding_completed',
  'paywall_viewed',
  'feedback_submitted',
]);

// Keys that must never reach analytics (case-insensitive substring match).
const SENSITIVE_KEY = /pass|token|secret|api[_-]?key|session|prompt|content|body|copy|caption|headline|email|address|phone|name|profile|answer|offer_summary/i;
// Only these small primitive shapes are kept; everything else is dropped.
const MAX_STR = 120;

/**
 * Redact analytics properties: drop sensitive keys, drop nested objects/arrays,
 * coerce to short primitives. Pure and testable. Never throws.
 */
function sanitizeProperties(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out = {};
  let kept = 0;
  for (const [k, v] of Object.entries(props)) {
    if (kept >= 12) break;
    if (SENSITIVE_KEY.test(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue; // no nested content
    if (typeof v === 'string') {
      if (v.length > MAX_STR) continue; // long strings are likely content
      out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
    kept++;
  }
  return out;
}

async function track(event, { userId = null, workspaceId = null, properties = {} } = {}) {
  try {
    await supabase.from('analytics_events').insert({
      event: String(event).slice(0, 100),
      user_id: userId || null,
      workspace_id: workspaceId || null,
      properties: sanitizeProperties(properties),
    });
  } catch (err) {
    console.error('[analytics] track failed', event, err.message);
  }
}

module.exports = { track, sanitizeProperties, CLIENT_EVENTS, CANONICAL_EVENTS, ACTIVATION };
