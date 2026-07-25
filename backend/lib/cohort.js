// ---------------------------------------------------------------------------
// v10 SC-07 — the cohort funnel the pack specifies:
//
//   workspace created → minimum Brand Profile → brief approved → first asset →
//   three channel types → finding resolved → Ready asset → handoff preview →
//   export → campaign reopened → subscription renewal
//
// Pure, so the numbers are testable without a database and reconcilable to the
// source tables by hand.
//
// Three rules the pack requires and this module enforces:
//   • every metric shows numerator, denominator, cohort/window and a decision;
//   • tiny cohorts are suppressed;
//   • "insufficient data" and "no data" are distinct from a zero result.
//
// Metrics here are internal decision aids. Nothing computed in this file may
// be shown to a customer or used as public proof.
// ---------------------------------------------------------------------------

// Below this many accounts in the denominator, rates are suppressed. 5 is the
// conventional small-cell threshold; with a 15–25 user beta it will bite often,
// which is correct — most weeks genuinely will not be conclusive.
const MIN_COHORT = 5;

/**
 * The funnel, in the pack's order. `event` is the canonical analytics event
 * that confirms the step server-side; `null` means the milestone has no
 * instrumentation yet and the step reports `unavailable` rather than a zero
 * that would read as "nobody did this".
 */
const COHORT_FUNNEL = [
  { key: 'workspace_created', event: 'workspace_created', scope: 'workspace',
    label: 'Workspace created', question: 'How many accounts start?',
    decision: 'If this is flat, the problem is acquisition, not the product.' },
  { key: 'minimum_profile_reached', event: 'minimum_profile_reached', scope: 'workspace',
    label: 'Minimum Brand Profile', question: 'Do they give us enough to work with?',
    decision: 'A drop here means setup asks for too much before showing value.' },
  { key: 'brief_approved', event: 'brief_approved', scope: 'campaign',
    label: 'Brief approved', question: 'Do they commit to a campaign?',
    decision: 'A drop here means the brief feels like paperwork, not a decision.' },
  { key: 'first_asset_saved', event: 'first_asset_saved', scope: 'workspace',
    label: 'First asset saved', question: 'Do they produce anything?',
    decision: 'A drop here means generation is not reachable or not trusted.' },
  { key: 'three_channel_types', event: 'three_channel_types_reached', scope: 'campaign',
    label: 'Three channel types', question: 'Do they use it as a CAMPAIGN, not one generator?',
    decision: 'This is the paid job. A drop here means we are a single-asset tool.' },
  { key: 'finding_resolved', event: 'first_finding_resolved', scope: 'workspace',
    label: 'Finding resolved', question: 'Do they engage with review, not just generation?',
    decision: 'A drop here means the consistency engine is ignored or unclear.' },
  { key: 'asset_ready', event: 'first_asset_ready', scope: 'workspace',
    label: 'Asset marked Ready', question: 'Do they finish an asset?',
    decision: 'A drop here means output needs more rework than it saves.' },
  { key: 'handoff_previewed', event: 'handoff_previewed', scope: 'campaign',
    label: 'Handoff previewed', question: 'Do they reach the deliverable?',
    decision: 'A drop between Ready and preview means the packet is not discoverable.' },
  { key: 'handoff_exported', event: 'handoff_exported', scope: 'campaign',
    label: 'Handoff exported', question: 'Do they take the work out? (the value moment)',
    decision: 'Preview without export means the packet is not good enough to send.' },
  { key: 'campaign_reopened', event: 'approved_brief_reopened', scope: 'campaign',
    label: 'Campaign reopened', question: 'Do they come back and revise?',
    decision: 'Reopening is repeat value, not failure — zero here means one-and-done use.' },
  { key: 'subscription_renewed', event: 'subscription_renewed', scope: 'workspace',
    label: 'Subscription renewed', question: 'Do they pay a second time?',
    decision: 'The only durable proof the job was worth paying for.' },
];

/**
 * One funnel step. `reached` counts DISTINCT subjects: a user firing an event
 * twice counts once, or every rate below it inflates silently.
 */
