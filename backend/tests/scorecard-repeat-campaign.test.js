// ---------------------------------------------------------------------------
// SC-95-03 — repeat-campaign value is measured, and never inflatable.
//
// second_campaign_created was permanently 'unavailable' (canonical:null) while a
// 25% gate depended on it. It is now derived server-side from campaign_created
// (emitted once per real persisted campaign, deduped per campaign id): distinct
// workspaces with >= 2 distinct campaigns, on the same activated-cohort
// denominator. A retried create, a re-post, or a template clone of the same
// campaign cannot inflate it. An analytics READ FAILURE reports unavailable, not
// a misleading zero.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  workspacesWithRepeatCampaigns,
  computeScorecard,
  MIN_COHORT,
} = require('../lib/beta-scorecard');

// helpers ------------------------------------------------------------------
const created = (ws, cid, extra = {}) => ({ event: 'campaign_created', workspace_id: ws, properties: { campaign_id: cid }, ...extra });
const activated = (ws) => ({ event: 'minimum_profile_reached', workspace_id: ws });

// --- the pure repeat derivation -------------------------------------------

test('one campaign in a workspace → not a repeat', () => {
  assert.equal(workspacesWithRepeatCampaigns([created('w1', 'c1')], 2).size, 0);
});

test('two DISTINCT campaigns in a workspace → repeat', () => {
  assert.equal(workspacesWithRepeatCampaigns([created('w1', 'c1'), created('w1', 'c2')], 2).size, 1);
});

test('the SAME campaign id twice (duplicate/retry/re-post) → still one, not a repeat', () => {
  const rows = [created('w1', 'c1'), created('w1', 'c1'), created('w1', 'c1')];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2).size, 0);
});

test('two workspaces each with two campaigns → two repeats', () => {
  const rows = [created('w1', 'c1'), created('w1', 'c2'), created('w2', 'c3'), created('w2', 'c4')];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2).size, 2);
});

test('a second campaign in a DIFFERENT workspace does not make the first a repeat', () => {
  const rows = [created('w1', 'c1'), created('w2', 'c2')];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2).size, 0, 'the join is per-workspace, not global');
});

test('staff/test workspaces are excluded from repeat counting', () => {
  const rows = [created('wStaff', 'c1'), created('wStaff', 'c2')];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2, { roster: { workspaceIds: ['wStaff'] } }).size, 0);
  assert.equal(workspacesWithRepeatCampaigns(rows, 2, { excludedWorkspaces: new Set(['wStaff']) }).size, 0);
});

test('falls back to the per-campaign dedupe key when campaign_id property is absent', () => {
  const rows = [
    { event: 'campaign_created', workspace_id: 'w1', dedupe_key: 'campaign:c1' },
    { event: 'campaign_created', workspace_id: 'w1', dedupe_key: 'campaign:c2' },
  ];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2).size, 1);
});

test('non-campaign_created rows are ignored', () => {
  const rows = [{ event: 'first_generation', workspace_id: 'w1' }, created('w1', 'c1')];
  assert.equal(workspacesWithRepeatCampaigns(rows, 2).size, 0);
});

// --- integration with the scorecard ---------------------------------------

function matureCohort() {
  // 5 activated workspaces (>= MIN_COHORT), 2 of them create a 2nd campaign.
  const rows = [];
  for (let i = 1; i <= 5; i++) { rows.push(activated(`w${i}`)); rows.push(created(`w${i}`, `w${i}-c1`)); }
  rows.push(created('w1', 'w1-c2'));
  rows.push(created('w2', 'w2-c2'));
  return rows;
}

test('second_campaign_created is now measured (not unavailable) and reads the activated denominator', () => {
  assert.ok(MIN_COHORT <= 5);
  const sc = computeScorecard(matureCohort(), { roster: {} });
  const step = sc.steps.find((s) => s.step === 'second_campaign_created');
  assert.notEqual(step.state, 'unavailable', 'it must no longer be unavailable');
  assert.equal(step.state, 'reported');
  assert.equal(step.numerator, 2);
  assert.equal(step.denominator, 5);
  assert.equal(step.value, 40); // 2/5
  assert.equal(sc.derived.second_campaign_rate, 40);
  assert.ok(/distinct/.test(step.definition));
});

test('a retried second campaign cannot push the rate above the true value', () => {
  const rows = matureCohort();
  // w1 re-posts its 2nd campaign twice more (same id) — must not become 2 repeats.
  rows.push(created('w1', 'w1-c2'));
  rows.push(created('w1', 'w1-c2'));
  const sc = computeScorecard(rows, { roster: {} });
  assert.equal(sc.derived.second_campaign_rate, 40, 'still 2/5, not inflated');
});

test('immature cohort (< MIN_COHORT activated) suppresses the rate', () => {
  const rows = [activated('w1'), created('w1', 'c1'), created('w1', 'c2')];
  const sc = computeScorecard(rows, { roster: {} });
  const step = sc.steps.find((s) => s.step === 'second_campaign_created');
  assert.equal(step.state, 'insufficient_data');
  assert.equal(step.value, null);
});

test('no data → no_data, never a false zero', () => {
  const sc = computeScorecard([], { roster: {} });
  assert.equal(sc.data_available, true);
  assert.equal(sc.cohort_size, 0);
  assert.equal(sc.steps.find((s) => s.step === 'second_campaign_created').state, 'no_data');
});

test('analytics READ FAILURE → data_available:false and every step unavailable, never zero', () => {
  const sc = computeScorecard([], { roster: {}, dataAvailable: false });
  assert.equal(sc.data_available, false);
  assert.equal(sc.cohort_size, null);
  assert.equal(sc.reportable, false);
  for (const step of sc.steps) assert.equal(step.state, 'unavailable');
  assert.ok(/UNAVAILABLE/.test(sc.disclaimer));
});
