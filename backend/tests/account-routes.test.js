const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule, makeFakeSupabase } = require('./helpers');

const state = { user: { id: 'user-1', email: 'me@app.com' } };

const fakeSupabase = makeFakeSupabase({
  workspaces: { data: { id: 'ws1', user_id: 'user-1' }, error: null },
  customers: { data: null, error: null },
});
fakeSupabase.authClient = () => ({
  auth: { signInWithPassword: async ({ password }) => (password === 'correct-password' ? { data: { session: {}, user: null }, error: null } : { data: null, error: { status: 400, message: 'Invalid login credentials' } }),
    getUser: async () => (state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: 'no' } }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
  },
});
let deletedUser = null;
fakeSupabase.adminClient = () => ({
  auth: { admin: { deleteUser: async (id) => { deletedUser = id; return {}; } } },
});
stubModule('lib/supabase.js', fakeSupabase);

stubModule('lib/stripe.js', {
  subscriptions: { list: async () => ({ data: [] }), cancel: async () => ({}) },
});

const express = require('express');
const request = require('supertest');
const accountRouter = require('../routes/account');

const app = express();
app.use(accountRouter);

const AUTHED = ['Cookie', 'sb_access=tok'];

test('export requires auth', async () => {
  state.user = null;
  const r = await request(app).get('/api/account/export');
  assert.equal(r.status, 401);
  state.user = { id: 'user-1', email: 'me@app.com' };
});

test('export returns a JSON attachment of the workspace data', async () => {
  const r = await request(app).get('/api/account/export').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'] || '', /attachment/);
  const body = JSON.parse(r.text);
  assert.equal(body.account.email, 'me@app.com');
  assert.equal(body.export_version, 2);
  assert.ok(Array.isArray(body.workspaces) && body.workspaces.length >= 1);
  assert.ok(body.workspaces[0].workspace);
  assert.ok('data' in body.workspaces[0]);
});

test('delete cancels billing, wipes data and deletes the auth user', async () => {
  deletedUser = null;
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({ password: 'correct-password' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.receipt.completed, true);
  assert.ok(Array.isArray(r.body.receipt.steps));
  assert.ok(r.body.receipt.steps.some((s) => s.name === 'retained_records'));
  assert.equal(deletedUser, 'user-1');
  // session cookies cleared
  const cookies = r.headers['set-cookie'] || [];
  assert.ok(cookies.some((c) => /sb_access=;/.test(c)));
});

test('delete requires auth', async () => {
  state.user = null;
  const r = await request(app).post('/api/account/delete').send({});
  assert.equal(r.status, 401);
  state.user = { id: 'user-1', email: 'me@app.com' };
});

test('billing returns plan + usage for the signed-in user', async () => {
  const r = await request(app).get('/api/account/billing').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.equal(r.body.email, 'me@app.com');
  assert.ok('plan' in r.body);
  assert.ok('usage' in r.body);
  assert.ok('limits' in r.body);
});

test('billing requires auth', async () => {
  state.user = null;
  const r = await request(app).get('/api/account/billing');
  assert.equal(r.status, 401);
  state.user = { id: 'user-1', email: 'me@app.com' };
});

// ── audit S4: the password is confirmed before anything is deleted ──────────

test('S4: deletion without a password deletes nothing', async () => {
  deletedUser = null;
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'PASSWORD_REQUIRED');
  assert.equal(deletedUser, null);
});

test('S4: deletion with a wrong password deletes nothing', async () => {
  deletedUser = null;
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({ password: 'guess' });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'PASSWORD_INCORRECT');
  assert.equal(deletedUser, null);
});
