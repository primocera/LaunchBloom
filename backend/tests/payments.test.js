const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule, makeFakeSupabase } = require('./helpers');

// Mutable auth + plan state per test.
const state = {
  user: { id: 'user-1', email: 'me@app.com' },
  currentPlan: null, // planFor() → what the caller already has
  hadTrial: false,   // hadTrialOrActiveSubscription()
};

const fakeSupabase = makeFakeSupabase({
  // customers lookups: no existing Stripe customer (forces create).
  customers: { data: null, error: null },
  subscriptions: { data: null, error: null },
});
// Authenticated: getUser returns our user when any access cookie is present.
fakeSupabase.authClient = () => ({
  auth: {
    getUser: async () => (state.user
      ? { data: { user: state.user }, error: null }
      : { data: { user: null }, error: { message: 'no' } }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
  },
});
stubModule('lib/supabase.js', fakeSupabase);

// Stub customers.planFor / hadTrial via the customers module? planFor reads
// supabase; simpler to stub the whole customers module's planFor.
const customers = require('../routes/customers');
customers.planFor = async () => state.currentPlan;

// Fake Stripe: record checkout payload + customer creation.
let lastCheckout = null;
let createdCustomers = 0;
stubModule('lib/stripe.js', {
  customers: {
    create: async (payload) => { createdCustomers += 1; return { id: 'cus_new', ...payload }; },
  },
  checkout: {
    sessions: {
      create: async (payload) => { lastCheckout = payload; return { url: 'https://checkout.stripe.com/s' }; },
    },
  },
});

const express = require('express');
const request = require('supertest');
const paymentsRouter = require('../routes/payments');

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);

const AUTHED = ['Cookie', 'sb_access=validtoken'];

function reset() {
  state.user = { id: 'user-1', email: 'me@app.com' };
  state.currentPlan = null;
  state.hadTrial = false;
  lastCheckout = null;
  createdCustomers = 0;
}

test('checkout requires authentication', async () => {
  reset();
  state.user = null; // no session
  const r = await request(app).post('/api/payments/create-checkout-session').send({ plan: 'starter' });
  assert.equal(r.status, 401);
});

test('unknown plan is rejected', async () => {
  reset();
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'platinum', interval: 'monthly' });
  assert.equal(r.status, 400);
});

test('arbitrary priceId in the body is ignored (only plan resolves the price)', async () => {
  reset();
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly', priceId: 'price_ATTACKER_DISCOUNT' });
  assert.equal(r.status, 200);
  assert.equal(lastCheckout.line_items[0].price, 'price_starter_m');
});

test('client-supplied email is ignored — customer derives from the session', async () => {
  reset();
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly', email: 'victim@elsewhere.com' });
  assert.equal(r.status, 200);
  // Uses a Stripe customer id (not customer_email), tied to our user id.
  assert.equal(lastCheckout.customer, 'cus_new');
  assert.equal(lastCheckout.client_reference_id, 'user-1');
  assert.equal(lastCheckout.subscription_data.metadata.app_user_id, 'user-1');
  assert.ok(!lastCheckout.customer_email);
});

test('first-time subscriber gets a 3-day trial; redirect uses PUBLIC_URL', async () => {
  reset();
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 200);
  assert.equal(lastCheckout.subscription_data.trial_period_days, 3);
  assert.ok(lastCheckout.success_url.startsWith('https://app.example.com/'));
});

test('an already-subscribed user is blocked (no duplicate subscription)', async () => {
  reset();
  state.currentPlan = 'pro';
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ALREADY_SUBSCRIBED');
});

test('cancel-subscription requires auth', async () => {
  reset();
  state.user = null;
  const r = await request(app).post('/api/payments/cancel-subscription').send({ subscriptionId: 'sub_123' });
  assert.equal(r.status, 401);
});
