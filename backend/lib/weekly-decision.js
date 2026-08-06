// ---------------------------------------------------------------------------
// SC-95-05 — the weekly capped-beta decision record.
//
// One internal, mechanical decision generated FROM the canonical scorecard
// (lib/beta-scorecard.js) — not a second scorecard and not a hand-filled memo.
// It applies PRE-DECLARED hypotheses (fixed before the cohort; never tuned after
// seeing results) and explicit maturity rules, then maps the result to exactly
// one decision and one bounded action.
//
// Maturity rule (honest, cohort-level): a metric that needs a time window
// (repeat campaign, D7 return, renewal) is `pending` until the cohort itself is
// old enough for that window. New users are PENDING, never failures. A low
// result maps to removing friction/rework at the relevant stage — never to
// adding another generator.
//
// Pure and DB-free so every decision is reproducible from its inputs.
// ---------------------------------------------------------------------------

'use strict';

// Pre-registered BEFORE the beta cohort. Do not edit after a cohort starts; the
// owner records a dated change and starts a NEW cohort instead. Mirrors the
// hypotheses in beta-scorecard.js PROVISIONAL_THRESHOLDS.
const DECLARED_AT = '2026-08-06';
const DECISION_GATES = Object.freeze([
  { key: 'reviewed_asset_rate', dir: 'gte', target: 60, window_days: 0, stage: 'review' },
  { key: 'generation_failure_rate', dir: 'lte', target: 5, window_days: 0, stage: 'generation' },
  { key: 'campaign_completion_rate', dir: 'gte', target: 40, window_days: 0, stage: 'campaign completion' },
  { key: 'second_campaign_rate', dir: 'gte', target: 25, window_days: 14, stage: 'repeat campaign' },
]);

const DAY_MS = 24 * 3600 * 1000;

function ageInDays(start, now) {
  const s = Date.parse(start);
  const n = now instanceof Date ? now.getTime() : Number(now);
  if (Number.isNaN(s) || Number.isNaN(n)) return null;
  return Math.max(0, Math.floor((n - s) / DAY_MS));
}

/** Evaluate one gate against the scorecard, honouring maturity. */
function evalGate(scorecard, gate, cohortAgeDays) {
  if (scorecard.data_available === false) return { key: gate.key, state: 'unavailable', value: null, target: gate.target, dir: gate.dir };
  if (gate.window_days > 0 && (cohortAgeDays == null || cohortAgeDays < gate.window_days)) {
    return { key: gate.key, state: 'pending', value: null, target: gate.target, dir: gate.dir,
      note: `needs ${gate.window_days}d of cohort age (currently ${cohortAgeDays == null ? 'unknown' : cohortAgeDays}d)` };
  }
  const value = scorecard.derived ? scorecard.derived[gate.key] : null;
  if (value == null) {
    const cohort = scorecard.cohort_size;
    const state = cohort === 0 || cohort == null ? 'no_data' : 'insufficient_data';
    return { key: gate.key, state, value: null, target: gate.target, dir: gate.dir };
  }
  const pass = gate.dir === 'gte' ? value >= gate.target : value <= gate.target;
  return { key: gate.key, state: pass ? 'pass' : 'below', value, target: gate.target, dir: gate.dir };
}

/** Biggest adjacent conversion drop among steps that report a real value. */
function largestDrop(scorecard) {
  const steps = (scorecard.steps || []).filter((s) => s.state === 'reported' && s.value != null);
  let worst = null;
  for (let i = 1; i < steps.length; i++) {
    const loss = steps[i - 1].value - steps[i].value;
    if (worst == null || loss > worst.loss) worst = { from: steps[i - 1].step, to: steps[i].step, loss: +loss.toFixed(1) };
  }
  return worst;
}

/**
 * Build the weekly decision record.
 *
 * scorecard: output of computeScorecard.
 * opts: { now, cohortStart, invited, activated, billingIncidents }
 *   billingIncidents — count of billing-severity incidents in the window (0 = ok).
 */
