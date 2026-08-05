// ---------------------------------------------------------------------------
// v15 SC-04 — the canonical live-money rehearsal matrix and its record schema.
//
// The repository used to describe the money-path rehearsal three different ways
// (a "nine-transition matrix", a "step 1 of 7", a 13-row journey table). SC-01
// fixed the prose; this module is the single MACHINE-READABLE source of the
// canonical transition list, so the runbook, launch-state and tests cannot drift
// again. It also validates a completed-rehearsal RECORD, so partial, stale,
// reused or PII-bearing evidence can never be mistaken for a clean live pass.
//
// Pure: no I/O, no Stripe, no database. Claude Code prepares and validates the
// runbook; only the owner ever runs a live charge, refund or webhook replay.
// ---------------------------------------------------------------------------

'use strict';

// The eight-transition ORDERED recovery sequence, run in order on one
// subscription. Row ids are the stable letters used in
// docs/RUNBOOK_TRANSACTION_REHEARSAL.md and docs/launch/launch-state.json.
//
// live_required = this transition moves real money, or proves an entitlement /
// ordering outcome only a real webhook stream delivers. A test-mode rehearsal
// can exercise the state machine for every row, but it may NEVER satisfy a
// live_required row for the public_paid track — that needs owner-observed live
// evidence with a refund verification when money moved.
const CANONICAL_MATRIX = Object.freeze([
  {
    id: 'A', name: 'Start eligible trial', cost: 'confirm', live_required: false,
    precondition: 'a fresh account that has never trialed',
    owner_action: 'start an eligible 3-day trial',
    expected_stripe: 'trialing',
    expected_db: 'subscription row trialing',
    expected_entitlement: 'trial limits',
    expected_side_effect: 'email trial_started',
    stop_condition: 'entitlement is anything other than trial limits',
  },
  {
    id: 'B', name: 'Trial converts to paid', cost: 'money', live_required: true,
    precondition: 'row A active (trialing)',
    owner_action: 'let the trial convert / pay the first invoice',
    expected_stripe: 'active',
    expected_db: 'subscription active, mapped plan',
    expected_entitlement: 'mapped plan limits',
    expected_side_effect: 'email payment_succeeded',
    stop_condition: 'charged currency or amount differs from what was quoted',
  },
  {
    id: 'C', name: 'Cancel at period end', cost: 'confirm', live_required: false,
    precondition: 'row B active',
    owner_action: 'cancel at period end',
    expected_stripe: 'active, cancel_at_period_end=true',
    expected_db: 'cancel_at_period_end recorded',
    expected_entitlement: 'plan held to period end',
    expected_side_effect: 'email cancellation_scheduled',
    stop_condition: 'access is revoked before period end',
  },
  {
    id: 'D', name: 'Reactivate (undo cancel)', cost: 'confirm', live_required: false,
    precondition: 'row C active + cancel scheduled',
    owner_action: 'reactivate (undo the scheduled cancel)',
    expected_stripe: 'active, cancel_at_period_end=false',
    expected_db: 'cancel_at_period_end cleared',
    expected_entitlement: 'plan continues',
    expected_side_effect: 'none required',
    stop_condition: 'the cancel flag survives reactivation',
  },
  {
    id: 'E', name: 'Force a failed payment', cost: 'money', live_required: true,
    precondition: 'row D active',
    owner_action: 'force a failed renewal payment',
    expected_stripe: 'past_due',
    expected_db: 'subscription past_due',
    expected_entitlement: 'entitlement withheld',
    expected_side_effect: 'email payment_failed',
    stop_condition: 'entitlement is granted while past_due',
  },
  {
    id: 'F', name: 'Recover (pay open invoice)', cost: 'money', live_required: true,
    precondition: 'row E past_due',
    owner_action: 'pay the open invoice to recover',
    expected_stripe: 'active',
    expected_db: 'subscription active',
    expected_entitlement: 'plan restored',
    expected_side_effect: 'email payment_recovered',
    stop_condition: 'entitlement stays withheld after recovery',
  },
  {
    id: 'G', name: 'Replay a LATE payment_failed (created before F)', cost: 'confirm', live_required: true,
    precondition: 'row F active; a payment_failed event whose created predates the recovery',
    owner_action: 'resend the stale payment_failed event (stripe events resend)',
    expected_stripe: 'stays active',
    expected_db: 'ops-signal reconciliation_correction reason=stale_out_of_order_skipped; row stays active',
    expected_entitlement: 'entitlement NOT revoked',
    expected_side_effect: 'none',
    stop_condition: 'the stale event flips the subscription back to past_due (the regression)',
  },
  {
    id: 'H', name: 'Refund the last charge', cost: 'money+confirm', live_required: true,
    precondition: 'row F active with a real charge',
    owner_action: 'refund the last charge',
    expected_stripe: 'active unless also cancelled',
    expected_db: 'refund acknowledged, entitlement unchanged by the refund alone',
    expected_entitlement: 'unchanged by the refund alone',
    expected_side_effect: 'none',
    stop_condition: 'the refund alone changes entitlement, or the refund is not verified in Stripe',
  },
]);

const STEP_IDS = Object.freeze(CANONICAL_MATRIX.map((r) => r.id));
const TRANSITION_COUNT = CANONICAL_MATRIX.length;
const LATE_FAILURE_STEP = 'G';
const LIVE_REQUIRED_IDS = Object.freeze(CANONICAL_MATRIX.filter((r) => r.live_required).map((r) => r.id));

