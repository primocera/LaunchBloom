// ---------------------------------------------------------------------------
// v13 SC-P1-10 — the typed error-to-copy contract. Every critical failure or
// blank-slate state resolves to ONE structured object that answers the three
// questions a user actually has:
//   1. what happened (plain language, never raw provider/Stripe/Supabase text)
//   2. did I lose work / was I charged  (the `reassurance` line)
//   3. what can I do now                (the single `action`)
//
// This sits on top of microcopy.js (the string table) rather than duplicating
// strings: `message` is resolved through microcopy so the copy contract stays
// in one place, and this module adds the category + reassurance + recovery
// action that the UI and instrumentation share.
//
// `category` is a stable slug for analytics. It never carries campaign content.
// ---------------------------------------------------------------------------

import { microcopy, messageForError } from './microcopy.js';

/** Stable analytics slugs — one per required state. */
export const ERROR_CATEGORIES = {
  PLAN_VERIFICATION: 'plan_verification',
  CHECKOUT_CONFIG: 'checkout_config',
  GENERATION_FAILED: 'generation_failed',
  USAGE_LIMIT: 'usage_limit',
  EXPORT_FAILED: 'export_failed',
  EMPTY_WORKSPACE: 'empty_workspace',
  UNKNOWN: 'unknown',
};

/** Stable recovery-action slugs (the `kind`) — also used for instrumentation. */
export const RECOVERY_ACTIONS = {
  RETRY: 'retry',
  UPGRADE: 'upgrade',
  SUPPORT: 'support',
  LINK: 'link',
};

// Reassurance is the "did I lose work / was I charged" answer. Kept as its own
// line so an alert can always state it plainly, separate from what happened.
const NO_CHARGE_NO_LOSS = 'You weren’t charged and nothing was lost.';
const BRIEF_SAVED_NO_CHARGE = 'No AI action was charged and your brief is saved.';
const ACCESS_UNCHANGED = 'Your access hasn’t changed — this is a temporary check failure.';

/**
 * Plan/entitlement verification is temporarily unavailable (SC-P0-01: fails
 * closed as PLAN_UNAVAILABLE / 503). Preserve access, offer retry + support.
 * Never renders the user as Free.
 */
