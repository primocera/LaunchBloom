const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// Stateful campaigns store keyed by workspace.
function makeSupabase() {
  const campaigns = [];
  let seq = 0;
  const flags = { user: { id: 'user-1', email: 'me@app.com' } };

  function builder(table) {
    const st = { table, op: 'select', head: false, filters: {}, ins: null };
    const api = {
      select(_c, opts) { if (opts && opts.head) st.head = true; return api; },
      insert(p) { st.op = 'insert'; st.ins = p; return api; },
      update(p) { st.op = 'update'; st.ins = p; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      is(k, v) { st.filters[k] = v; return api; },
      in() { return api; },
      gte() { return api; },
      order() { return api; },
      limit() { return api; },
      single() { return Promise.resolve(resolveSingle(st)); },
      then(res, rej) { return Promise.resolve(resolveList(st)).then(res, rej); },
    };
    return api;
  }
  const match = (r, f) => Object.entries(f).every(([k, v]) => r[k] === v);

  function resolveSingle(st) {
    if (st.table === 'campaigns') {
      if (st.op === 'insert') {
        const row = { id: 'c-' + (++seq), brief_approved: false, status: 'draft', strategy: null, ...st.ins };
        campaigns.push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        const row = campaigns.find((r) => match(r, st.filters));
        if (row) Object.assign(row, st.ins);
        return { data: row || null, error: row ? null : { code: 'PGRST116' } };
      }
      const row = campaigns.find((r) => match(r, st.filters));
      return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
    }
    if (st.table === 'workspaces') {
      // resolveWorkspace: pretend each user owns one workspace 'ws-<id>'.
      return { data: { id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false }, error: null };
    }
    return { data: null, error: { code: 'PGRST116' } };
  }
  function resolveList(st) {
    if (st.table === 'campaigns') {
      if (st.op === 'delete') {
        for (let i = campaigns.length - 1; i >= 0; i--) if (match(campaigns[i], st.filters)) campaigns.splice(i, 1);
        return { data: null, error: null };
      }
      return { data: campaigns.filter((r) => match(r, st.filters)), error: null };
    }
    if (st.table === 'workspaces') {
      return { data: [{ id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false }], error: null };
    }
    if (st.head) return { count: 0, error: null };
    return { data: [], error: null };
  }

  return {
    from: builder,
    _flags: flags,
    _campaigns: campaigns,
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
const { campaignContext } = require('../routes/campaigns');

const app = express();
app.use(campaignsRouter);

const AUTHED = ['Cookie', 'sb_access=tok'];

test('create + list a campaign', async () => {
  const r = await request(app).post('/api/campaigns').set(...AUTHED)
    .send({ name: 'Summer Sale', objective: 'Sell the drop', channels: ['email', 'social'] });
  assert.equal(r.status, 201);
  assert.equal(r.body.campaign.name, 'Summer Sale');

  const list = await request(app).get('/api/campaigns').set(...AUTHED);
  assert.equal(list.status, 200);
  assert.equal(list.body.campaigns.length, 1);
  assert.ok('asset_counts' in list.body.campaigns[0]);
});

test('create requires a name', async () => {
  const r = await request(app).post('/api/campaigns').set(...AUTHED).send({ objective: 'x' });
  assert.equal(r.status, 400);
});

test('another user cannot read or edit the campaign', async () => {
  const id = db._campaigns[0].id;
  db._flags.user = { id: 'attacker', email: 'evil@x.com' };
  const read = await request(app).get(`/api/campaigns/${id}`).set(...AUTHED);
  assert.equal(read.status, 404);
  const patch = await request(app).patch(`/api/campaigns/${id}`).set(...AUTHED).send({ name: 'pwned' });
  assert.equal(patch.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});

test('approve the brief via PATCH', async () => {
  const id = db._campaigns[0].id;
  const r = await request(app).patch(`/api/campaigns/${id}`).set(...AUTHED).send({ brief_approved: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.campaign.brief_approved, true);
});

test('campaignContext builds a consistent brief block for asset prompts', async () => {
  const c = db._campaigns[0];
  c.promo_terms = '20% off SUMMER20';
  c.strategy = { core_message: 'One message', cta: 'Shop the sale', message_hierarchy: ['a', 'b'] };
  const ctx = await campaignContext({ id: 'ws-user-1' }, c.id);
  assert.ok(ctx.campaign);
  assert.match(ctx.text, /CAMPAIGN BRIEF/);
  assert.match(ctx.text, /20% off SUMMER20/);
  assert.match(ctx.text, /Core message: One message/);
});

test('campaignContext 404s for a foreign campaign', async () => {
  const ctx = await campaignContext({ id: 'ws-other' }, db._campaigns[0].id);
  assert.equal(ctx.status, 404);
});
