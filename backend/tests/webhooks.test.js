const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
delete process.env.RESEND_API_KEY;

const { stubModule, makeFakeSupabase } = require('./helpers');

stubModule('lib/supabase.js', makeFakeSupabase({
  customers: { data: { id: 'cust-1' }, error: null },
  subscriptions: { data: null, error: null },
}));

// Real Stripe SDK does local HMAC verification — no network involved.
const Stripe = require('stripe');
const stripeSdk = Stripe(process.env.STRIPE_SECRET_KEY);

const express = require('express');
const request = require('supertest');
const webhooksRouter = require('../routes/webhooks');

const app = express();
app.use('/api/webhooks', webhooksRouter);

function signedPayload(event) {
  const payload = JSON.stringify(event);
  const header = stripeSdk.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return { payload, header };
}

test('webhook: rejects missing signature', async () => {
  const r = await request(app)
    .post('/api/webhooks/stripe')
    .set('content-type', 'application/json')
    .send('{}');
  assert.equal(r.status, 400);
});

test('webhook: rejects invalid signature', async () => {
  const r = await request(app)
    .post('/api/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', 't=1,v1=deadbeef')
    .send(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }));
  assert.equal(r.status, 400);
});

test('webhook: accepts a correctly signed event', async () => {
  const { payload, header } = signedPayload({
    id: 'evt_test_1',
    type: 'some.unhandled.event',
    data: { object: {} },
  });
  const r = await request(app)
    .post('/api/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', header)
    .send(payload);
  assert.equal(r.status, 200);
  assert.equal(r.body.received, true);
});

test('webhook: subscription.updated upserts and returns 200', async () => {
  const { payload, header } = signedPayload({
    id: 'evt_test_2',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test',
        customer: 'cus_test',
        status: 'active',
        items: { data: [{ price: { id: 'price_x' } }] },
        cancel_at_period_end: false,
        metadata: {},
      },
    },
  });
  const r = await request(app)
    .post('/api/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', header)
    .send(payload);
  assert.equal(r.status, 200);
});