export function planVerificationState(err = {}) {
  return {
    category: ERROR_CATEGORIES.PLAN_VERIFICATION,
    role: 'alert',
    title: 'We couldn’t verify your plan',
    message: microcopy('plan_unavailable', varsFrom(err)),
    reassurance: ACCESS_UNCHANGED,
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again' },
    secondaryAction: { kind: RECOVERY_ACTIONS.SUPPORT, label: 'Contact support' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * Checkout configuration is unavailable (SC-P0-03: CHECKOUT_UNAVAILABLE, or a
 * launch-config gap). Confirm no charge, allow retry later, and NEVER imply a
 * silent currency switch.
 */
export function checkoutConfigState(err = {}) {
  return {
    category: ERROR_CATEGORIES.CHECKOUT_CONFIG,
    role: 'alert',
    title: 'Checkout is temporarily unavailable',
    message: microcopy('billing_config', varsFrom(err)),
    reassurance: `${NO_CHARGE_NO_LOSS} Your plan and currency are unchanged.`,
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * LB-V17-01: the trial/billing eligibility read could not be confirmed (network
 * failure, 5xx, malformed payload, aborted fetch). This is NOT eligible and NOT
 * ineligible — it is unknown. We must never render a trial promise or a
 * charged-today claim from this state; only offer Retry and confirm no charge.
 */
export function trialUnavailableState(err = {}) {
  return {
    category: ERROR_CATEGORIES.CHECKOUT_CONFIG,
    role: 'alert',
    title: 'We couldn’t confirm your billing status',
    message: 'We couldn’t check whether your free trial is available right now. You have not been charged.',
    reassurance: 'Nothing was lost and no charge was made — this is a temporary check failure.',
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * Generation timed out or the provider failed. The brief is preserved locally,
 * failed generations never count (backend contract), so retry is safe and can
 * reuse the same idempotency key.
 */
export function generationFailedState(err = {}) {
  return {
    category: ERROR_CATEGORIES.GENERATION_FAILED,
    role: 'alert',
    title: 'Generation didn’t finish',
    message: microcopy('generation_failed', varsFrom(err)),
    reassurance: BRIEF_SAVED_NO_CHARGE,
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Retry' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * A plan usage limit was reached (402 / UPGRADE) or generation is temporarily
 * paused to protect capacity (GENERATION_PAUSED). Facts, no dark patterns:
 * editing and exporting stay free either way.
 */
export function usageLimitState(err = {}) {
  const paused = err.code === 'GENERATION_PAUSED';
  return {
    category: ERROR_CATEGORIES.USAGE_LIMIT,
    role: 'alert',
    title: paused ? 'Generation is paused for now' : 'You’ve reached your plan’s generations',
    message: paused ? microcopy('daily_cap', varsFrom(err)) : microcopy('usage_limit', varsFrom(err)),
    reassurance: 'Your work is saved. Editing and exporting are always free.',
    action: paused
      ? { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again later' }
      : { kind: RECOVERY_ACTIONS.UPGRADE, label: 'See plans' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * An export/download failed. Reviewed assets are untouched; offer retry and the
 * copy-individually fallback.
 */
export function exportFailureState(err = {}) {
  return {
    category: ERROR_CATEGORIES.EXPORT_FAILED,
    role: 'alert',
    title: 'We couldn’t export just now',
    message: microcopy('export_failed', varsFrom(err)),
    reassurance: 'Your reviewed assets are still saved — nothing was lost.',
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again' },
    reqId: err.req_id || err.requestId || null,
  };
}

// Empty/new workspace: guide the one path (Brand Profile → Campaign Brief →
// first reviewed asset), NOT a wall of five disconnected generators.
export const WORKSPACE_START_STEPS = [
  { key: 'brand', label: 'Set up your Brand Profile', to: '/app/brand', hint: 'Your offer, audience and voice — used by every generation.' },
  { key: 'brief', label: 'Create a campaign and approve its brief', to: '/app/campaigns', hint: 'One offer, audience, goal and CTA the assets stay consistent with.' },
  { key: 'asset', label: 'Generate your first reviewed asset', to: '/app/create', hint: 'Assets stay attached to that brief — review facts before you use them.' },
];

export function emptyWorkspaceState() {
  return {
    category: ERROR_CATEGORIES.EMPTY_WORKSPACE,
    role: 'status',
    title: 'Start here',
    message: 'Set up your brand once, then build a campaign brief — your assets follow from there.',
    reassurance: 'Setting up uses no AI action.',
    steps: WORKSPACE_START_STEPS,
    action: { kind: RECOVERY_ACTIONS.LINK, label: 'Set up Brand Profile', to: '/app/brand' },
  };
}

/**
 * Resolve a thrown API error into the right typed state. `context` disambiguates
 * where two states share an HTTP code (e.g. a 503 during checkout is a checkout
 * config failure, not a plan-verification failure).
 */
export function errorStateFor(err = {}, { context } = {}) {
  const code = err.code;
  if (code === 'PLAN_UNAVAILABLE') return planVerificationState(err);
  if (code === 'CHECKOUT_UNAVAILABLE' || code === 'LAUNCH_CONFIG_INCOMPLETE') return checkoutConfigState(err);
  if (code === 'GENERATION_PAUSED') return usageLimitState(err);
  if (code === 'UPGRADE' || err.status === 402) return usageLimitState(err);
  if (code === 'AI_TIMEOUT' || code === 'TIMEOUT' || err.status === 408) return generationFailedState(err);

  if (context === 'checkout' && err.status === 503) return checkoutConfigState(err);
  if (context === 'export') return exportFailureState(err);
  if (context === 'generation') return generationFailedState(err);

  // Fall through to the generic recovery copy — still typed, never raw text.
  return {
    category: ERROR_CATEGORIES.UNKNOWN,
    role: 'alert',
    title: 'Something went wrong',
    message: err.userMessage || messageForError(err),
    reassurance: null,
    action: { kind: RECOVERY_ACTIONS.RETRY, label: 'Try again' },
    reqId: err.req_id || err.requestId || null,
  };
}

/**
 * Instrument that an error state was shown and (optionally) which recovery the
 * user took. Sends ONLY the category + recovery-action slug (+ an optional
 * feature label) — never campaign content, briefs, or raw error text.
 */
export function trackErrorState(track, state, { feature, recovery } = {}) {
  if (typeof track !== 'function' || !state) return;
  const payload = { category: state.category, recovery_action: recovery || state.action?.kind || null };
  if (feature) payload.feature = String(feature);
  track('error_state', payload);
}

function varsFrom(err) {
  return {
    req_id: err.req_id || err.requestId,
    retry_after: err.retry_after ?? err.retryAfter,
  };
}
