const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

// ── pure lib ────────────────────────────────────────────────────────────────

const {
  DELIVERABLES, DELIVERABLE_CODES, deliverableState, campaignGap, validatePlan, missingBriefFields,
} = require('../lib/deliverables');

test('five deliverables, one per canonical Create path — never a sixth', () => {
  assert.equal(DELIVERABLES.length, 5);
  assert.deepEqual(DELIVERABLE_CODES,
    ['landing_page', 'email_flow', 'social_set', 'creative_brief', 'seo_ideas']);
});

test('deliverableState derives from real asset statuses', () => {
  assert.equal(deliverableState('not_needed', [{ status: 'ready' }]), 'excluded');
  assert.equal(deliverableState('required', []), 'not_planned');
  assert.equal(deliverableState('required', [{ status: 'draft' }]), 'in_progress');
  assert.equal(deliverableState('required', [{ status: 'edited' }]), 'needs_review');
  assert.equal(deliverableState('required', [{ status: 'draft' }, { status: 'ready' }]), 'ready');
  assert.equal(deliverableState('optional', [{ status: 'published' }]), 'ready');
});

const FULL_BRIEF = { objective: 'g', audience: 'a', offer_summary: 'o', key_message: 'k' };

test('a campaign with two required channels can be complete without three others', () => {
  const plan = [
    { deliverable_code: 'landing_page', requirement_state: 'required' },
    { deliverable_code: 'email_flow', requirement_state: 'required' },
    { deliverable_code: 'social_set', requirement_state: 'not_needed' },
    { deliverable_code: 'creative_brief', requirement_state: 'not_needed' },
    { deliverable_code: 'seo_ideas', requirement_state: 'not_needed' },
  ];
  const gap = campaignGap(FULL_BRIEF, plan, {
    website_pages: [{ status: 'ready' }],
    email_assets: [{ status: 'published' }],
  });
  assert.equal(gap.required_total, 2);
  assert.equal(gap.required_ready, 2);
  assert.equal(gap.all_required_ready, true);
  assert.equal(gap.deliverables.find((d) => d.code === 'social_set').state, 'excluded');
});

test('unplanned campaigns are backfilled conservatively — nothing is required', () => {
  const gap = campaignGap(FULL_BRIEF, [], { website_pages: [{ status: 'draft' }] });
  assert.equal(gap.plan_saved, false);
  assert.equal(gap.all_required_ready, false);
  assert.ok(gap.deliverables.every((d) => d.requirement === 'unplanned'));
  // existing assets still show honest progress
  assert.equal(gap.deliverables.find((d) => d.code === 'landing_page').state, 'in_progress');
});

test('required deliverables expose transparent blockers, not a score', () => {
  const gap = campaignGap({ objective: 'g' }, [
    { deliverable_code: 'landing_page', requirement_state: 'required' },
  ], {});
  const row = gap.deliverables.find((d) => d.code === 'landing_page');
  assert.equal(row.state, 'not_planned');
  assert.ok(row.blockers.some((b) => /Complete the brief/.test(b)));
  assert.ok(row.blockers.some((b) => /No asset/.test(b)));
  assert.deepEqual(missingBriefFields({ objective: 'g' }),
    ['an audience', 'an offer', 'a key message']);
});

test('needs_review blocks a required deliverable with a reason', () => {
  const gap = campaignGap(FULL_BRIEF, [
    { deliverable_code: 'email_flow', requirement_state: 'required' },
  ], { email_assets: [{ status: 'edited' }] });
  const row = gap.deliverables.find((d) => d.code === 'email_flow');
  assert.equal(row.state, 'needs_review');
  assert.ok(row.blockers.some((b) => /needs your review/.test(b)));
});

