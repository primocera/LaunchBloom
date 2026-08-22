// ---------------------------------------------------------------------------
// Canonical Stripe object-ownership service  (SV-01 / v20)
//
// One typed, pure home for the ownership rule that decides whether a Stripe
// object on the SHARED account (Scalvya + Mellowa + Frost) belongs to Scalvya.
// Before v20 the rule lived inline in routes/webhooks.js and routes/payments.js;
// this module makes it a single canonical source those files (and the
// reconciler, billing portal and account deletion) delegate to, so no billing
// entry point can drift to a second rule.
//
// Deliberately dependency-free: no supabase, no stripe. Every input is passed
// in (metadata, a configured-price predicate, an explicit legacy map), so the
// classification is a pure function that is trivial to test exhaustively and
// impossible to make network-order-dependent.
//
// The result is a typed state, never a loose boolean that collapses "we don't
// know" into "not ours":
//   owned         exact Scalvya stamp — self-identifying, no email/price needed
//   foreign       a peer product's stamp is present — definitely NOT ours
//   legacy_mapped an explicit, owner-verified legacy mapping claims this object
//   legacy_price  narrow pre-stamp fallback: a configured Scalvya price, no
//                 foreign stamp (measured, to be sunset once legacy objects age
//                 out or are backfilled — see scripts/backfill-stripe-ownership.js)
//   ambiguous     conflicting signals — fail closed, never adopt, never mutate
//   unavailable   a required ownership read could not be performed (caller retries)
// ---------------------------------------------------------------------------

// Scalvya's exact ownership tag in the shared Stripe account. Historical brand
// name kept because it is the literal value already stamped on every live
// object and in customers/subscriptions metadata; changing it would orphan them.
const APP_STRIPE_SOURCE = 'launchbloom';

const OWNERSHIP = Object.freeze({
  OWNED: 'owned',
  FOREIGN: 'foreign',
  LEGACY_MAPPED: 'legacy_mapped',
  LEGACY_PRICE: 'legacy_price',
  AMBIGUOUS: 'ambiguous',
  UNAVAILABLE: 'unavailable',
});

// States that entitle Scalvya to read/mirror/act on the object. `unavailable`
// and `ambiguous` are intentionally excluded — the caller must fail closed.
const OWNING_STATES = Object.freeze([
  OWNERSHIP.OWNED,
  OWNERSHIP.LEGACY_MAPPED,
  OWNERSHIP.LEGACY_PRICE,
]);

// SV-21-01 (v21): the enforcement switch that SUNSETS the narrow price-only
// fallback. It is the last owner-only step of the ownership rollout (see
// docs/RUNBOOK_STRIPE_OWNERSHIP.md): once migration 038 is applied, legacy Stripe
// objects are backfilled and every ambiguous row is reconciled, the owner sets
// STRIPE_OWNERSHIP_ENFORCED=1. From then on an unstamped object on a configured
// Scalvya price is NO LONGER adopted — only an exact stamp or an explicit,
// owner-verified legacy mapping proves ownership. Default OFF preserves the
// capped-beta behaviour byte-for-byte, so this flip cannot silently change a
// running beta and is fully reversible (unset the env var).
function ownershipEnforced() {
  return String(process.env.STRIPE_OWNERSHIP_ENFORCED || '').trim() === '1';
}

/** Our exact, self-identifying stamp. No email or price is ever consulted. */
function hasExactStamp(meta) {
  if (!meta || typeof meta !== 'object') return false;
  return meta.source === APP_STRIPE_SOURCE || meta.scalvya === '1';
}

/**
 * A peer product's discriminator. Its PRESENCE is positive proof the object is
 * NOT ours, so ownership never falls through to the price fallback for it.
 * Mellowa stamps app=mellowa + supabase_user_id; Frost stamps frost.
 */
function hasForeignStamp(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.app && meta.app !== APP_STRIPE_SOURCE) return true;
  if (meta.source && meta.source !== APP_STRIPE_SOURCE) return true;
  if (meta.mellowa || meta.frost) return true;
  if (Object.prototype.hasOwnProperty.call(meta, 'supabase_user_id')) return true;
  return false;
}

/** True when both an exact AND a foreign stamp are present — never adoptable. */
function hasConflictingStamp(meta) {
  return hasExactStamp(meta) && hasForeignStamp(meta);
}

