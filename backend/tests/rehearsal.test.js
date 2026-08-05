// ---------------------------------------------------------------------------
// v15 SC-04 — the canonical live-money rehearsal matrix and record schema.
//
// One canonical transition list (eight rows, ids A–H) must be the same in the
// runbook, the launch-state manifest and here. And a completed-rehearsal record
// must be impossible to fake: partial, stale, reused or PII-bearing evidence, or
// a live-required row "satisfied" only in test mode, all fail validation. These
// are deterministic schema tests — they are NOT themselves live billing evidence.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CANONICAL_MATRIX, STEP_IDS, TRANSITION_COUNT, LATE_FAILURE_STEP, LIVE_REQUIRED_IDS,
  emptyRecord, validateRehearsalRecord, liveRehearsalCompleteness,
} = require('../lib/rehearsal');

const ROOT = path.join(__dirname, '..', '..');
const SHA = 'a'.repeat(40);

// --- the matrix is one canonical list -------------------------------------

test('the canonical matrix is eight ordered rows A–H, G is the late-failure regression', () => {
  assert.equal(TRANSITION_COUNT, 8);
  assert.deepEqual(STEP_IDS, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.equal(LATE_FAILURE_STEP, 'G');
  const g = CANONICAL_MATRIX.find((r) => r.id === 'G');
  assert.ok(/stays active/i.test(g.expected_stripe));
  assert.ok(/regression/i.test(g.stop_condition));
  // The money-moving / ordering rows are live-required; pure trial/cancel are not.
  assert.deepEqual(LIVE_REQUIRED_IDS, ['B', 'E', 'F', 'G', 'H']);
});

test('every row specifies the full per-row contract', () => {
  for (const r of CANONICAL_MATRIX) {
    for (const field of ['precondition', 'owner_action', 'expected_stripe', 'expected_db',
      'expected_entitlement', 'expected_side_effect', 'stop_condition']) {
      assert.ok(r[field] && String(r[field]).length > 0, `row ${r.id} missing ${field}`);
    }
  }
});

test('launch-state and the runbook agree with the canonical matrix', () => {
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/launch/launch-state.json'), 'utf8'));
  const r = state.live_money_rehearsal;
  assert.equal(r.transition_count, TRANSITION_COUNT);
  assert.deepEqual(r.step_ids, STEP_IDS);
  assert.equal(r.late_failure_step, LATE_FAILURE_STEP);

  const runbook = fs.readFileSync(path.join(ROOT, 'docs/RUNBOOK_TRANSACTION_REHEARSAL.md'), 'utf8');
  assert.ok(/eight-transition/i.test(runbook), 'runbook must name the eight-transition sequence');
  // Each ordered step id appears as a table row ("| A |" … "| H |").
  for (const id of STEP_IDS) {
    assert.ok(new RegExp(`\\|\\s*${id}\\s*\\|`).test(runbook), `runbook missing ordered step row ${id}`);
  }
});

// --- the record schema ----------------------------------------------------

test('a fresh not_run record validates and is incomplete', () => {
  const rec = emptyRecord(SHA);
  assert.deepEqual(validateRehearsalRecord(rec, { candidateSha: SHA }), []);
  const c = liveRehearsalCompleteness(rec);
  assert.equal(c.complete, false);
  assert.deepEqual(c.outstanding, STEP_IDS); // nothing rehearsed yet
});

function fullLiveRecord() {
  return {
    schema: 'rehearsal-record-1',
    candidate_sha: SHA,
    matrix: 'ordered_recovery_sequence',
    transition_count: 8,
    rows: STEP_IDS.map((id, i) => ({
      id, status: 'live_rehearsed', evidence: `evt_${id}_${i}`, observed_at_utc: '2026-08-05T10:00:00Z',
    })),
  };
}

test('a complete live record with unique evidence validates and is complete', () => {
  const rec = fullLiveRecord();
  assert.deepEqual(validateRehearsalRecord(rec, { candidateSha: SHA }), []);
  assert.equal(liveRehearsalCompleteness(rec).complete, true);
});

test('a candidate mismatch is rejected', () => {
  const rec = fullLiveRecord();
  const problems = validateRehearsalRecord(rec, { candidateSha: 'b'.repeat(40) });
  assert.ok(problems.some((p) => /does not match the pinned candidate/.test(p)));
});

test('a missing row is rejected', () => {
  const rec = fullLiveRecord();
  rec.rows = rec.rows.filter((r) => r.id !== 'G');
  assert.ok(validateRehearsalRecord(rec, { candidateSha: SHA }).some((p) => /missing rehearsal row: G/.test(p)));
});

test('a rehearsed row with no observation is rejected', () => {
  const rec = fullLiveRecord();
  rec.rows[0].evidence = null;
  rec.rows[1].observed_at_utc = null;
  const problems = validateRehearsalRecord(rec, { candidateSha: SHA });
  assert.ok(problems.some((p) => /row A: claims live_rehearsed but carries no evidence/.test(p)));
  assert.ok(problems.some((p) => /row B: claims live_rehearsed but has no observed_at_utc/.test(p)));
});

test('reused evidence across rows is rejected', () => {
  const rec = fullLiveRecord();
  rec.rows[1].evidence = rec.rows[0].evidence; // B reuses A's evidence
  assert.ok(validateRehearsalRecord(rec, { candidateSha: SHA }).some((p) => /reuses evidence/.test(p)));
});

test('test-mode proof cannot satisfy a live-required row', () => {
  const rec = fullLiveRecord();
  const b = rec.rows.find((r) => r.id === 'B'); // B is live_required
  b.status = 'test_mode_rehearsed';
  const problems = validateRehearsalRecord(rec, { candidateSha: SHA });
  assert.ok(problems.some((p) => /row B: is live_required but only test_mode_rehearsed/.test(p)));
  // And it is not complete for public_paid.
  assert.ok(liveRehearsalCompleteness(rec).outstanding.includes('B'));
});

test('test-mode IS allowed to satisfy a non-live row for completeness', () => {
  const rec = emptyRecord(SHA);
  for (const row of rec.rows) {
    const live = LIVE_REQUIRED_IDS.includes(row.id);
    row.status = live ? 'live_rehearsed' : 'test_mode_rehearsed';
    row.evidence = `evt_${row.id}`;
    row.observed_at_utc = '2026-08-05T10:00:00Z';
  }
  assert.deepEqual(validateRehearsalRecord(rec, { candidateSha: SHA }), []);
  assert.equal(liveRehearsalCompleteness(rec).complete, true);
});

test('evidence bearing an email, card number or provider secret is rejected', () => {
  for (const [field, value, label] of [
    ['evidence', 'buyer@example.com', 'email'],
    ['evidence', '4242 4242 4242 4242', 'card'],
    ['note', 'whsec_abcdef123456', 'secret'],
  ]) {
    const rec = fullLiveRecord();
    rec.rows[0][field] = value;
    const problems = validateRehearsalRecord(rec, { candidateSha: SHA });
    assert.ok(problems.some((p) => /row A/.test(p)), `did not reject ${label}`);
  }
});

test('an unknown row status is rejected', () => {
  const rec = fullLiveRecord();
  rec.rows[0].status = 'passed';
  assert.ok(validateRehearsalRecord(rec, { candidateSha: SHA }).some((p) => /unknown status/.test(p)));
});
