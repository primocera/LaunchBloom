// ---------------------------------------------------------------------------
// v12 SC-V12-07 — signup cohort control, fail-closed.
//
// A small beta can absorb manual intervention; paid scale cannot absorb a cap
// that silently disables itself. The previous check read
// `Number(BETA_INVITE_CAP || 0)` and treated any non-numeric value as uncapped —
// so a typo in the cap opened the doors. This module makes every decision
// explicit and fails CLOSED on an emergency stop, a misconfigured cap, or a
// count it cannot verify. Two switches are deliberately independent:
//
//   SIGNUP_PAUSED=1   emergency stop — refuse all new signups (kill switch).
//   BETA_INVITE_CAP   a positive integer caps the cohort; unset or 0 is the
//                     normal uncapped operation; anything else is a
//                     misconfiguration and refuses signups until fixed.
//
// Pure: it reads a passed-in env object and a count, never process.env or a DB.
// ---------------------------------------------------------------------------

'use strict';

/** True when a valid positive cap is configured, so the caller should fetch a
 *  count. Unset/empty/0 → uncapped (no count needed). */
function capIsActive(env = {}) {
  const raw = env.BETA_INVITE_CAP;
  if (raw == null || String(raw).trim() === '') return false;
  const cap = Number(raw);
  return Number.isInteger(cap) && cap > 0;
}

/** True when the cap is SET to something that is not a valid uncapped value or a
 *  positive integer — a misconfiguration that must fail closed. */
function capIsMisconfigured(env = {}) {
  const raw = env.BETA_INVITE_CAP;
  if (raw == null || String(raw).trim() === '') return false; // unset = uncapped
  const cap = Number(raw);
  if (cap === 0) return false;                 // explicit uncapped (legacy)
  return !(Number.isInteger(cap) && cap > 0);  // NaN, negative, or fractional
}

/**
 * Decide whether a signup may proceed.
 * @param env   { SIGNUP_PAUSED, BETA_INVITE_CAP }
 * @param count current workspace/account count, or null when it could not be read
 * @returns { allow, code, reason } — code is null when allowed
 */
function signupDecision(env = {}, count = null) {
  if (String(env.SIGNUP_PAUSED || '') === '1') {
    return { allow: false, code: 'SIGNUP_PAUSED', reason: 'new signups are paused (emergency stop)' };
  }
  if (capIsMisconfigured(env)) {
    return { allow: false, code: 'COHORT_MISCONFIGURED', reason: 'BETA_INVITE_CAP is set but is not a positive integer' };
  }
  if (!capIsActive(env)) {
    return { allow: true, code: null, reason: 'uncapped' };
  }
  // A valid cap is only safe with a verified count. An unknown count fails
  // closed: refusing one legitimate signup is cheaper than blowing the cap.
  if (count == null || !Number.isFinite(count)) {
    return { allow: false, code: 'COHORT_COUNT_UNAVAILABLE', reason: 'could not verify the cohort count' };
  }
  const cap = Number(env.BETA_INVITE_CAP);
  if (count >= cap) {
    return { allow: false, code: 'BETA_FULL', reason: 'the cohort cap has been reached' };
  }
  return { allow: true, code: null, reason: 'under cap' };
}

// User-facing messages per refusal code. Deliberately vague about the cause so a
// misconfiguration is not advertised, except BETA_FULL which is expected.
const MESSAGES = Object.freeze({
  SIGNUP_PAUSED: 'New signups are paused right now. Please check back shortly.',
  COHORT_MISCONFIGURED: 'Signups are temporarily unavailable. Please try again later.',
  COHORT_COUNT_UNAVAILABLE: 'Signups are temporarily unavailable. Please try again shortly.',
  BETA_FULL: 'The beta is currently full. Leave your email with support and we will let you know when a place opens.',
});

module.exports = { signupDecision, capIsActive, capIsMisconfigured, MESSAGES };
