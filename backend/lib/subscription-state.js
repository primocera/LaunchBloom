// ---------------------------------------------------------------------------
// v12 SC-V12-04 — the canonical subscription state machine and the single
// definition of what a mirrored subscription row entitles.
//
// Entitlement is reconciled to Stripe's CURRENT state, never to the arrival
// order of events. The webhook handler keeps the mirror row correct under
// out-of-order/duplicate delivery (routes/webhooks.js, guarded by
// stripe_event_at); this module turns that row into a plan. Keeping the mapping
// here, pure and tested, means "what does status X grant?" has exactly one
// answer that both the webhook and planFor() agree on.
//
// Stripe subscription statuses and what each means for access:
//
//   trialing            inside the 3-day paid trial  → entitled (limited 'trial')
//   active              paid and current             → entitled (mapped plan)
//   past_due            a charge failed, in dunning   → NOT entitled (access held
//                       back until recovery flips it to active again)
//   unpaid              dunning exhausted             → NOT entitled
//   canceled            ended                         → NOT entitled
//   incomplete          first payment never confirmed → NOT entitled
//   incomplete_expired  first payment abandoned       → NOT entitled
//   paused              collection paused             → NOT entitled
//
// Only `active` and `trialing` grant access. Everything else is a deliberate
// "no" — a refund or dispute does not itself change the subscription status, so
// it never changes entitlement here; the status transition Stripe sends (e.g.
// canceled) is what does.
// ---------------------------------------------------------------------------

'use strict';

// The statuses this system recognises. An unknown status is treated as
// non-entitling rather than assumed safe.
const KNOWN_STATUSES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

// The only two statuses that grant product access.
const ENTITLING_STATUSES = Object.freeze(['active', 'trialing']);

/** Whether a status grants any access at all. */
function isEntitled(status) {
  return ENTITLING_STATUSES.includes(status);
}

/**
 * The plan a mirrored subscription row grants, or null.
 * `pricePlans` is the { [priceId]: planName } map (routes/customers.js), passed
 * in so this stays pure and free of environment reads.
 *
 *   trialing              -> 'trial'   (the limited trial plan, any price)
 *   active + mapped price -> that plan
 *   active + unknown price-> null      (never silently grant an unmapped price)
 *   anything else         -> null
 */
function entitlementFor(row, pricePlans = {}) {
  if (!row || !isEntitled(row.status)) return null;
  if (row.status === 'trialing') return 'trial';
  const mapped = pricePlans[row.stripe_price_id];
  return mapped || null;
}

// ---------------------------------------------------------------------------
// v13 SC-P0-02 — canonical entitlement when entitling rows OVERLAP.
//
// Policy (see docs/decisions/2026-08-02-canonical-entitlement.md): HIGHEST VALID
// ENTITLEMENT WINS. Taking the newest mapped row can silently downgrade a paying
// customer whenever a lower-plan row happens to carry a later event timestamp;
// over-granting to someone who genuinely holds two subscriptions is a billing
// anomaly to reconcile, never a lockout. Access and anomaly reporting are
// computed separately so a customer keeps the safest valid plan while the
// overlap is still visible to operations.
// ---------------------------------------------------------------------------

/** Plan strength. Higher wins. Anything absent here ranks 0 (no access). */
const PLAN_RANK = Object.freeze({ trial: 1, starter: 2, pro: 3, studio: 4 });

function planRank(plan) {
  return PLAN_RANK[plan] || 0;
}

// Deterministic ordering INSIDE one plan rank, so the winner never depends on
// the order Postgres happened to return rows in.
function compareCandidates(a, b) {
  if (b.rank !== a.rank) return b.rank - a.rank;
  const at = a.row.stripe_event_at ? Date.parse(a.row.stripe_event_at) : NaN;
  const bt = b.row.stripe_event_at ? Date.parse(b.row.stripe_event_at) : NaN;
  const av = Number.isNaN(at) ? -Infinity : at;
  const bv = Number.isNaN(bt) ? -Infinity : bt;
  if (av !== bv) return bv - av; // newest first; missing timestamp sorts last
  const aid = String(a.row.stripe_subscription_id || '');
  const bid = String(b.row.stripe_subscription_id || '');
  if (aid !== bid) return aid < bid ? -1 : 1;
  return String(a.row.stripe_price_id || '') < String(b.row.stripe_price_id || '') ? -1 : 1;
}

