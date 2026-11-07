// Re-sweep 2026-11-07 S1 + S2: account deletion and export cover the
// user-keyed action_topups table (migration 041), and deletion cancels
// lifecycle emails still queued for the deleted address.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

const user = { id: 'user-1', email: 'me@app.com' };
const calls = []; // { table, op, payload, filters: [[method, col, val]] }
const failTables = new Set();
const missingTables = new Set();
const TOPUPS = [{ id: 't1', user_id: 'user-1', pack: 'actions_40', actions: 40, status: 'active' }];

function builder(table) {
  const call = { table, op: 'select', payload: null, filters: [] };
  calls.push(call);
  const b = {};
  for (const m of ['select', 'order', 'limit', 'upsert', 'insert']) b[m] = () => b;
  b.update = (p) => { call.op = 'update'; call.payload = p; return b; };
  b.delete = () => { call.op = 'delete'; return b; };
  for (const m of ['eq', 'neq', 'in', 'is', 'gte', 'lte']) b[m] = (c, v) => { call.filters.push([m, c, v]); return b; };
  const result = () => {
    if (missingTables.has(table)) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    if (failTables.has(table) && call.op !== 'select') return { data: null, error: { message: 'db down' } };
    if (table === 'workspaces') return { data: [{ id: 'ws1', user_id: 'user-1' }], error: null };
    if (table === 'action_topups' && call.op === 'select') return { data: TOPUPS, error: null };
    return { data: null, error: null };
  };
  b.single = () => Promise.resolve(table === 'workspaces' ? { data: { id: 'ws1' }, error: null } : { data: null, error: null });
  b.then = (ok, err) => Promise.resolve(result()).then(ok, err);
  return b;
}
stubModule('lib/supabase.js', {
  from: (t) => builder(t),
  authClient: () => ({ auth: {
    getUser: async () => ({ data: { user }, error: null }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
  } }),
  adminClient: () => ({ auth: { admin: { deleteUser: async () => ({}) } } }),
});
stubModule('lib/workspace-data.js', {
  collectWorkspaceData: async () => ({}),
  deleteWorkspaceData: async () => {},
});

const express = require('express');
const request = require('supertest');
const accountRouter = require('../routes/account');

const app = express();
app.use(accountRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];
const stepOf = (r, name) => r.body.receipt.steps.find((s) => s.name === name);

function reset() { calls.length = 0; failTables.clear(); missingTables.clear(); }

test('S1: export includes the account\'s AI-action packs', async () => {
  reset();
  const r = await request(app).get('/api/account/export').set(...AUTHED);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.text);
  assert.deepEqual(body.action_topups, TOPUPS);
  const read = calls.find((c) => c.table === 'action_topups');
  assert.deepEqual(read.filters, [['eq', 'user_id', 'user-1']]);
});

test('S1: export still works before migration 041 is applied', async () => {
  reset();
  missingTables.add('action_topups');
  const r = await request(app).get('/api/account/export').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text).action_topups, []);
});

test('S1 + S2: delete removes the packs and cancels queued emails for that address only', async () => {
  reset();
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  assert.equal(r.status, 200);
  assert.equal(stepOf(r, 'topup_packs').status, 'ok');
  assert.equal(stepOf(r, 'queued_emails').status, 'ok');

  const del = calls.find((c) => c.table === 'action_topups' && c.op === 'delete');
  assert.deepEqual(del.filters, [['eq', 'user_id', 'user-1']]);

  const cancel = calls.find((c) => c.table === 'email_events' && c.op === 'update');
  assert.equal(cancel.payload.status, 'skipped');
  assert.deepEqual(cancel.filters, [['eq', 'recipient', 'me@app.com'], ['in', 'status', ['pending', 'failed']]]);
});

test('S1: a missing 041 table is not a failed deletion step', async () => {
  reset();
  missingTables.add('action_topups');
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  assert.equal(stepOf(r, 'topup_packs').status, 'ok');
});

test('S1 + S2: DB errors surface in the receipt instead of a blanket success', async () => {
  reset();
  failTables.add('action_topups');
  failTables.add('email_events');
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  assert.equal(stepOf(r, 'topup_packs').status, 'failed');
  assert.equal(stepOf(r, 'queued_emails').status, 'failed');
  assert.equal(r.body.receipt.completed, false);
});