/**
 * Convenience: does a typed result grant ownership?
 *
 * SV-21-01: when enforcement is active the narrow `legacy_price` fallback no
 * longer grants ownership — an unstamped object on a configured price is NOT
 * ours once the fallback is sunset. `enforced` defaults to the live env switch,
 * so every caller sunsets the fallback together the moment the owner flips it;
 * pass an explicit boolean in tests to assert both regimes. Callers that need
 * the pure, regime-independent membership can pass { enforced: false }.
 */
function isOwning(result, { enforced = ownershipEnforced() } = {}) {
  if (result === OWNERSHIP.LEGACY_PRICE) return !enforced;
  return OWNING_STATES.includes(result);
}

/** Whether a typed result is the narrow, to-be-sunset price-only fallback. */
function isLegacyPriceFallback(result) {
  return result === OWNERSHIP.LEGACY_PRICE;
}

/**
 * Classify a Stripe subscription (or any object carrying `metadata` and, for
 * the fallback, a resolvable price). Pure.
 *
 * options:
 *   isConfiguredPrice(priceId) → boolean   (defaults to the live price catalog)
 *   legacyMap: Set<string> | { has(id):bool }  explicit owner-verified legacy
 *              subscription/customer ids that ARE ours despite no exact stamp
 *   priceId:  override the resolved price id (else read from items.data[0])
 */
function classifySubscription(subscription, options = {}) {
  const meta = (subscription && subscription.metadata) || {};

  // Conflicting stamps are never adoptable — do not let an exact stamp launder a
  // foreign one, and do not silently drop; surface ambiguity for reconciliation.
  if (hasConflictingStamp(meta)) return OWNERSHIP.AMBIGUOUS;

  if (hasExactStamp(meta)) return OWNERSHIP.OWNED;
  if (hasForeignStamp(meta)) return OWNERSHIP.FOREIGN;

  // Explicit, owner-verified legacy mapping wins over the generic price fallback.
  const legacyMap = options.legacyMap;
  const subId = subscription && subscription.id;
  if (legacyMap && subId && typeof legacyMap.has === 'function' && legacyMap.has(subId)) {
    return OWNERSHIP.LEGACY_MAPPED;
  }

  const priceId = options.priceId
    ?? subscription?.items?.data?.[0]?.price?.id
    ?? null;
  const isConfiguredPrice = options.isConfiguredPrice || defaultIsConfiguredPrice;
  if (priceId && isConfiguredPrice(priceId)) return OWNERSHIP.LEGACY_PRICE;

  return OWNERSHIP.FOREIGN;
}

/**
 * Classify a Stripe Customer against a specific stable app user id. A customer
 * is ours only with the exact source stamp AND the exact app_user_id — object
 * presence, a local DB row or email equality is never proof. Pure.
 */
function classifyCustomer(customer, userId) {
  if (!customer || customer.deleted) return OWNERSHIP.FOREIGN;
  const meta = customer.metadata || {};
  if (hasConflictingStamp(meta)) return OWNERSHIP.AMBIGUOUS;
  if (meta.source === APP_STRIPE_SOURCE && userId && meta.app_user_id === userId) {
    return OWNERSHIP.OWNED;
  }
  if (hasForeignStamp(meta)) return OWNERSHIP.FOREIGN;
  return OWNERSHIP.FOREIGN;
}

/**
 * Classify a charge/dispute by metadata only (the synchronous half). When this
 * returns null the object carries no stamp either way and the caller must fall
 * back to a TRUSTED PARENT lookup (a Stripe customer WE own) — see
 * routes/webhooks.isOurCharge. Pure.
 */
function classifyChargeMeta(object) {
  const meta = (object && object.metadata) || {};
  if (hasConflictingStamp(meta)) return OWNERSHIP.AMBIGUOUS;
  if (hasExactStamp(meta)) return OWNERSHIP.OWNED;
  if (hasForeignStamp(meta)) return OWNERSHIP.FOREIGN;
  return null; // undecided by metadata — needs a parent-customer lookup
}

/** Lazy default so the catalog is resolved through the one price table. */
function defaultIsConfiguredPrice(priceId) {
  const { pricePlans } = require('../routes/customers');
  return !!(priceId && pricePlans()[priceId]);
}

module.exports = {
  APP_STRIPE_SOURCE,
  OWNERSHIP,
  OWNING_STATES,
  ownershipEnforced,
  hasExactStamp,
  hasForeignStamp,
  hasConflictingStamp,
  isOwning,
  isLegacyPriceFallback,
  classifySubscription,
  classifyCustomer,
  classifyChargeMeta,
};
