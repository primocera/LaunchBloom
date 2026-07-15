const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// Stateful workspaces store so CRUD + ownership can be exercised.
function makeSupabase() {
  const rows = [];
  let seq = 0;
  const flags = { user: { id: 'user-1', email: 'me@app.com' } };

  function builder(table) {
    const st = { table, op: 'select', filters: {}, ins: null };
    const api = {
      select() { return api; },
      insert(p) { st.op = 'insert'; st.ins = p; return api; },
      update(p) { st.op = 'update'; st.ins = p; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      is(k, v) { st.filters[k] = v; return api; },
      order() { return api; },
      limit() { return api; },
      single() { return Promise.resolve(resolveSingle(st)); },
      then(res, rej) { return Promise.resolve(resolveList(st)).then(res, rej); },
    };
    return api;
  }
  function match(r, f) {
    return Object.entries(f).every(([k, v]) => (k in f ? r[k] === v : true));
  }
  function resolveSingle(st) {
    if (st.table !== 'workspaces') return { data: null, error: { code: 'PGRST116' } };
    if (st.op === 'insert') {
      const row = { id: 'ws-' + (++seq), archived: false, created_at: new Date(seq).toISOString(), ...st.ins };
      rows.push(row);
      return { data: row, error: null };
    }
    if (st.op === 'update') {
      const row = rows.find((r) => match(r, st.filters));
      if (row) Object.assign(row, st.ins);
      return { data: row || null, error: row ? null : { code: 'PGRST116' } };
    }
    const row = rows.find((r) => match(r, st.filters));
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
  }
  function resolveList(st) {
    if (st.table !== 'workspaces') return { data: [], error: null };
    if (st.op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], st.filters)) rows.splice(i, 1);
      return { data: null, error: null };
    }
    return { data: rows.filter((r) => match(r, st.filters)), error: null };
  }
  return {
    from: builder,
    _rows: rows,
    _flags: flags,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
    authClient: () => ({ auth: {
      getUser: async () => (flags.user ? { data: { user: flags.user }, error: null } : { data: { user: null }, error: {} }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
    } }),
  };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

// Fixed plan.
const customers = require('../routes/customers');
customers.planFor = async () => 'pro'; // 3 workspaces

const express = require('express');
const request = require('supertest');
const workspacesRouter = require('../routes/workspaces');

const app = express();
app.use(workspacesRouter);

const AUTHED = ['Cookie', 'sb_access=tok'];

test('create respects the plan workspace cap (Pro = 3)', async () => {
  db._rows.length = 0;
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
  for (let i = 0; i < 3; i++) {
    const r = await request(app).post('/api/workspaces').set(...AUTHED).send({ name: 'W' + i });
    assert.equal(r.status, 201);
  }
  const over = await request(app).post('/api/workspaces').set(...AUTHED).send({ name: 'W4' });
  assert.equal(over.status, 402);
  assert.equal(over.body.code, 'UPGRADE');
});

test('list returns the user’s workspaces', async () => {
  const r = await request(app).get('/api/workspaces').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.equal(r.body.workspaces.length, 3);
});

test('another user cannot rename or delete a workspace by id', async () => {
  const someId = db._rows[0].id;
  db._flags.user = { id: 'attacker-9', email: 'evil@x.com' };
  const rename = await request(app).patch(`/api/workspaces/${someId}`).set(...AUTHED).send({ name: 'pwned' });
  assert.equal(rename.status, 404);
  const del = await request(app).delete(`/api/workspaces/${someId}`).set(...AUTHED);
  assert.equal(del.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});

test('cannot delete the only workspace', async () => {
  db._rows.length = 0;
  db._flags.user = { id: 'solo-1', email: 'solo@app.com' };
  const created = await request(app).post('/api/workspaces').set(...AUTHED).send({ name: 'Only' });
  const only = created.body.workspace.id;
  const del = await request(app).delete(`/api/workspaces/${only}`).set(...AUTHED);
  assert.equal(del.status, 400);
});
