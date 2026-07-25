// ---------------------------------------------------------------------------
// v10 SC-07 — cohort funnel maths.
//
// These numbers drive decisions about what to build next, so the failure mode
// is not a crash — it is a plausible-looking percentage that says the opposite
// of the truth.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeFunnel, biggestDropOff, costPerOutcome, MIN_COHORT, COHORT_FUNNEL } = require('../lib/cohort');
const { CANONICAL_EVENTS } = require('../lib/analytics');

/** Event rows for `subjects` reaching the first `stepsReached` milestones. */
function rowsFor(subjects, stepsReached) {
  const rows = [];
  for (const id of subjects) {
    for (const f of COHORT_FUNNEL.slice(0, stepsReached)) {
      if (!f.event) continue;
      rows.push({ event: f.event, workspace_id: id, campaign_id: id, created_at: '2026-07-01T00:00:00Z' });
    }
  }
  return rows;
}

const many = (n, prefix = 'ws') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

// ── the funnel the pack specifies ──────────────────────────────────────────

test('the funnel is the eleven steps the pack specifies, in order', () => {
  assert.deepEqual(COHORT_FUNNEL.map((f) => f.key), [
    'workspace_created', 'minimum_profile_reached', 'brief_approved', 'first_asset_saved',
    'three_channel_types', 'finding_resolved', 'asset_ready', 'handoff_previewed',
    'handoff_exported', 'campaign_reopened', 'subscription_renewed',
  ]);
});

test('every milestone is backed by a REGISTERED canonical event', () => {
  // An unregistered event is silently dropped by the events route, so a step
  // pointing at one would report a permanent, believable zero.
  for (const f of COHORT_FUNNEL) {
    assert.ok(f.event, `${f.key} has no event — the milestone would be unmeasurable`);
    assert.ok(CANONICAL_EVENTS[f.event], `${f.key} uses unregistered event "${f.event}"`);
  }
});

test('every step carries a question and a decision', () => {
  const funnel = computeFunnel(rowsFor(many(10), 3));
  for (const s of funnel.steps) {
    assert.ok(s.question, `${s.step} has no question`);
    assert.ok(s.decision, `${s.step} has no decision — a metric that maps to no action is decoration`);
    assert.equal(typeof s.numerator, 'number');
    assert.equal(typeof s.denominator, 'number');
  }
});

test('rates are computed against the entering cohort, and per-step', () => {
  const rows = [...rowsFor(many(10), 2), ...rowsFor(many(4), 3)];
  const funnel = computeFunnel(rows);
  const third = funnel.steps[2];
  assert.equal(third.numerator, 4);
  assert.equal(third.denominator, 10);
  assert.equal(third.value, 40, 'of everyone who entered');
  assert.equal(third.step_value, 40, 'of those who reached the previous step');
});

test('a duplicated event does not inflate a step', () => {
  const rows = rowsFor(many(6), 2);
  const funnel = computeFunnel([...rows, ...rows]);
  assert.equal(funnel.steps[0].numerator, 6, 'subjects are counted distinctly');
  assert.equal(funnel.steps[1].numerator, 6);
});

test('the window is echoed back so a rate can never be read without it', () => {
  const funnel = computeFunnel(rowsFor(many(6), 1), { window: { days: 30, since: '2026-06-26' } });
  assert.deepEqual(funnel.window, { days: 30, since: '2026-06-26' });
});

// ── suppression ────────────────────────────────────────────────────────────

test('a tiny cohort is suppressed rather than reported as a percentage', () => {
  const funnel = computeFunnel(rowsFor(many(3), 2));
  assert.equal(funnel.cohort_size, 3);
  assert.equal(funnel.reportable, false);
  for (const s of funnel.steps) {
    assert.equal(s.value, null, 'no rate may be published for 3 accounts');
    assert.equal(s.state, 'insufficient_data');
    assert.match(s.decision, /too few/i);
    // The raw count remains — suppression hides the RATE, which is what
    // misleads, not the fact that three accounts exist.
    assert.equal(typeof s.numerator, 'number');
  }
});

test('the threshold is a boundary, not an approximation', () => {
  assert.equal(computeFunnel(rowsFor(many(MIN_COHORT - 1), 1)).reportable, false);
  assert.equal(computeFunnel(rowsFor(many(MIN_COHORT), 1)).reportable, true);
});

test('no data is distinct from zero', () => {
  const empty = computeFunnel([]);
  assert.equal(empty.cohort_size, 0);
  for (const s of empty.steps) {
    assert.equal(s.state, 'no_data', 'an unmeasured step must not read as a zero result');
    assert.match(s.decision, /nothing to conclude/i);
  }

  const measured = computeFunnel(rowsFor(many(8), 1));
  assert.equal(measured.steps[0].state, 'reported');
  assert.equal(measured.steps[1].numerator, 0);
  assert.equal(measured.steps[1].value, 0, 'a real zero is a result, not missing data');
  assert.equal(measured.steps[1].state, 'reported');
});

// ── drop-off ───────────────────────────────────────────────────────────────

test('the biggest drop-off names the step where people are lost', () => {
  const rows = [...rowsFor(many(20), 2), ...rowsFor(many(5), 3), ...rowsFor(many(4), 4)];
  const worst = biggestDropOff(computeFunnel(rows));
  assert.equal(worst.from, 'minimum_profile_reached');
  assert.equal(worst.to, 'brief_approved');
  assert.equal(worst.lost, 15);
  assert.equal(worst.of, 20);
  assert.ok(worst.decision, 'the drop-off must carry the action it implies');
});

test('no drop-off is claimed for a cohort too small to support one', () => {
  const rows = [...rowsFor(many(3), 2), ...rowsFor(many(1), 3)];
  assert.equal(biggestDropOff(computeFunnel(rows)), null, 'two users changing their minds is not a finding');
});

test('a perfect funnel reports no drop-off rather than a zero-sized one', () => {
  assert.equal(biggestDropOff(computeFunnel(rowsFor(many(10), COHORT_FUNNEL.length))), null);
});

// ── cost ───────────────────────────────────────────────────────────────────

test('cost per outcome divides real spend by a real count', () => {
  assert.equal(costPerOutcome(12.5, 10), 1.25);
  assert.equal(costPerOutcome(1, 3), 0.3333);
});

test('cost per outcome refuses to divide by nothing', () => {
  // "$0.00 per activated account" from unknown spend is worse than no number.
  for (const bad of [[10, 0], [10, null], [null, 5], ['x', 5], [10, -1], ['', 5], [-1, 5]]) {
    assert.equal(costPerOutcome(bad[0], bad[1]), null, `costPerOutcome(${JSON.stringify(bad)}) should be null`);
  }
});

// ── failure injection ──────────────────────────────────────────────────────

test('malformed event rows never throw', () => {
  const junk = [null, undefined, {}, { event: 'workspace_created' }, { workspace_id: 'x' }, 42, 'nope', []];
  const funnel = computeFunnel(junk);
  assert.equal(funnel.steps.length, COHORT_FUNNEL.length);
  assert.equal(funnel.cohort_size, 0, 'a row with no subject id cannot enter the cohort');
});

test('a non-array payload degrades to an empty funnel', () => {
  for (const bad of [null, undefined, 'rows', 42, {}]) {
    const funnel = computeFunnel(bad);
    assert.equal(funnel.cohort_size, 0);
    assert.equal(funnel.steps.length, COHORT_FUNNEL.length);
  }
});
