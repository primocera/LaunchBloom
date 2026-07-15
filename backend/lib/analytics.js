// ---------------------------------------------------------------------------
// Product analytics (audit Prompt 15): a single append-only events ledger,
// abstracted behind track() so a future provider swap doesn't touch call
// sites. Privacy rules: never pass prompt text, generated content, or full
// email addresses in `properties` — only small, non-content facts (plan,
// feature, interval, error codes, counts). Failures never break the request.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

// Events the client is allowed to fire directly via POST /api/events. Backend
// -only events (signup, generation_*, subscription_*, ...) are tracked from
// the routes/webhooks that already know they happened and are not listed here.
const CLIENT_EVENTS = new Set([
  'landing_pricing_viewed',
  'onboarding_started',
  'onboarding_step_completed',
  'onboarding_completed',
  // Beta feedback prompt (audit Prompt 18) — short user-typed message allowed.
  'feedback_submitted',
]);

async function track(event, { userId = null, workspaceId = null, properties = {} } = {}) {
  try {
    await supabase.from('analytics_events').insert({
      event: String(event).slice(0, 100),
      user_id: userId || null,
      workspace_id: workspaceId || null,
      properties: properties || {},
    });
  } catch (err) {
    console.error('[analytics] track failed', event, err.message);
  }
}

module.exports = { track, CLIENT_EVENTS };
