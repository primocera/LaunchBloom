// Ownership and integrity hardening (2026-11 review):
//   - PATCH /api/campaigns/:id may only link an offer from its own workspace;
//   - a custom weekly task must reference a launch kit of the caller's workspace;
//   - restoring an asset version restores content only (not status / campaign);
//   - the bulk "ready" path enforces the same creative compliance gate as PATCH;
//   - admin routes require a confirmed admin e-mail;
//   - the cron secret is compared in constant time (and still rejects).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.CRON_SECRET = 'cron-secret-0123456789';

const { stubModule } = require('./helpers');

const WS = { id: 'ws-1', user_id: 'u1', archived: false };
const state = { user: { id: 'u1', email: 'me@app.com', email_confirmed_at: '2026-01-01T00:00:00Z' }, writes: [] };

// Configurable fake: `rows[table]` answers selects; writes are recorded.
const rows = {};
function builder(table) {
  const q = { table, op: 'select', filters: {}, payload: null };
  const b = {
    select: () => b, order: () => b, limit: () => b, in: () => b, gte: () => b,
    eq: (k, v) => { q.filters[k] = v; return b; },
    is: (k, v) => { q.filters[k] = v; return b; },
    insert: (p) => { q.op = 'insert'; q.payload = p; return b; },
    update: (p) => { q.op = 'update'; q.payload = p; return b; },
    delete: () => { q.op = 'delete'; return b; },
    single: async () => resolve(true),
    then: (ok, err) => Promise.resolve(resolve(false)).then(ok, err),
  };
  function resolve(single) {
    if (q.op !== 'select') { state.writes.push({ ...q }); return { data: q.payload || null, error: null }; }
    if (table === 'workspaces') return single ? { data: WS, error: null } : { data: [WS], error: null };
    const handler = rows[table];
    const data = typeof handler === 'function' ? handler(q.filters) : handler;
    if (single) return data ? { data, error: null } : { data: null, error: { code: 'PGRST116' } };
    return { data: data ? [].concat(data) : [], error: null };
  }
  return b;
}
stubModule('lib/supabase.js', {
  from: builder,
  authClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
  adminClient: () => ({ auth: { admin: {} } }),
});
stubModule('lib/lifecycle-email.js', {
  sendLifecycleEmail: async () => 'skipped',
  processEmailOutbox: async () => ({ claimed: 0 }),
  replayDeadLetter: async () => true,
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(express.json());
app.use(require('../routes/workspaces'));
app.use(require('../routes/campaigns'));
app.use(require('../routes/library'));
app.use(require('../routes/admin'));
const AUTHED = ['Cookie', 'sb_access=tok'];

test('a campaign PATCH cannot link an offer from another workspace', async () => {
  rows.campaigns = { id: 'c1', workspace_id: WS.id, name: 'Spring' };
  rows.offers = (f) => (f.id === 'offer-mine' && f.workspace_id === WS.id ? { id: 'offer-mine' } : null);
  state.writes.length = 0;

  const r = await request(app).patch('/api/campaigns/c1').set(...AUTHED).send({ offer_id: 'offer-foreign' });
  assert.equal(r.status, 404);
  assert.ok(!state.writes.some((w) => w.table === 'campaigns' && w.op === 'update'), 'no update for a foreign offer');
});

test('a custom weekly task needs a launch kit of the caller\'s workspace', async () => {
  rows.launch_kits = (f) => (f.id === 'kit-mine' && f.workspace_id === WS.id ? { id: 'kit-mine' } : null);
  state.writes.length = 0;

  const bad = await request(app).post('/api/workspace/items/weekly_tasks').set(...AUTHED)
    .send({ launch_kit_id: 'kit-victim', task_title: 'Your account is suspended' });
  assert.equal(bad.status, 404);
  assert.ok(!state.writes.some((w) => w.table === 'weekly_tasks'));

  const ok = await request(app).post('/api/workspace/items/weekly_tasks').set(...AUTHED)
    .send({ launch_kit_id: 'kit-mine', task_title: 'Post the teaser' });
  assert.equal(ok.status, 201);
});

test('restoring a version restores content only - status and campaign stay current', async () => {
  rows.social_assets = { id: 'a1', workspace_id: WS.id, hook: 'New hook', status: 'ready', campaign_id: 'camp-now', archived: false };
  rows.asset_versions = {
    id: 'v1', snapshot: { id: 'a1', hook: 'Old hook', caption: 'Old caption', status: 'draft', campaign_id: 'camp-deleted', archived: true, planned_date: '2026-01-01' },
  };
  state.writes.length = 0;

  const r = await request(app).post('/api/assets/library/social_assets/a1/restore').set(...AUTHED).send({ version_id: 'v1' });
  assert.equal(r.status, 200);
  const upd = state.writes.find((w) => w.table === 'social_assets' && w.op === 'update');
  assert.equal(upd.payload.hook, 'Old hook');
  assert.equal(upd.payload.caption, 'Old caption');
  for (const k of ['status', 'campaign_id', 'archived', 'planned_date', 'id']) {
    assert.ok(!(k in upd.payload), `restore must not overwrite ${k}`);
  }
});

test('bulk "ready" skips a creative that fails the compliance gate', async () => {
  rows.creative_assets = { id: 'cr1', workspace_id: WS.id, compliance_flags: ['unsupported claim'], status: 'draft' };
  state.writes.length = 0;

  const r = await request(app).post('/api/assets/library/bulk').set(...AUTHED)
    .send({ action: 'status', value: 'ready', items: [{ table: 'creative_assets', id: 'cr1' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 0);
  assert.ok(!state.writes.some((w) => w.table === 'creative_assets' && w.op === 'update'));
});

test('an admin route refuses an unconfirmed admin e-mail', async () => {
  process.env.ADMIN_EMAILS = 'boss@app.com';
  state.user = { id: 'u-boss', email: 'boss@app.com', email_confirmed_at: null };
  const r = await request(app).get('/api/admin/health').set(...AUTHED);
  assert.equal(r.status, 403);
  state.user = { id: 'u1', email: 'me@app.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
});

test('the cron endpoint rejects a wrong secret and accepts the right one', async () => {
  assert.equal((await request(app).get('/api/cron/email-outbox').set('Authorization', 'Bearer nope')).status, 401);
  assert.equal((await request(app).get('/api/cron/email-outbox')).status, 401);
  const ok = await request(app).get('/api/cron/email-outbox').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
  assert.equal(ok.status, 200);
});
