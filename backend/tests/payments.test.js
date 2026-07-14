const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule, makeFakeSupabase } = require('./helpers');

// No prior customer → first-time subscriber path
stubModule('lib/supabase.js', makeFakeSupabase({
  customers: { data: null, error: null },
  subscriptions: { data: null, error: null },
}));

// Fake Stripe client: records the checkout payload, returns a hosted URL.
let lastCheckout = null;
stubModule('lib/stripe.js', {
  checkout: {
    sessions: {
      create: async (payload) => {
        lastCheckout = payload;
        return { url: 'https://checkout.stripe.com/test-session' };
      },
    },
  },
});

const express = require('express');
const request = require('supertest');
const paymentsRouter = require('../routes/payments');

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);

test('checkout: rejects missing email', async () => {
  const r = await request(app)
    .post('/api/payments/create-checkout-session')
    .send({ plan: 'starter' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /email/);
});

test('checkout: rejects unconfigured plan', async () => {
  const r = await request(app)
    .post('/api/payments/create-checkout-session')
    .send({ plan: 'platinum', email: 'a@b.com' });
  assert.equal(r.status, 400);
});

test('checkout: rejects empty body', async () => {
  const r = await request(app)
    .post('/api/payments/create-checkout-session')
    .send({});
  assert.equal(r.status, 400);
});

test('checkout: valid plan+interval creates a session with 3-day trial for new customers', async () => {
  const r = await request(app)
    .post('/api/payments/create-checkout-session')
    .send({ plan: 'starter', interval: 'monthly', email: 'new@b.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://checkout.stripe.com/test-session');
  assert.equal(lastCheckout.mode, 'subscription');
  assert.equal(lastCheckout.line_items[0].price, 'price_starter_m');
  assert.equal(lastCheckout.subscription_data.trial_period_days, 3);
  // Redirects must come from PUBLIC_URL, not a client-controlled origin
  assert.ok(lastCheckout.success_url.startsWith('https://app.example.com/'));
});

test('cancel-subscription requires auth', async () => {
  const r = await request(app)
    .post('/api/payments/cancel-subscription')
    .send({ subscriptionId: 'sub_123' });
  assert.equal(r.status, 401);
});
