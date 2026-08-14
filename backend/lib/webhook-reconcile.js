// ---------------------------------------------------------------------------
// v18 S05 — pull-based webhook reconciliation (the DETECTION core).
//
// The existing reconcile-entitlements.js reconciles rows we ALREADY mirror. It
// cannot see the failure this module targets: a Stripe subscription that a
// webhook never delivered (or delivered out of order), so no local row exists
// at all — or exists with a stale status. This is the pull direction: compare
// what Stripe actually holds against the local mirror and reason-code the gap.
//
// This file is pure: it takes plain Stripe-subscription objects and local rows
// and returns findings. All Stripe/DB I/O lives in the script that wraps it, so
// the diff logic is unit-testable without network or database.
//
// Reason codes (fail-closed, never invents access):
//   missing_local  — owned subscription in Stripe, no local row (missed create)
//   status_drift   — local row exists but its status differs from Stripe (missed update)
//   foreign_skipped— not ours by the exact ownership rule; counted, never a finding
// ---------------------------------------------------------------------------

/**
 * Compare Stripe subscriptions against the local mirror.
 *
 * @param stripeSubs  array of Stripe subscription objects (id, status, metadata, …)
 * @param localRows   array of local rows ({ stripe_subscription_id, status })
 * @param isOwned     predicate(sub) → boolean; pass webhooks.isOurSubscription so
 *                    the SAME ownership rule as the webhook decides membership.
 * @returns { findings: [...], counts: { total, owned, foreign_skipped, missing_local, status_drift, ok } }
 */
function diffStripeVsLocal({ stripeSubs = [], localRows = [], isOwned = () => true } = {}) {
  const subs = Array.isArray(stripeSubs) ? stripeSubs : [];
  const rows = Array.isArray(localRows) ? localRows : [];

  const localById = new Map();
  for (const r of rows) {
    if (r && r.stripe_subscription_id) localById.set(String(r.stripe_subscription_id), r);
  }

  const findings = [];
  const counts = { total: subs.length, owned: 0, foreign_skipped: 0, missing_local: 0, status_drift: 0, ok: 0 };

  for (const sub of subs) {
    if (!sub || !sub.id) continue;
    if (!isOwned(sub)) { counts.foreign_skipped++; continue; }
    counts.owned++;

    const local = localById.get(String(sub.id));
    if (!local) {
      counts.missing_local++;
      findings.push({ reason: 'missing_local', subscription_id: sub.id, stripe_status: sub.status || null, local_status: null });
      continue;
    }
    if (String(local.status) !== String(sub.status)) {
      counts.status_drift++;
      findings.push({ reason: 'status_drift', subscription_id: sub.id, stripe_status: sub.status || null, local_status: local.status || null });
      continue;
    }
    counts.ok++;
  }

  // Deterministic order so the report never depends on Stripe pagination order.
  findings.sort((a, b) => (a.subscription_id < b.subscription_id ? -1 : a.subscription_id > b.subscription_id ? 1 : 0));
  return { findings, counts };
}

module.exports = { diffStripeVsLocal };
