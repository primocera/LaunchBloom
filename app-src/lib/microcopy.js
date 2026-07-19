// ---------------------------------------------------------------------------
// Playbook v6 Prompt 28 — the single system microcopy map. Every recurring
// loading / empty / error / limit / recovery state gets one specific, honest
// string here, so no raw backend error ever reaches a user. Dynamic values
// (retry_after, req_id, time) are interpolated at call time.
//
// Keep this table verbatim to the playbook: it is the copy contract the error
// tests and content QA check against.
// ---------------------------------------------------------------------------

export const SYSTEM_MICROCOPY = {
  loading: 'Loading your workspace…',
  autosaving: 'Saving changes…',
  autosaved: 'Saved {time}',
  offline: 'You appear to be offline. Your unsent changes are still on this device.',
  forbidden: 'You don’t have access to this workspace.',
  not_found_asset: 'This asset no longer exists or belongs to another workspace.',
  rate_limited: 'Too many requests. Try again in {retry_after}. Your work is saved.',
  ai_timeout: 'Generation timed out. No AI action was charged. Try again.',
  daily_cap: 'Generation is temporarily paused while we protect service capacity. Editing and exporting still work.',
  billing_config: 'Checkout is temporarily unavailable. Your workspace and drafts are unaffected.',
  webhook_delay: 'Payment received. Plan access may take a moment to update. Refresh or contact support with request {req_id}.',
  unknown: 'Something went wrong. Try again. If it continues, share request {req_id} with support.',
};

function interpolate(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? String(vars[key]) : m));
}

/** Resolve a microcopy key to its final string with dynamic values applied. */
export function microcopy(key, vars = {}) {
  const template = SYSTEM_MICROCOPY[key] || SYSTEM_MICROCOPY.unknown;
  // Default retry_after / req_id so a placeholder never leaks to the user.
  const filled = {
    retry_after: 'a moment',
    req_id: vars.req_id || 'your request ID',
    time: 'just now',
    ...vars,
  };
  return interpolate(template, filled);
}

/** Format a Retry-After value (seconds or http-date) into human text. */
export function formatRetryAfter(retryAfter) {
  if (retryAfter == null) return 'a moment';
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0) {
    if (secs < 60) return `${Math.ceil(secs)} seconds`;
    const mins = Math.ceil(secs / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  return 'a moment';
}

/**
 * Map a thrown API error (status/code/req_id/retry_after) to a user-facing
 * message. This is the single translation point — callers show err.userMessage
 * rather than err.message, so raw backend text never surfaces.
 */
export function messageForError(err = {}) {
  const vars = {
    req_id: err.req_id || err.requestId,
    retry_after: formatRetryAfter(err.retry_after ?? err.retryAfter),
  };
  const byCode = {
    GENERATION_PAUSED: 'daily_cap',
    LAUNCH_CONFIG_INCOMPLETE: 'billing_config',
    AI_TIMEOUT: 'ai_timeout',
    TIMEOUT: 'ai_timeout',
  };
  if (err.code && byCode[err.code]) return microcopy(byCode[err.code], vars);

  switch (err.status) {
    case 401:
    case 403:
      return microcopy('forbidden', vars);
    case 404:
      return microcopy('not_found_asset', vars);
    case 408:
      return microcopy('ai_timeout', vars);
    case 429:
      return microcopy('rate_limited', vars);
    case 503:
      return microcopy('billing_config', vars);
    default:
      return microcopy('unknown', vars);
  }
}
