const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// Stateful store: social_assets rows + asset_versions; other tables empty.
function makeSupabase() {
  const store = { social_assets: [], asset_versions: [] };
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
      is() { return api; }, in() { return api; }, gte() { return api; },
      order() { return api; }, limit() { return api; },
      single() { return Promise.resolve(single(st)); },
      then(res, rej) { return Promise.resolve(list(st)).then(res, rej); },
    };
    return api;
  }
  const match = (r, f) => Object.entries(f).every(([k, v]) => r[k] === v);
  const rowsOf = (t) => store[t] || [];

  function single(st) {
    if (st.op === 'insert') {
      const row = { id: 'a-' + (++seq), created_at: new Date(seq).toISOString(), favourite: false, archived: false, status: 'draft', ...st.ins };
      (store[st.table] = store[st.table] || []).push(row);
      return { data: row, error: null };
    }
    if (st.op === 'update') {
      const row = rowsOf(st.table).find((r) => match(r, st.filters));
      if (row) Object.assign(row, st.ins);
      return { data: row || null, error: row ? null : { code: 'PGRST116' } };
    }
    if (st.table === 'workspaces') return { data: { id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false }, error: null };
    const row = rowsOf(st.table).find((r) => match(r, st.filters));
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
  }
  function list(st) {
    if (st.op === 'delete') {
      const rows = rowsOf(st.table);
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], st.filters)) rows.splice(i, 1);
      return { data: null, error: null };
    }
    if (st.op === 'insert') {
      const row = { id: 'a-' + (++seq), created_at: new Date(seq).toISOString(), ...st.ins };
      (store[st.table] = store[st.table] || []).push(row);
      return { data: [row], error: null };
    }
    if (st.op === 'update') {
      for (const r of rowsOf(st.table)) if (match(r, st.filters)) Object.assign(r, st.ins);
      return { data: null, error: null };
    }
    if (st.table === 'workspaces') return { data: [{ id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false }], error: null };
    if (!(st.table in store)) return { data: null, error: { code: '42P01', message: 'missing' } };
    return { data: rowsOf(st.table).filter((r) => match(r, st.filters)), error: null };
  }

  return {
    from: builder, _store: store, _flags: flags,
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
const libraryRouter = require('../routes/library');

const app = express();
app.use(libraryRouter);

const AUTHED = ['Cookie', 'sb_access=tok'];

function seedAsset(over = {}) {
  const row = {
    id: 'seed-' + Math.random().toString(36).slice(2, 8),
    workspace_id: 'ws-user-1',
    hook: 'Stop scrolling',
    caption: 'A caption about candles',
    cta: 'Shop now',
    status: 'draft',
    favourite: false,
    archived: false,
    created_at: new Date().toISOString(),
    ...over,
  };
  db._store.social_assets.push(row);
  return row;
}

test('library lists normalized assets with pagination info', async () => {
  db._store.social_assets.length = 0;
  seedAsset();
  const r = await request(app).get('/api/assets/library').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  const item = r.body.items[0];
  assert.equal(item.table, 'social_assets');
  assert.equal(item.title, 'Stop scrolling');
  assert.ok(item.snippet.includes('caption about candles'));
  assert.ok(r.body.total >= 1);
});

test('search filters by text; archived hidden by default', async () => {
  db._store.social_assets.length = 0;
  seedAsset({ hook: 'Candle sale' });
  seedAsset({ hook: 'Hidden one', archived: true });
  const r = await request(app).get('/api/assets/library?q=candle').set(...AUTHED);
  assert.equal(r.body.items.length, 1);
  const all = await request(app).get('/api/assets/library').set(...AUTHED);
  assert.equal(all.body.items.length, 1); // archived excluded
  const arch = await request(app).get('/api/assets/library?archived=true').set(...AUTHED);
  assert.equal(arch.body.items.length, 1);
  assert.equal(arch.body.items[0].title, 'Hidden one');
});

test('content edit snapshots a version; restore brings it back', async () => {
  db._store.social_assets.length = 0;
  db._store.asset_versions.length = 0;
  const row = seedAsset({ caption: 'Original caption' });

  const patch = await request(app).patch(`/api/assets/library/social_assets/${row.id}`)
    .set(...AUTHED).send({ caption: 'Edited caption' });
  assert.equal(patch.status, 200);
  assert.equal(db._store.asset_versions.length, 1);
  assert.equal(db._store.asset_versions[0].snapshot.caption, 'Original caption');

  const versions = await request(app).get(`/api/assets/library/social_assets/${row.id}/versions`).set(...AUTHED);
  assert.equal(versions.body.versions.length, 1);

  const restore = await request(app).post(`/api/assets/library/social_assets/${row.id}/restore`)
    .set(...AUTHED).send({ version_id: db._store.asset_versions[0].id });
  assert.equal(restore.status, 200);
  assert.equal(restore.body.asset.caption, 'Original caption');
});

test('duplicate creates a draft copy', async () => {
  db._store.social_assets.length = 0;
  const row = seedAsset({ hook: 'Original', favourite: true, status: 'approved' });
  const r = await request(app).post(`/api/assets/library/social_assets/${row.id}/duplicate`).set(...AUTHED);
  assert.equal(r.status, 201);
  assert.equal(r.body.asset.hook, 'Original (copy)');
  assert.equal(r.body.asset.status, 'draft');
  assert.equal(r.body.asset.favourite, false);
});

test('another user cannot touch the asset (404)', async () => {
  db._store.social_assets.length = 0;
  const row = seedAsset();
  db._flags.user = { id: 'attacker', email: 'evil@x.com' };
  const r = await request(app).patch(`/api/assets/library/social_assets/${row.id}`)
    .set(...AUTHED).send({ favourite: true });
  assert.equal(r.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});

test('unknown table is rejected', async () => {
  const r = await request(app).patch('/api/assets/library/users/xyz').set(...AUTHED).send({ favourite: true });
  assert.equal(r.status, 400);
});

test('bulk archive updates owned items only', async () => {
  db._store.social_assets.length = 0;
  const a = seedAsset();
  const b = seedAsset({ workspace_id: 'ws-other' });
  const r = await request(app).post('/api/assets/library/bulk').set(...AUTHED)
    .send({ action: 'archive', items: [{ table: 'social_assets', id: a.id }, { table: 'social_assets', id: b.id }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 1);
  assert.equal(a.archived, true);
  assert.equal(b.archived, false);
});

test('bulk status sets status on owned items', async () => {
  db._store.social_assets.length = 0;
  const a = seedAsset();
  const r = await request(app).post('/api/assets/library/bulk').set(...AUTHED)
    .send({ action: 'status', value: 'ready', items: [{ table: 'social_assets', id: a.id }] });
  assert.equal(r.status, 200);
  assert.equal(a.status, 'ready');
});

test('bulk permanent delete requires a second confirmation', async () => {
  db._store.social_assets.length = 0;
  const a = seedAsset();
  // Without confirm → 409, nothing deleted.
  const blocked = await request(app).post('/api/assets/library/bulk').set(...AUTHED)
    .send({ action: 'delete', items: [{ table: 'social_assets', id: a.id }] });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'CONFIRM_DELETE');
  assert.equal(db._store.social_assets.length, 1);
  // With confirm → deleted (and a snapshot kept).
  const ok = await request(app).post('/api/assets/library/bulk').set(...AUTHED)
    .send({ action: 'delete', confirm: true, items: [{ table: 'social_assets', id: a.id }] });
  assert.equal(ok.status, 200);
  assert.equal(db._store.social_assets.length, 0);
});

test('version snapshot records source and author', async () => {
  db._store.social_assets.length = 0;
  db._store.asset_versions.length = 0;
  const row = seedAsset({ caption: 'v1' });
  await request(app).patch(`/api/assets/library/social_assets/${row.id}`)
    .set(...AUTHED).send({ caption: 'v2' });
  assert.equal(db._store.asset_versions.length, 1);
  assert.equal(db._store.asset_versions[0].source, 'edit');
  assert.equal(db._store.asset_versions[0].author_email, 'me@app.com');
});
