// ---------------------------------------------------------------------------
// SC-95-04 — post-handoff feedback aggregated into the canonical scorecard as
// neutral evidence about manual rework and price value.
//
// Categories only: the free-text note is never read, aggregated or logged. The
// reduced-rework claim is BLOCKED by default and only supported once enough
// respondents report low manual work and zero nothing_usable — the product may
// not claim reduced rework until the evidence supports it.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { handoffFeedback, computeScorecard, MIN_COHORT } = require('../lib/beta-scorecard');

const exported = (ws) => ({ event: 'handoff_exported', workspace_id: ws });
const fb = (ws, ans) => ({ event: 'feedback_submitted', workspace_id: ws, properties: { moment: 'handoff', ...ans } });

test('notes are never aggregated — only allowlisted categories are counted', () => {
  const rows = [
    exported('w1'),
    // a note field must be ignored even if it somehow reaches the ledger
    { event: 'feedback_submitted', workspace_id: 'w1', properties: { moment: 'handoff', job_done: 'full_campaign', notes: 'client ACME paid $4000' } },
  ];
  const out = handoffFeedback(rows, {});
  const blob = JSON.stringify(out);
  assert.ok(!/ACME|4000|paid \$/i.test(blob), 'no note CONTENT may appear in the aggregate');
  assert.equal(out.counts.job_done.full_campaign, 1);
});

test('cancel-moment feedback is not counted as handoff feedback', () => {
  const rows = [exported('w1'), { event: 'feedback_submitted', workspace_id: 'w1', properties: { moment: 'cancel', job_done: 'full_campaign' } }];
  assert.equal(handoffFeedback(rows, {}).respondents, 0);
});

test('response rate = respondents over workspaces that exported a handoff', () => {
  const rows = [exported('w1'), exported('w2'), exported('w3'), exported('w4'), fb('w1', { job_done: 'full_campaign' }), fb('w2', { job_done: 'single_asset' })];
  const out = handoffFeedback(rows, {});
  assert.equal(out.eligible, 4);
  assert.equal(out.respondents, 2);
  assert.equal(out.response_rate, 50);
});

test('one workspace answering twice counts once', () => {
  const rows = [exported('w1'), fb('w1', { manual_work: 'almost_none' }), fb('w1', { manual_work: 'heavy_editing' })];
  assert.equal(handoffFeedback(rows, {}).respondents, 1);
});

test('staff/test workspaces are excluded', () => {
  const rows = [exported('wStaff'), fb('wStaff', { job_done: 'full_campaign' })];
  assert.equal(handoffFeedback(rows, { roster: { workspaceIds: ['wStaff'] } }).respondents, 0);
});

test('no feedback → no_data, claim blocked, never a false zero-that-reads-positive', () => {
  const out = handoffFeedback([exported('w1')], {});
  assert.equal(out.state, 'no_data');
  assert.equal(out.reduced_rework_claim_supported, false);
});

function positiveCohort() {
  // MIN_COHORT respondents, all low manual work, none nothing_usable.
  const rows = [];
  for (let i = 1; i <= MIN_COHORT; i++) {
    rows.push(exported(`w${i}`));
    rows.push(fb(`w${i}`, { job_done: 'full_campaign', manual_work: i % 2 ? 'almost_none' : 'light_editing', price_view: 'about_right' }));
  }
  return rows;
}

test('reduced-rework claim is supported only with enough low-manual-work evidence', () => {
  const out = handoffFeedback(positiveCohort(), {});
  assert.equal(out.state, 'reported');
  assert.equal(out.heavy_or_rewrote_rate, 0);
  assert.equal(out.nothing_usable_count, 0);
  assert.equal(out.reduced_rework_claim_supported, true);
});

test('a single nothing_usable blocks the reduced-rework claim', () => {
  const rows = positiveCohort();
  rows.push(exported('wX'));
  rows.push(fb('wX', { job_done: 'nothing_usable', manual_work: 'rewrote_most' }));
  const out = handoffFeedback(rows, {});
  assert.ok(out.nothing_usable_count >= 1);
  assert.equal(out.reduced_rework_claim_supported, false);
});

test('heavy_editing/rewrote_most majority blocks the reduced-rework claim', () => {
  const rows = [];
  for (let i = 1; i <= MIN_COHORT + 1; i++) {
    rows.push(exported(`w${i}`));
    rows.push(fb(`w${i}`, { manual_work: 'heavy_editing' }));
  }
  const out = handoffFeedback(rows, {});
  assert.equal(out.heavy_or_rewrote_rate, 100);
  assert.equal(out.reduced_rework_claim_supported, false);
});

test('the scorecard carries handoff_feedback; an analytics outage marks it unavailable', () => {
  const ok = computeScorecard(positiveCohort(), {});
  assert.ok(ok.handoff_feedback);
  assert.equal(ok.handoff_feedback.state, 'reported');
  const outage = computeScorecard([], { dataAvailable: false });
  assert.equal(outage.handoff_feedback.state, 'unavailable');
  assert.equal(outage.handoff_feedback.reduced_rework_claim_supported, false);
});
