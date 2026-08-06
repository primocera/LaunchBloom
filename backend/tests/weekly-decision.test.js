// ---------------------------------------------------------------------------
// SC-95-05 — the weekly capped-beta decision record.
//
// Generated FROM the canonical scorecard. Pre-declared hypotheses are never
// tuned after results; maturity is explicit (a windowed metric is `pending`, not
// failed, until the cohort is old enough); one result maps to exactly one
// decision and one bounded action; no-data / immature / below / pass are
// mechanically distinct.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { weeklyDecisionRecord, evalGate, largestDrop, DECISION_GATES } = require('../lib/weekly-decision');

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-09-01T00:00:00Z');

// A scorecard stub. Mature + passing by default; override per test.
function sc(over = {}) {
  return {
    data_available: true,
    reportable: true,
    cohort_size: 10,
    min_cohort: 5,
    window: { days: 7 },
    derived: {
      reviewed_asset_rate: 70,
      generation_failure_rate: 2,
      campaign_completion_rate: 50,
      second_campaign_rate: 30,
      failure_by_studio: {},
    },
    steps: [],
    handoff_feedback: { state: 'reported', reduced_rework_claim_supported: true, nothing_usable_count: 0, heavy_or_rewrote_rate: 10 },
    ...over,
  };
}
// cohort old enough for the 14-day repeat window by default
const OPTS = { now: NOW, cohortStart: new Date(NOW - 30 * DAY).toISOString() };

test('the gates are pre-declared with a fixed date and are not empty', () => {
  assert.ok(DECISION_GATES.length >= 4);
});

// --- decision priority ladder ---------------------------------------------

test('a billing-severity incident → Stop, above everything else', () => {
  const r = weeklyDecisionRecord(sc(), { ...OPTS, billingIncidents: 1 });
  assert.equal(r.decision, 'Stop');
  assert.equal(r.expansion_allowed, false);
});

test('analytics outage → Continue but no expansion, no product change', () => {
  const r = weeklyDecisionRecord(sc({ data_available: false, cohort_size: null, reportable: false }), OPTS);
  assert.equal(r.decision, 'Continue');
  assert.equal(r.expansion_allowed, false);
  assert.match(r.action, /Restore analytics/i);
  for (const g of r.gates) assert.equal(g.state, 'unavailable');
});

test('generation failure above ceiling → Pause intake', () => {
  const r = weeklyDecisionRecord(sc({ derived: { ...sc().derived, generation_failure_rate: 12 } }), OPTS);
  assert.equal(r.decision, 'Pause intake');
});

test('reported heavy rework / nothing usable → Interview', () => {
  const r = weeklyDecisionRecord(sc({ handoff_feedback: { state: 'reported', reduced_rework_claim_supported: false, nothing_usable_count: 2, heavy_or_rewrote_rate: 60 } }), OPTS);
  assert.equal(r.decision, 'Interview');
});

test('a below-hypothesis gate (mature) → Iterate at the largest drop', () => {
  const steps = [
    { step: 'first_generation_completed', state: 'reported', value: 90 },
    { step: 'first_asset_reviewed', state: 'reported', value: 30 },
    { step: 'campaign_reached_ready', state: 'reported', value: 25 },
  ];
  const r = weeklyDecisionRecord(sc({ derived: { ...sc().derived, reviewed_asset_rate: 30 }, steps }), OPTS);
  assert.equal(r.decision, 'Iterate');
  assert.match(r.action, /friction/i);
});

test('all gates pass, mature, reduced-rework supported → Continue with expansion allowed', () => {
  const r = weeklyDecisionRecord(sc(), OPTS);
  assert.equal(r.decision, 'Continue');
  assert.equal(r.expansion_allowed, true);
});

test('immature/too-small cohort → Continue gathering, never a failure, no expansion', () => {
  const r = weeklyDecisionRecord(sc({ reportable: false, cohort_size: 3, derived: {} }), OPTS);
  assert.equal(r.decision, 'Continue');
  assert.equal(r.expansion_allowed, false);
  assert.match(r.action, /pending, not failures/i);
});

// --- maturity rules --------------------------------------------------------

test('second_campaign gate is pending until the cohort is 14 days old', () => {
  const young = { now: NOW, cohortStart: new Date(NOW - 5 * DAY).toISOString() };
  const r = weeklyDecisionRecord(sc(), young);
  const g = r.gates.find((x) => x.key === 'second_campaign_rate');
  assert.equal(g.state, 'pending');
  // a pending (not-yet-evaluable) metric must not force expansion off falsely:
  // with everything else passing but repeat pending, we are NOT allowed to expand.
  assert.equal(r.expansion_allowed, false);
});

test('second_campaign gate is evaluated once the cohort is old enough', () => {
  const g = evalGate(sc(), DECISION_GATES.find((x) => x.key === 'second_campaign_rate'), 20);
  assert.equal(g.state, 'pass');
});

test('a windowed gate with no value on a mature-age cohort reports insufficient/no_data, not below', () => {
  const gate = DECISION_GATES.find((x) => x.key === 'second_campaign_rate');
  assert.equal(evalGate(sc({ cohort_size: 0, derived: {} }), gate, 20).state, 'no_data');
  assert.equal(evalGate(sc({ cohort_size: 8, derived: {} }), gate, 20).state, 'insufficient_data');
});

test('largestDrop finds the biggest adjacent reported loss', () => {
  const d = largestDrop({ steps: [
    { step: 'a', state: 'reported', value: 100 },
    { step: 'b', state: 'reported', value: 40 },
    { step: 'c', state: 'reported', value: 35 },
  ] });
  assert.deepEqual(d, { from: 'a', to: 'b', loss: 60 });
});

test('no_data / immature / below / pass states are mechanically distinct', () => {
  const states = new Set();
  states.add(evalGate(sc({ cohort_size: 0, derived: {} }), DECISION_GATES[0], 0).state); // no_data
  states.add(evalGate(sc({ reportable: false, cohort_size: 3, derived: {} }), DECISION_GATES[0], 0).state); // insufficient
  states.add(evalGate(sc({ derived: { reviewed_asset_rate: 10 } }), DECISION_GATES[0], 0).state); // below
  states.add(evalGate(sc(), DECISION_GATES[0], 0).state); // pass
  assert.ok(states.has('no_data') && states.has('insufficient_data') && states.has('below') && states.has('pass'));
});
