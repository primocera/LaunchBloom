// ---------------------------------------------------------------------------
// XAPP-95-01 — the billing portal and account deletion consume the SAME shared
// customers.stripe_customer_id column that checkout must verify (SC-95-01). A
// foreign (Mellowa) or wrong-user customer id in that row must never (a) open a
// billing portal into another product's customer, nor (b) cause account
// deletion to cancel another product's live subscriptions. Both fail closed.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';

const { stubModule, makeFakeSupabase } = require('./helpers');

const state = { user: { id: 'user-1', email: 'me@app.com' } };
const fakeSupabase = makeFakeSupabase({
  workspaces: { data: { id: 'ws1', user_id: 'user-1' }, error: null },
  customers: { data: { id: 'cust-1', email: 'me@app.com', stripe_customer_id: 'cus_foreign' }, error: null },
  subscriptions: { data: [], error: null },
});
fakeSupabase.authClient = () => ({
  auth: {
    getUser: async () => (state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: 'no' } }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
  },
});
fakeSupabase.adminClient = () => ({ auth: { admin: { deleteUser: async () => ({}) } } });
stubModule('lib/supabase.js', fakeSupabase);

// A FOREIGN customer: live, but stamped for another product (source=mellowa).
const calls = { portalCreated: 0, subsListed: 0, subsCanceled: 0 };
stubModule('lib/stripe.js', {
  customers: {
    retrieve: async (id) => ({ id, deleted: false, metadata: { source: 'mellowa', app_user_id: 'user-1' } }),
  },
  billingPortal: { sessions: { create: async () => { calls.portalCreated += 1; return { url: 'https://billing.stripe.com/x' }; } } },
  subscriptions: {
    list: async () => { calls.subsListed += 1; return { data: [{ id: 'sub_mellowa', status: 'active' }] }; },
    cancel: async () => { calls.subsCanceled += 1; return {}; },
  },
});

const deletedWorkspaces = [];
stubModule('lib/workspace-data.js', {
  collectWorkspaceData: async () => ({ assets: [] }),
  deleteWorkspaceData: async (id) => { deletedWorkspaces.push(id); },
});
stubModule('lib/lifecycle-email.js', { sendLifecycleEmail: async () => ({}) });

const express = require('express');
const request = require('supertest');
const accountRouter = require('../routes/account');

const app = express();
app.use(express.json());
app.use(accountRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('billing portal fails closed on a FOREIGN stored customer — no portal session', async () => {
  calls.portalCreated = 0;
  const r = await request(app).post('/api/account/billing-portal').set(...AUTHED).send({});
  assert.equal(r.status, 404, 'no portal into a customer we cannot prove is ours');
  assert.equal(calls.portalCreated, 0, 'billingPortal.sessions.create must never be called');
  assert.ok(!JSON.stringify(r.body).includes('mellowa'), 'no foreign product detail leaks');
});

test('account deletion never cancels a FOREIGN customer\'s subscriptions', async () => {
  calls.subsListed = 0;
  calls.subsCanceled = 0;
  deletedWorkspaces.length = 0;
  const r = await request(app).post('/api/account/delete').set(...AUTHED).send({});
  // Local data is still deleted; the Stripe cancellation is SKIPPED, not run.
  assert.equal(calls.subsCanceled, 0, 'a foreign product\'s live subscriptions must never be cancelled');
  const cancelStep = ((r.body.receipt && r.body.receipt.steps) || []).find((s) => s.name === 'stripe_cancellation');
  assert.ok(cancelStep, 'the receipt records the cancellation step');
  assert.equal(cancelStep.status, 'skipped', 'skipped because ownership was not proven');
});