// A row outcome vocabulary that keeps a laptop replay separable from a live run.
// test_mode_rehearsed can NEVER satisfy a live_required row for public_paid.
const REHEARSAL_STATUSES = Object.freeze([
  'not_run', 'blocked', 'failed', 'test_mode_rehearsed', 'live_rehearsed',
]);
const REHEARSED = Object.freeze(['test_mode_rehearsed', 'live_rehearsed']);

// Evidence must be opaque ids + timestamps only. These patterns are the banned
// content classes: emails, card-like numbers, and provider secrets.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
const SECRET_RE = /\b(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|rk_(live|test)_[A-Za-z0-9]+)\b/;

/** A fresh not_run record skeleton for a candidate — the shape the owner fills. */
function emptyRecord(candidateSha) {
  return {
    schema: 'rehearsal-record-1',
    candidate_sha: candidateSha || null,
    matrix: 'ordered_recovery_sequence',
    transition_count: TRANSITION_COUNT,
    rows: CANONICAL_MATRIX.map((r) => ({
      id: r.id, status: 'not_run', evidence: null, observed_at_utc: null,
    })),
  };
}

function isPlainObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

/**
 * Validate a completed-rehearsal record. Returns a list of problems ([] = the
 * record can be believed). It rejects: a candidate mismatch, missing/extra/
 * duplicate rows, an unknown status, a rehearsed row with no observation, reused
 * evidence, PII/secret content in evidence, and a live_required row satisfied
 * only in test mode.
 */
function validateRehearsalRecord(record, { candidateSha } = {}) {
  const problems = [];
  if (!isPlainObject(record)) return ['rehearsal record is not an object'];
  if (record.schema !== 'rehearsal-record-1') problems.push(`unknown record schema: ${JSON.stringify(record.schema)}`);
  if (candidateSha && record.candidate_sha !== candidateSha) {
    problems.push(`record candidate ${record.candidate_sha} does not match the pinned candidate ${candidateSha}`);
  }
  if (record.transition_count != null && record.transition_count !== TRANSITION_COUNT) {
    problems.push(`record transition_count ${record.transition_count} is not the canonical ${TRANSITION_COUNT}`);
  }

  const rows = Array.isArray(record.rows) ? record.rows : [];
  const seenIds = new Set();
  const seenEvidence = new Set();

  for (const id of STEP_IDS) {
    if (!rows.some((r) => r && r.id === id)) problems.push(`missing rehearsal row: ${id}`);
  }
  for (const row of rows) {
    if (!isPlainObject(row) || !row.id) { problems.push('a rehearsal row has no id'); continue; }
    if (!STEP_IDS.includes(row.id)) { problems.push(`unknown rehearsal row id: ${row.id}`); continue; }
    if (seenIds.has(row.id)) problems.push(`duplicate rehearsal row: ${row.id}`);
    seenIds.add(row.id);

    if (!REHEARSAL_STATUSES.includes(row.status)) {
      problems.push(`row ${row.id}: unknown status ${JSON.stringify(row.status)}`);
      continue;
    }
    const spec = CANONICAL_MATRIX.find((r) => r.id === row.id);

    if (REHEARSED.includes(row.status)) {
      // A "passed" row without observation is a headline, not evidence.
      if (!row.evidence) problems.push(`row ${row.id}: claims ${row.status} but carries no evidence`);
      if (!row.observed_at_utc) problems.push(`row ${row.id}: claims ${row.status} but has no observed_at_utc`);
      // Reused evidence across rows is how one observation is stretched to cover many.
      if (row.evidence) {
        const key = String(row.evidence).trim().toLowerCase();
        if (seenEvidence.has(key)) problems.push(`row ${row.id}: reuses evidence already cited by another row`);
        seenEvidence.add(key);
      }
      // Test-mode can never satisfy a live-required row for public_paid.
      if (row.status === 'test_mode_rehearsed' && spec.live_required) {
        problems.push(`row ${row.id}: is live_required but only test_mode_rehearsed — test-mode proof cannot satisfy a live row`);
      }
    }

    // Evidence must be opaque: no emails, card data or provider secrets.
    for (const field of ['evidence', 'note']) {
      const v = row[field];
      if (typeof v !== 'string') continue;
      if (EMAIL_RE.test(v)) problems.push(`row ${row.id}: ${field} contains an email — evidence must be opaque ids only`);
      if (CARD_RE.test(v)) problems.push(`row ${row.id}: ${field} contains card-like digits`);
      if (SECRET_RE.test(v)) problems.push(`row ${row.id}: ${field} contains a provider secret`);
    }
  }
  return problems;
}

/**
 * Completeness of the LIVE rehearsal for the public_paid track. A row counts as
 * live-satisfied only when it is live_rehearsed (test mode never counts here).
 * Non-live_required rows count when rehearsed in any mode. Returns which rows
 * remain outstanding, so an accepted risk stays visible until none do.
 */
function liveRehearsalCompleteness(record) {
  const rows = isPlainObject(record) && Array.isArray(record.rows) ? record.rows : [];
  const byId = new Map(rows.map((r) => [r && r.id, r]));
  const outstanding = [];
  for (const spec of CANONICAL_MATRIX) {
    const row = byId.get(spec.id) || {};
    const ok = spec.live_required
      ? row.status === 'live_rehearsed'
      : REHEARSED.includes(row.status);
    if (!ok) outstanding.push(spec.id);
  }
  return { complete: outstanding.length === 0, outstanding, live_required: [...LIVE_REQUIRED_IDS] };
}

module.exports = {
  CANONICAL_MATRIX,
  STEP_IDS,
  TRANSITION_COUNT,
  LATE_FAILURE_STEP,
  LIVE_REQUIRED_IDS,
  REHEARSAL_STATUSES,
  emptyRecord,
  validateRehearsalRecord,
  liveRehearsalCompleteness,
};
