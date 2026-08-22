// ---------------------------------------------------------------------------
// SV-21-01 (v21) — Stripe-ownership rollout readiness.
//
// A single, PURE classifier for "how far along is the canonical-ownership
// rollout, and is it safe to charge money?". It distinguishes the five distinct
// states the runbook cares about instead of collapsing them into one boolean:
//
//   migration_missing        migration 038 (customers.app_user_id + legacy map)
//                            is not applied — nothing else can be trusted yet.
//   backfill_incomplete      migration applied, but legacy customer rows still
//                            carry a NULL app_user_id (not yet backfilled).
//   ambiguous_present        one or more stripe_object_ownership rows are
//                            status='ambiguous' — these block paid expansion on
//                            purpose and must be reconciled by hand.
//   fallback_enabled         the narrow price-only legacy fallback is still on
//                            (STRIPE_OWNERSHIP_ENFORCED is not set).
//   enforcement_active       migration applied, backfill complete, zero ambiguous
//                            rows AND the price-only fallback is disabled — the
//                            canonical rule is the only rule.
//
// Paid readiness FAILS CLOSED: `paid_ready` is true ONLY in enforcement_active.
// A capped beta deliberately runs with fallback_enabled — that is a WARNING for
// paid, never a blocker for the supervised beta. This module makes no I/O and no
// launch decision; the admin readiness endpoint feeds it observed counts and the
// launch gate/owner reads the result.
// ---------------------------------------------------------------------------

'use strict';

const STATE = Object.freeze({
  MIGRATION_MISSING: 'migration_missing',
  BACKFILL_INCOMPLETE: 'backfill_incomplete',
  AMBIGUOUS_PRESENT: 'ambiguous_present',
  FALLBACK_ENABLED: 'fallback_enabled',
  ENFORCEMENT_ACTIVE: 'enforcement_active',
  UNKNOWN: 'unknown', // a required observation could not be made — fail closed
});

/**
 * Classify ownership rollout readiness from observed inputs. Every input is a
 * fact the endpoint measured (or null when it could not measure it — which is
 * treated as unknown / not-ready, never as healthy).
 *
 * @param {object} o
 * @param {boolean} o.enforced            STRIPE_OWNERSHIP_ENFORCED is set.
 * @param {boolean|null} o.migrationApplied  customers.app_user_id column exists.
 * @param {number|null}  o.unbackfilledCount  customers with a stripe link but a
 *                                            NULL app_user_id (0 = complete).
 * @param {number|null}  o.ambiguousCount     stripe_object_ownership rows with
 *                                            status='ambiguous' (0 = none).
 * @returns {{ state, paid_ready, enforced, blockers: string[] }}
 */
function classifyOwnershipReadiness(o = {}) {
  const enforced = !!o.enforced;
  const blockers = [];

  // A measurement we could not make is never "healthy". If enforcement is claimed
  // we must be able to prove the preconditions; if we cannot, fail closed.
  if (o.migrationApplied == null) {
    return { state: STATE.UNKNOWN, paid_ready: false, enforced, blockers: ['migration_state_unmeasured'] };
  }
  if (!o.migrationApplied) {
    if (enforced) blockers.push('enforcement_on_without_migration');
    return { state: STATE.MIGRATION_MISSING, paid_ready: false, enforced, blockers };
  }

  if (o.unbackfilledCount == null) {
    return { state: STATE.UNKNOWN, paid_ready: false, enforced, blockers: ['backfill_state_unmeasured'] };
  }
  if (o.unbackfilledCount > 0) {
    if (enforced) blockers.push('enforcement_on_with_incomplete_backfill');
    return { state: STATE.BACKFILL_INCOMPLETE, paid_ready: false, enforced, blockers };
  }

  if (o.ambiguousCount == null) {
    return { state: STATE.UNKNOWN, paid_ready: false, enforced, blockers: ['ambiguous_state_unmeasured'] };
  }
  if (o.ambiguousCount > 0) {
    if (enforced) blockers.push('enforcement_on_with_ambiguous_rows');
    return { state: STATE.AMBIGUOUS_PRESENT, paid_ready: false, enforced, blockers };
  }

  // Migration applied, backfill complete, zero ambiguous rows. The only remaining
  // question is whether the price-only fallback has been switched off.
  if (!enforced) {
    // Fully prepared but the last switch is not flipped — safe capped-beta state.
    return { state: STATE.FALLBACK_ENABLED, paid_ready: false, enforced, blockers: [] };
  }
  return { state: STATE.ENFORCEMENT_ACTIVE, paid_ready: true, enforced, blockers: [] };
}

module.exports = { STATE, classifyOwnershipReadiness };