function weeklyDecisionRecord(scorecard = {}, { now = Date.now(), cohortStart = null, invited = null, billingIncidents = 0 } = {}) {
  const cohortAgeDays = cohortStart ? ageInDays(cohortStart, now) : null;
  const activated = scorecard.cohort_size ?? null;
  const mature = scorecard.reportable === true && scorecard.data_available !== false;

  const gates = DECISION_GATES.map((g) => evalGate(scorecard, g, cohortAgeDays));
  const gateBy = Object.fromEntries(gates.map((g) => [g.key, g]));
  const below = gates.filter((g) => g.state === 'below');
  const drop = largestDrop(scorecard);

  const fb = scorecard.handoff_feedback || {};
  const reworkBlocked = fb.state === 'reported'
    && (fb.reduced_rework_claim_supported === false)
    && ((fb.nothing_usable_count || 0) > 0 || (fb.heavy_or_rewrote_rate != null && fb.heavy_or_rewrote_rate >= 50));

  // --- the one decision, by priority ---------------------------------------
  let decision;
  let action;
  let expansion_allowed = false;

  if (billingIncidents > 0) {
    decision = 'Stop';
    action = 'Halt expansion and investigate the billing-severity incident(s) before any other change.';
  } else if (scorecard.data_available === false) {
    decision = 'Continue';
    action = 'Restore analytics — no product decision can be made on an unavailable read. Do not expand.';
  } else if (gateBy.generation_failure_rate.state === 'below') {
    decision = 'Pause intake';
    action = 'Stop adding users and fix generation reliability — the failure rate is above the ceiling.';
  } else if (reworkBlocked) {
    decision = 'Interview';
    action = 'Interview the users who reported heavy rework / nothing usable before changing the product.';
  } else if (below.length > 0) {
    decision = 'Iterate';
    action = drop
      ? `Remove friction at the largest drop (${drop.from} → ${drop.to}); one experiment behind one owner flag.`
      : `Remove friction at the weakest gate (${below[0].key}); one experiment behind one owner flag.`;
  } else if (mature && gates.every((g) => g.state === 'pass') && fb.reduced_rework_claim_supported === true) {
    decision = 'Continue';
    expansion_allowed = true;
    action = 'Expand the cohort by a small, bounded increment; keep one canonical flow.';
  } else {
    decision = 'Continue';
    action = 'Keep gathering — the cohort is not yet mature or large enough. New users are pending, not failures.';
  }

  return {
    schema: 'weekly-decision/v16',
    generated_at: new Date(now).toISOString(),
    predeclared_at: DECLARED_AT,
    window: scorecard.window || null,
    cohort: {
      invited: invited == null ? null : Number(invited),
      activated,
      mature_for_repeat: cohortAgeDays != null && cohortAgeDays >= 14,
      cohort_age_days: cohortAgeDays,
      reportable: scorecard.reportable === true,
      min_cohort: scorecard.min_cohort ?? null,
      data_available: scorecard.data_available !== false,
    },
    gates,
    largest_drop: drop,
    generation_failure_rate: scorecard.derived ? scorecard.derived.generation_failure_rate : null,
    failure_by_studio: scorecard.derived ? scorecard.derived.failure_by_studio || {} : {},
    handoff_feedback: {
      state: fb.state || 'no_data',
      respondents: fb.respondents ?? null,
      response_rate: fb.response_rate ?? null,
      reduced_rework_claim_supported: fb.reduced_rework_claim_supported === true,
    },
    billing_incidents: Number(billingIncidents) || 0,
    decision,
    expansion_allowed,
    action,
    disclaimer:
      'Internal capped-beta decision aid. Gates are pre-registered HYPOTHESES (predeclared_at), ' +
      'not benchmarks; never customer-facing. One low metric yields one bounded learning action, ' +
      'not a new generator. Beta readiness may reach 9.5 after technical/owner gates; public-paid ' +
      'readiness cannot without mature value and billing evidence.',
  };
}

module.exports = {
  DECLARED_AT,
  DECISION_GATES,
  ageInDays,
  evalGate,
  largestDrop,
  weeklyDecisionRecord,
};