test('validatePlan rejects unknown codes, states and duplicates', () => {
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan({ deliverables: [] }).ok, false);
  assert.equal(validatePlan({ deliverables: [{ code: 'tiktok_ads', requirement_state: 'required' }] }).ok, false);
  assert.equal(validatePlan({ deliverables: [{ code: 'landing_page', requirement_state: 'maybe' }] }).ok, false);
  assert.equal(validatePlan({
    deliverables: [
      { code: 'landing_page', requirement_state: 'required' },
      { code: 'landing_page', requirement_state: 'optional' },
    ],
  }).ok, false);
  const ok = validatePlan({ deliverables: [{ code: 'landing_page', requirement_state: 'required' }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows, [{ deliverable_code: 'landing_page', requirement_state: 'required' }]);
});

// ── routes (workspace-scoped, free) ─────────────────────────────────────────

const { stubModule } = require('./helpers');

function makeSupabase() {
  const campaigns = [{ id: 'c-1', workspace_id: 'ws-user-1', name: 'Sale', ...FULL_BRIEF }];
  const deliverables = [];
  const flags = { user: { id: 'user-1', email: 'me@app.com' } };

  function builder(table) {
    const st = { table, op: 'select', filters: {}, ins: null, head: false };
    const api = {
      select(_c, opts) { if (opts && opts.head) st.head = true; return api; },
      insert(p) { st.op = 'insert'; st.ins = p; return api; },
      upsert(p) { st.op = 'upsert'; st.ins = p; return api; },
      update(p) { st.op = 'update'; st.ins = p; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      in() { return api; },
      order() { return api; },
      single() { return Promise.resolve(resolve(st, true)); },
      then(res, rej) { return Promise.resolve(resolve(st, false)).then(res, rej); },
    };
    return api;
  }
  const match = (r, f) => Object.entries(f).every(([k, v]) => r[k] === v);

  function resolve(st, single) {
    if (st.table === 'workspaces') {
      const ws = { id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false };
      return single ? { data: ws, error: null } : { data: [ws], error: null };
    }
    if (st.table === 'campaigns') {
      const rows = campaigns.filter((r) => match(r, st.filters));
      return single
        ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } })
        : { data: rows, error: null };
    }
    if (st.table === 'campaign_deliverables') {
      if (st.op === 'upsert') {
        for (const row of st.ins) {
          const i = deliverables.findIndex((d) =>
            d.campaign_id === row.campaign_id && d.deliverable_code === row.deliverable_code);
          if (i >= 0) deliverables[i] = { ...deliverables[i], ...row };
          else deliverables.push({ ...row });
        }
        return { data: null, error: null };
      }
      return { data: deliverables.filter((r) => match(r, st.filters)), error: null };
    }
    if (st.head) return { count: 0, error: null };
    return single ? { data: null, error: { code: 'PGRST116' } } : { data: [], error: null };
  }

  return {
    from: builder,
    _flags: flags,
    _deliverables: deliverables,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
    authClient: () => ({ auth: {
      getUser: async () => ({ data: { user: flags.user }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
    } }),
  };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

const express = require('express');
const request = require('supertest');
const campaignsRouter = require('../routes/campaigns');

const app = express();
app.use(campaignsRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('GET deliverables returns an unplanned gap map for a fresh campaign', async () => {
  const r = await request(app).get('/api/campaigns/c-1/deliverables').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.equal(r.body.gap.plan_saved, false);
  assert.equal(r.body.gap.deliverables.length, 5);
});

test('PUT deliverables validates and saves the plan', async () => {
  const bad = await request(app).put('/api/campaigns/c-1/deliverables').set(...AUTHED)
    .send({ deliverables: [{ code: 'nonsense', requirement_state: 'required' }] });
  assert.equal(bad.status, 400);

  const r = await request(app).put('/api/campaigns/c-1/deliverables').set(...AUTHED)
    .send({ deliverables: [
      { code: 'landing_page', requirement_state: 'required' },
      { code: 'seo_ideas', requirement_state: 'not_needed' },
    ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.gap.plan_saved, true);
  assert.equal(r.body.gap.required_total, 1);
  assert.equal(db._deliverables.length, 2);
});

test('changing a requirement updates the gap map immediately', async () => {
  const r = await request(app).put('/api/campaigns/c-1/deliverables').set(...AUTHED)
    .send({ deliverables: [{ code: 'landing_page', requirement_state: 'not_needed' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.gap.deliverables.find((d) => d.code === 'landing_page').state, 'excluded');
});

test('another user cannot read or write a foreign campaign plan', async () => {
  db._flags.user = { id: 'attacker', email: 'evil@x.com' };
  const read = await request(app).get('/api/campaigns/c-1/deliverables').set(...AUTHED);
  assert.equal(read.status, 404);
  const write = await request(app).put('/api/campaigns/c-1/deliverables').set(...AUTHED)
    .send({ deliverables: [{ code: 'landing_page', requirement_state: 'required' }] });
  assert.equal(write.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});
