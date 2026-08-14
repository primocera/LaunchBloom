// ---------------------------------------------------------------------------
// v18 S13 — the ONE typed paywall reason contract.
//
// Every monetisation boundary in the app (first gated generation, an exhausted
// quota, an export outside the plan, a failed payment, a cancelled or
// permission-denied action) resolves to exactly one of these reasons, and the
// single paywall component renders from this table. The point is that a trigger
// can no longer open the paywall with ad-hoc copy: it must name its reason, so
// the message the user sees, the CTA they get and the analytics we record all
// derive from the same source.
//
// This module is pure and DOM-free so it is unit-testable without a browser.
// It carries copy fragments only — the component still owns exact price, trial
// allowance and charge-date rendering, which depend on live catalog state.
// ---------------------------------------------------------------------------

// The closed set of reasons. Anything not here is a bug, not a new string.
export const PAYWALL_REASONS = Object.freeze({
  // First gated generation on a free account that is still trial-eligible.
  trial_required: {
    kind: 'trial',
    cta: 'start_trial',
    title: 'Start your 3-day free trial to generate',
    lead: 'Your work is saved. Start your trial to run this generation.',
  },
  // The trial was already used — a plan starts (and is charged) today.
  trial_expired: {
    kind: 'subscribe',
    cta: 'subscribe_today',
    title: 'Choose a plan to keep generating',
    lead: "Your work is saved. You've already used your 3-day trial, so a plan starts today.",
  },
  // A paid plan hit its monthly limit for this feature.
  quota_reached: {
    kind: 'upgrade',
    cta: 'upgrade',
    title: "You've used this month's allowance",
    lead: 'Your work is saved. Upgrade to keep generating this month, or wait for your limit to reset.',
  },
  // The requested export format/feature is not in the current plan.
  export_not_in_plan: {
    kind: 'upgrade',
    cta: 'upgrade',
    title: 'This export is on a higher plan',
    lead: 'Your work is saved. Upgrade to unlock this export, or use a format your plan includes.',
  },
  // A recurring payment failed — access continues per policy while it is fixed.
  payment_past_due: {
    kind: 'fix_payment',
    cta: 'update_payment',
    title: 'Update your payment method',
    lead: 'Your work is saved. Your last payment did not go through — update your card to avoid interruption.',
  },
  // The subscription is cancelled; resubscribing restores access.
  cancelled: {
    kind: 'subscribe',
    cta: 'subscribe_today',
    title: 'Choose a plan to continue',
    lead: 'Your work is saved. Your subscription has ended — choose a plan to keep generating.',
  },
  // The action needs a permission the current account/workspace lacks.
  permission_denied: {
    kind: 'blocked',
    cta: 'close',
    title: "You don't have access to this action",
    lead: 'Your work is saved. This action is not available on your account — nothing has changed.',
  },
});

export const PAYWALL_REASON_KEYS = Object.freeze(Object.keys(PAYWALL_REASONS));

/**
 * Resolve a typed reason from what the caller actually knows: an optional
 * explicit reason (always wins if valid), the server 402 code that triggered
 * the boundary, and the server-confirmed trial-eligibility flag.
 *
 * Fail-safe: an unknown/absent signal degrades to `trial_required` only when
 * eligibility is genuinely eligible; otherwise `trial_expired` (the honest
 * "you'll be charged today" path). It never invents access.
 */
export function resolvePaywallReason({ reason = null, code = null, trialEligible = null } = {}) {
  if (reason && PAYWALL_REASONS[reason]) return reason;
  switch (code) {
    case 'UPGRADE': return 'quota_reached';
    case 'EXPORT_NOT_IN_PLAN': return 'export_not_in_plan';
    case 'PAYMENT_PAST_DUE': return 'payment_past_due';
    case 'SUBSCRIPTION_CANCELLED': return 'cancelled';
    case 'PERMISSION_DENIED': return 'permission_denied';
    // 'CREDITS' (free lifetime credits exhausted) is the first-generation
    // boundary: eligibility decides trial vs subscribe.
    case 'CREDITS':
    default:
      // Unknown eligibility (still loading) shows the trial path optimistically;
      // the component's own eligState gate suppresses any charge claim until the
      // server confirms, so this can never promise access we haven't verified.
      return trialEligible === false ? 'trial_expired' : 'trial_required';
  }
}

/** The copy record for a reason, or a safe subscribe default for an unknown key. */
export function paywallCopy(reason) {
  return PAYWALL_REASONS[reason] || PAYWALL_REASONS.trial_expired;
}