/**
 * The canonical entitlement for a customer's mirrored subscription rows.
 *
 *   resolveCanonicalEntitlement(rows, pricePlans) -> {
 *     plan,        // 'trial'|'starter'|'pro'|'studio'|null
 *     canonical,   // the winning row, or null
 *     anomalies,   // [{ code, ... }] — reported, never access-changing
 *   }
 *
 * Pure: no env reads, no I/O, no mutation of `rows`. `rows` may contain
 * non-entitling rows; they are ignored. An unmapped price NEVER grants access —
 * that is also the shared-Stripe product isolation, since a foreign product's
 * price id can never appear in our STRIPE_PRICE_* map.
 */
function resolveCanonicalEntitlement(rows, pricePlans = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const entitling = list.filter((r) => r && isEntitled(r.status));

  const candidates = [];
  const unmappedRows = [];
  for (const row of entitling) {
    const plan = entitlementFor(row, pricePlans);
    if (plan) candidates.push({ row, plan, rank: planRank(plan) });
    else unmappedRows.push(row);
  }

  const anomalies = [];
  if (unmappedRows.length) {
    anomalies.push({
      code: 'unmapped_price',
      statuses: unmappedRows.map((r) => r.status),
      price_ids: unmappedRows.map((r) => r.stripe_price_id || null),
      subscription_ids: unmappedRows.map((r) => r.stripe_subscription_id || null),
      hint: 'retired/foreign price — check STRIPE_PRICE_* env vars',
    });
  }

  if (!candidates.length) {
    return { plan: null, canonical: null, anomalies, unmapped: unmappedRows.length > 0 };
  }

  const sorted = candidates.slice().sort(compareCandidates);
  const winner = sorted[0];

  if (candidates.length > 1) {
    anomalies.push({
      code: 'overlapping_subscriptions',
      granted_plan: winner.plan,
      plans: sorted.map((c) => c.plan),
      subscription_ids: sorted.map((c) => c.row.stripe_subscription_id || null),
      hint: 'more than one entitling subscription — reconcile in Stripe',
    });
  }

  return {
    plan: winner.plan,
    canonical: winner.row,
    anomalies,
    unmapped: unmappedRows.length > 0,
  };
}

/**
 * Given the row currently stored and an incoming event's timestamp, whether the
 * incoming event is STALE (an older delivery that must not overwrite a newer
 * recorded state). This is the reconciliation rule the webhook applies; it lives
 * here so it can be reasoned about and tested in isolation.
 */
function isStale(storedEventAtIso, incomingEventAtIso) {
  if (!storedEventAtIso) return false;
  return new Date(storedEventAtIso) > new Date(incomingEventAtIso);
}

// ---------------------------------------------------------------------------
// v13 SC-P0-01 — "we could not verify" is its own state, never "verified free".
//
// A transient Supabase/provider failure used to be swallowed and returned as
// null, i.e. indistinguishable from "this account has no subscription". That
// let a paying customer render as Free and let checkout create a SECOND
// subscription. Billing-critical callers now fail closed on this error instead:
// they change nothing and ask the user to retry.
// ---------------------------------------------------------------------------

const PLAN_UNAVAILABLE_CODE = 'PLAN_UNAVAILABLE';
const PLAN_UNAVAILABLE_MESSAGE =
  'We couldn’t verify your plan right now. No access change was made. Please try again.';

class EntitlementUnavailableError extends Error {
  constructor(cause) {
    super('entitlement verification unavailable');
    this.name = 'EntitlementUnavailableError';
    this.code = PLAN_UNAVAILABLE_CODE;
    this.retryable = true;
    this.status = 503;
    if (cause) this.cause = cause;
  }
}

/** True for the "verification unavailable" error, however it was rethrown. */
function isEntitlementUnavailable(err) {
  return !!err && err.code === PLAN_UNAVAILABLE_CODE;
}

/** The single 503 body every caller returns for the unavailable state. */
function planUnavailableBody() {
  return { error: PLAN_UNAVAILABLE_MESSAGE, code: PLAN_UNAVAILABLE_CODE, retryable: true };
}

module.exports = {
  PLAN_UNAVAILABLE_CODE,
  PLAN_UNAVAILABLE_MESSAGE,
  EntitlementUnavailableError,
  isEntitlementUnavailable,
  planUnavailableBody,
  KNOWN_STATUSES,
  ENTITLING_STATUSES,
  isEntitled,
  entitlementFor,
  PLAN_RANK,
  planRank,
  resolveCanonicalEntitlement,
  isStale,
};
