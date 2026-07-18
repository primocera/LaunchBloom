// Playbook v6 Prompt 8 — multi-workspace export and honest deletion receipts:
// external failures must surface in the receipt, never be swallowed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

const state = { user: { id: 'user-1', email: 'me@app.com' } };
const OWNED = [
  { id: 'ws1', user_id: 'user-1', name: 'Brand A' },
  { id: 'ws2', user_id: 'user-1', name: 'Brand B' },
];

// Fake supabase: workspaces list returns BOTH owned workspaces (as an array),
// customers has a Stripe id so the cancellation step actually runs.
function builder(table) {
  const b = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
  const result =
    table === 'workspaces' ? { data: OWNED, error: null }
    : table === 'customers' ? { data: { id: 'c1', stripe_customer_id: 'cus_1' }, error: null }
    : { data: null, error: null };
  b.single = () => Promise.resolve(table === 'workspaces' ? { data: OWNED[0], error: null } : result);
  b.then = (ok, err) => Promise.resolve(result).then(ok, err);
  return b;
}
const fakeSupabase = {
  from: (t) => builder(t),
  authClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  }),
  adminClient: () => ({ auth: { admin: { deleteUser: async () => ({}) } } }),
};
stubModule('lib/supabase.js', fakeSupabase);

// Stripe: has one active subscription whose cancellation FAILS.
stubModule('lib/stripe.js', {
  subscriptions: {
    list: async () => ({ data: [{ id: 'sub_1', status: 'active' }] }),
    cancel: async () => { throw new Error('stripe down'); },
  },
});

const collected = [];
stubModule('lib/workspace-data.js', {
  collectWorkspaceData: async (id) => { collected.push(id); return { assets: [] }; },
  deleteWorkspaceData: async () => {},
});

const express = require('express');
const request = require('supertest');
const accountRouter = require('../routes/account');

const app = express();
app.use(accountRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('export includes every owned workspace', async () => {
  collected.length = 0;
  const r = await request(app).get('/api/account/export').set(...AUTHED);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.text);
  assert.equal(body.workspace_count, 2);
  assert.deepEqual(collected.sort(), ['ws1', 'ws2']);
  assert.deepEqual(body.workspaces.map((w) => w.workspace.id).sort(), ['ws1', 'ws2']);
});

test('deletion receipt surfaces a failed Stripe cancellation instead of returning blanket success', async () => {
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false, 'must not claim success when a step failed');
  assert.equal(r.body.receipt.completed, false);
  const stripeStep = r.body.receipt.steps.find((s) => s.name === 'stripe_cancellation');
  assert.equal(stripeStep.status, 'failed');
  assert.ok(r.body.receipt.support_note);
  // Data deletion still ran for both workspaces (idempotent, resumable).
  const wsStep = r.body.receipt.steps.find((s) => s.name === 'workspace_data');
  assert.equal(wsStep.status, 'ok');
});
