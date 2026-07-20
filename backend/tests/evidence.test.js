const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// ── routes with a stateful stub ─────────────────────────────────────────────

function makeSupabase() {
  const evidence = [];
  const links = [];
  const assets = [{ id: 'a1', workspace_id: 'ws-user-1', campaign_id: 'c-1' }];
  let seq = 0;
  const flags = { user: { id: 'user-1', email: 'me@app.com' } };

  function builder(table) {
    const st = { table, op: 'select', filters: {}, ins: null };
    const api = {
      select() { return api; },
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
    const stores = { evidence, asset_evidence_links: links, email_assets: assets };
    const store = stores[st.table];
    if (!store) return single ? { data: null, error: { code: 'PGRST116' } } : { data: [], error: null };
    if (st.op === 'insert') {
      const row = { id: st.table + '-' + (++seq), archived: false, ...st.ins };
      store.push(row);
      return { data: row, error: null };
    }
    if (st.op === 'upsert') {
      store.push({ id: st.table + '-' + (++seq), ...st.ins });
      return { data: null, error: null };
    }
    if (st.op === 'update') {
      const row = store.find((r) => match(r, st.filters));
      if (row) Object.assign(row, st.ins);
      return { data: row || null, error: row ? null : { code: 'PGRST116' } };
    }
    if (st.op === 'delete') {
      for (let i = store.length - 1; i >= 0; i--) if (match(store[i], st.filters)) store.splice(i, 1);
      return { data: null, error: null };
    }
    const rows = store.filter((r) => match(r, st.filters));
    return single
      ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } })
      : { data: rows, error: null };
  }

  return {
    from: builder,
    _flags: flags,
    _evidence: evidence,
    _links: links,
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
const evidenceRouter = require('../routes/evidence');
const { sanitizeUrl } = require('../routes/evidence');

// ── URL sanitization (pure) ─────────────────────────────────────────────────

test('sanitizeUrl allows plain http(s) and rejects executable schemes', () => {
  assert.equal(sanitizeUrl('https://example.com/reviews').ok, true);
  assert.equal(sanitizeUrl('http://example.com').ok, true);
  assert.equal(sanitizeUrl('').value, null);
  assert.equal(sanitizeUrl(null).value, null);
  assert.equal(sanitizeUrl('javascript:alert(1)').ok, false);
  assert.equal(sanitizeUrl('data:text/html;base64,x').ok, false);
  assert.equal(sanitizeUrl('file:///etc/passwd').ok, false);
  assert.equal(sanitizeUrl('not a url').ok, false);
});

const app = express();
app.use(evidenceRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('evidence requires a label and a checked date', async () => {
  const noLabel = await request(app).post('/api/evidence').set(...AUTHED)
    .send({ type: 'review', checked_date: '2026-07-01' });
  assert.equal(noLabel.status, 400);
  const noDate = await request(app).post('/api/evidence').set(...AUTHED)
    .send({ type: 'review', label: 'Trustpilot 4.8' });
  assert.equal(noDate.status, 400);
});

test('evidence with a javascript: URL is rejected', async () => {
  const r = await request(app).post('/api/evidence').set(...AUTHED)
    .send({ type: 'review', label: 'x', checked_date: '2026-07-01', source_url: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
});

test('create evidence, link it to an asset, list with links', async () => {
  const r = await request(app).post('/api/evidence').set(...AUTHED)
    .send({ type: 'review', label: 'Trustpilot 4.8', checked_date: '2026-07-01', source_url: 'https://trustpilot.com/x', permitted_claim: '4.8 stars' });
  assert.equal(r.status, 201);
  const id = r.body.evidence.id;

  const link = await request(app).post(`/api/evidence/${id}/link`).set(...AUTHED)
    .send({ asset_table: 'email_assets', asset_id: 'a1' });
  assert.equal(link.status, 200);

  const list = await request(app).get('/api/evidence').set(...AUTHED);
  assert.equal(list.status, 200);
  assert.equal(list.body.evidence[0].links.length, 1);
});

test('linking rejects unknown tables and foreign assets', async () => {
  const id = db._evidence[0].id;
  const badTable = await request(app).post(`/api/evidence/${id}/link`).set(...AUTHED)
    .send({ asset_table: 'users', asset_id: 'a1' });
  assert.equal(badTable.status, 400);
  const missing = await request(app).post(`/api/evidence/${id}/link`).set(...AUTHED)
    .send({ asset_table: 'email_assets', asset_id: 'not-mine' });
  assert.equal(missing.status, 404);
});

test('another user cannot see or edit evidence', async () => {
  const id = db._evidence[0].id;
  db._flags.user = { id: 'attacker', email: 'evil@x.com' };
  const list = await request(app).get('/api/evidence').set(...AUTHED);
  assert.equal(list.body.evidence.length, 0);
  const patch = await request(app).patch(`/api/evidence/${id}`).set(...AUTHED).send({ label: 'pwned' });
  assert.equal(patch.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});

test('archive is a soft delete and unlink removes a single link', async () => {
  const id = db._evidence[0].id;
  const arch = await request(app).patch(`/api/evidence/${id}`).set(...AUTHED).send({ archived: true });
  assert.equal(arch.status, 200);
  assert.equal(arch.body.evidence.archived, true);
  assert.equal(db._evidence.length, 1); // still stored

  const unlink = await request(app).delete(`/api/evidence/${id}/link`).set(...AUTHED)
    .send({ asset_table: 'email_assets', asset_id: 'a1' });
  assert.equal(unlink.status, 200);
  assert.equal(db._links.length, 0);
});