function step({ def, reached, cohort, previous, minCohort = MIN_COHORT, instrumented = true }) {
  const suppressed = cohort < minCohort;
  const rate = cohort > 0 ? +((reached / cohort) * 100).toFixed(1) : null;
  const stepRate = previous == null ? null : previous > 0 ? +((reached / previous) * 100).toFixed(1) : null;

  let state;
  if (!instrumented) state = 'unavailable';
  else if (cohort === 0) state = 'no_data';
  else if (suppressed) state = 'insufficient_data';
  else state = 'reported';

  const reportable = state === 'reported';

  return {
    step: def.key,
    label: def.label,
    question: def.question,
    numerator: instrumented ? reached : null,
    denominator: cohort,
    value: reportable ? rate : null,
    step_value: reportable ? stepRate : null,
    unit: 'percent',
    state,
    // Every metric maps to an action (acceptance criterion), and says plainly
    // when no action can be taken from it.
    decision: state === 'unavailable'
      ? 'Not instrumented yet — this milestone fires no server-confirmed event, so it cannot be measured.'
      : state === 'no_data'
        ? 'No accounts entered this window — nothing to conclude.'
        : state === 'insufficient_data'
          ? `Only ${cohort} account${cohort === 1 ? '' : 's'} in this cohort — too few to report a rate.`
          : def.decision,
  };
}

/**
 * Build the funnel from canonical event rows.
 * `rows` are { event, user_id, workspace_id, campaign_id, created_at } — ids
 * and timestamps only, never properties or content.
 *
 * The denominator is the FIRST step (accounts that entered), not a rolling
 * base, so every rate is comparable down the funnel.
 */
function computeFunnel(rows = [], { minCohort = MIN_COHORT, window = null } = {}) {
  // Coerce rather than guard: a non-array (a failed query returning null, a
  // number, a string) must degrade to an empty funnel, not throw inside an
  // admin request. `for...of` on a number throws.
  const safeRows = Array.isArray(rows) ? rows : [];

  const subjectsFor = (eventName, scope) => {
    const key = scope === 'campaign' ? 'campaign_id' : 'workspace_id';
    const set = new Set();
    for (const r of safeRows) {
      if (!r || typeof r !== 'object' || r.event !== eventName) continue;
      const id = r[key] || r.workspace_id || r.user_id;
      if (id) set.add(String(id));
    }
    return set;
  };

  const entered = COHORT_FUNNEL[0].event ? subjectsFor(COHORT_FUNNEL[0].event, COHORT_FUNNEL[0].scope).size : 0;

  let previous = null;
  const steps = COHORT_FUNNEL.map((def) => {
    const instrumented = Boolean(def.event);
    const reached = instrumented ? subjectsFor(def.event, def.scope).size : 0;
    const out = step({ def, reached, cohort: entered, previous, minCohort, instrumented });
    if (instrumented) previous = reached;
    return out;
  });

  return {
    cohort_size: entered,
    min_cohort: minCohort,
    window,
    reportable: entered >= minCohort,
    steps,
  };
}

/**
 * The largest drop between consecutive measured steps — where the product
 * actually loses people. Null when the cohort is too small to say, rather than
 * pointing at a drop that is one user changing their mind.
 */
function biggestDropOff(funnel) {
  if (!funnel || !funnel.reportable) return null;
  const measured = funnel.steps.filter((s) => s.state === 'reported');
  let worst = null;
  for (let i = 1; i < measured.length; i++) {
    const prev = measured[i - 1];
    const cur = measured[i];
    if (prev.numerator === 0) continue;
    const lost = prev.numerator - cur.numerator;
    if (lost <= 0) continue;
    if (!worst || lost > worst.lost) {
      worst = { from: prev.step, to: cur.step, lost, of: prev.numerator, question: cur.question, decision: cur.decision };
    }
  }
  return worst;
}

/**
 * AI cost per outcome, from ledger spend and a real account count.
 * Guards inputs BEFORE coercing: Number(null) is 0, which would report
 * "$0.00 per activated account" when the truth is that spend is unknown.
 */
function costPerOutcome(spendUsd, accounts) {
  if (spendUsd == null || spendUsd === '' || accounts == null || accounts === '') return null;
  const spend = Number(spendUsd);
  const n = Number(accounts);
  if (!Number.isFinite(spend) || !Number.isFinite(n) || n <= 0 || spend < 0) return null;
  return +(spend / n).toFixed(4);
}

module.exports = { MIN_COHORT, COHORT_FUNNEL, computeFunnel, biggestDropOff, costPerOutcome, step };
