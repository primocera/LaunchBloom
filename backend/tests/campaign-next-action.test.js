// v9 SC-02 — the deterministic campaign next-action + readiness selector.
// Pure ESM under app-src/lib, imported dynamically. These fixtures lock the
// priority order and guard against status/entitlement drift: legacy campaigns
// with no plan, partial plans, optional-only campaigns, blocked assets and
// conflicting review data.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'app-src', 'lib', 'campaign-next-action.js')
).href;
const load = () => import(modUrl);

// A fully-approved campaign whose one required deliverable (email flow) exists.
function readyCampaign(extra = {}) {
  return {
    id: 'c1', name: 'Summer',
    objective: 'Sell', audience: 'Gift buyers', offer_summary: '20% off', key_message: 'Save now',
    brief_approved: true,
    deliverable_plan: [{ deliverable_code: 'email_flow', requirement_state: 'required' }],
    asset_counts: { email_assets: 1 },
    ...extra,
  };
}
const cleanReview = { blocking: [], stale: [], needs_review_assets: [], evidence_reminders: [] };

test('incomplete core brief outranks everything', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const c = readyCampaign({ key_message: '' }); // missing a required decision
  const na = campaignNextAction(campaignSummary(c, cleanReview));
  assert.equal(na.action_code, 'brief_incomplete');
  assert.equal(na.severity, 'blocker');
  assert.equal(na.spends_ai_action, false);
  assert.match(na.destination, /\/app\/campaigns\/c1\/brief$/);
});

test('a complete but unapproved brief asks for approval next', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const na = campaignNextAction(campaignSummary(readyCampaign({ brief_approved: false }), cleanReview));
  assert.equal(na.action_code, 'brief_approval');
});

test('legacy campaign with no saved plan is guided to choose requirements', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const c = readyCampaign({ deliverable_plan: [], asset_counts: {} });
  const na = campaignNextAction(campaignSummary(c, cleanReview));
  assert.equal(na.action_code, 'plan_deliverables');
  assert.match(na.destination, /\/deliverables$/);
});

test('a required deliverable with no asset yet blocks on creation', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const c = readyCampaign({ asset_counts: {} }); // required email flow not started
  const na = campaignNextAction(campaignSummary(c, cleanReview));
  assert.equal(na.action_code, 'deliverable_missing');
  assert.match(na.destination, /\/app\/create\?campaign=c1$/);
});

test('without review data the selector conservatively routes to Review', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const na = campaignNextAction(campaignSummary(readyCampaign(), null));
  assert.equal(na.action_code, 'review_campaign');
  assert.equal(na.severity, 'review');
});

test('a clean evaluated review reaches the handoff export', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const na = campaignNextAction(campaignSummary(readyCampaign(), cleanReview));
  assert.equal(na.action_code, 'export_handoff');
  assert.equal(na.severity, 'ready');
});

test('an optional-only two-deliverable campaign reaches handoff without irrelevant channels', async () => {
  const { campaignSummary, campaignNextAction, readinessGroups } = await load();
  const c = readyCampaign({
    deliverable_plan: [
      { deliverable_code: 'email_flow', requirement_state: 'optional' },
      { deliverable_code: 'social_set', requirement_state: 'optional' },
    ],
    asset_counts: {}, // optional deliverables never block completion
  });
  const summary = campaignSummary(c, cleanReview);
  assert.equal(campaignNextAction(summary).action_code, 'export_handoff');
  const handoff = readinessGroups(summary).find((g) => g.key === 'handoff');
  assert.equal(handoff.state, 'ready');
});

test('review priority is locked: stale → high finding → needs review → evidence', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const full = {
    blocking: [{ code: 'cta_conflict', severity: 'high' }],
    stale: [{ table: 'email_assets' }],
    needs_review_assets: [{ table: 'email_assets' }],
    evidence_reminders: [{ id: 'e1' }],
  };
  const code = (rv) => campaignNextAction(campaignSummary(readyCampaign(), rv)).action_code;
  assert.equal(code(full), 'stale_required');
  assert.equal(code({ ...full, stale: [] }), 'finding_high');
  assert.equal(code({ ...full, stale: [], blocking: [] }), 'asset_needs_review');
  assert.equal(code({ ...full, stale: [], blocking: [], needs_review_assets: [] }), 'evidence_reminder');
});

test('stale/needs-review on a NON-required asset does not block handoff', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  // Required = email; the stale/needs-review items are social (optional) assets.
  const rv = {
    blocking: [], evidence_reminders: [],
    stale: [{ table: 'social_assets' }],
    needs_review_assets: [{ table: 'social_assets' }],
  };
  const na = campaignNextAction(campaignSummary(readyCampaign(), rv));
  assert.equal(na.action_code, 'export_handoff');
});

test('acknowledged high findings (empty blocking) do not fabricate a blocker', async () => {
  const { campaignSummary, campaignNextAction, readinessGroups } = await load();
  const summary = campaignSummary(readyCampaign(), { ...cleanReview, blocking: [] });
  assert.equal(campaignNextAction(summary).action_code, 'export_handoff');
  assert.equal(readinessGroups(summary).find((g) => g.key === 'review').state, 'ready');
});

test('the selector is deterministic — identical inputs, identical output', async () => {
  const { campaignSummary, campaignNextAction } = await load();
  const a = campaignNextAction(campaignSummary(readyCampaign(), cleanReview));
  const b = campaignNextAction(campaignSummary(readyCampaign(), cleanReview));
  assert.deepEqual(a, b);
});

test('readiness groups are the four canonical groups, no synthetic score', async () => {
  const { campaignSummary, readinessGroups, NEXT_ACTION_RULES_VERSION } = await load();
  const groups = readinessGroups(campaignSummary(readyCampaign(), cleanReview));
  assert.deepEqual(groups.map((g) => g.key), ['brief', 'deliverables', 'review', 'handoff']);
  for (const g of groups) {
    assert.ok(Array.isArray(g.reasons) && g.reasons.length, `${g.key} must give at least one reason`);
    assert.ok(typeof g.state === 'string');
    assert.ok(!('score' in g), 'no numeric score');
  }
  assert.equal(NEXT_ACTION_RULES_VERSION, 'cna-1');
});

test('a high finding marks the Review group blocked, not the Brief group', async () => {
  const { campaignSummary, readinessGroups } = await load();
  const groups = readinessGroups(campaignSummary(readyCampaign(), { ...cleanReview, blocking: [{ severity: 'high' }] }));
  assert.equal(groups.find((g) => g.key === 'review').state, 'blocked');
  assert.equal(groups.find((g) => g.key === 'brief').state, 'ready');
  assert.equal(groups.find((g) => g.key === 'handoff').state, 'attention');
});
