const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
// v13 SC-P0-03: EUR is only selectable when the whole price set is configured,
// so the EUR tests need a complete catalog. STUDIO_YEARLY is deliberately left
// unset by the "unconfigured plan price" test via delete (see below).
process.env.STRIPE_PRICE_STARTER_YEARLY = 'price_starter_y';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_m';
process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
process.env.STRIPE_PRICE_STUDIO_MONTHLY = 'price_studio_m';
process.env.STRIPE_PRICE_STUDIO_YEARLY = 'price_studio_y';

const { stubModule, makeFakeSupabase } = require('./helpers');

// Mutable auth + plan state per test.
const state = {
  user: { id: 'user-1', email: 'me@app.com' },
  currentPlan: null, // planFor() → what the caller already has
  hadTrial: false,   // hadTrialOrActiveSubscription()
  rejectEur: false,  // simulate a Stripe price with no EUR currency_option
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
// v13 SC-P0-01: checkout reads the explicit entitlement state, so it can tell
// "verified free" apart from "could not verify".
customers.resolveEntitlement = async () => ({
  state: state.entitlementState || (state.currentPlan ? 'entitled' : 'free'),
  plan: state.currentPlan,
});

// Fake Stripe: record checkout payload + customer creation.
let lastCheckout = null;
let createdCustomers = 0;
stubModule('lib/stripe.js', {
  customers: {
    create: async (payload) => { createdCustomers += 1; return { id: 'cus_new', ...payload }; },
  },
  checkout: {
    sessions: {
      create: async (payload) => {
        // Simulate a price that has no EUR currency_option: reject the EUR
        // attempt exactly as live Stripe does, so the route's USD fallback runs.
        if (payload.currency === 'eur' && state.rejectEur) {
          const e = new Error("The price specified only supports `usd`. This doesn't match the expected currency: `eur`.");
          e.type = 'StripeInvalidRequestError';
          throw e;
        }
        lastCheckout = payload;
        return { url: 'https://checkout.stripe.com/s' };
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

const AUTHED = ['Cookie', 'sb_access=validtoken'];

function reset() {
  state.user = { id: 'user-1', email: 'me@app.com' };
  state.currentPlan = null;
  state.hadTrial = false;
  state.rejectEur = false;
  state.entitlementState = null;
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

test('EU buyer pins EUR; non-EU pins nothing so Adaptive Pricing can localize', async () => {
  process.env.EUR_PRICING_ENABLED = '1';
  try {
    reset();
    const eu = await request(app).post('/api/payments/create-checkout-session')
      .set(...AUTHED).set('x-vercel-ip-country', 'DE').send({ plan: 'starter', interval: 'monthly' });
    assert.equal(eu.status, 200);
    assert.equal(lastCheckout.currency, 'eur');

    // A non-EU buyer must NOT have currency pinned — leaving it unset is what
    // lets Adaptive Pricing (or the USD base) apply.
    reset();
    const us = await request(app).post('/api/payments/create-checkout-session')
      .set(...AUTHED).set('x-vercel-ip-country', 'US').send({ plan: 'starter', interval: 'monthly' });
    assert.equal(us.status, 200);
    assert.equal(lastCheckout.currency, undefined);
  } finally {
    delete process.env.EUR_PRICING_ENABLED;
  }
});

// v13 SC-P0-03 — displayed currency must equal charged currency. A EUR quote
// followed by a USD charge is the exact bug this replaces.
test('EU checkout NEVER falls back to USD when the price has no EUR — no session is created', async () => {
  process.env.EUR_PRICING_ENABLED = '1';
  try {
    reset();
    state.rejectEur = true; // the Stripe price only supports USD
    const eu = await request(app).post('/api/payments/create-checkout-session')
      .set(...AUTHED).set('x-vercel-ip-country', 'DE').send({ plan: 'starter', interval: 'monthly' });
    assert.equal(eu.status, 503);
    assert.equal(eu.body.code, 'CHECKOUT_UNAVAILABLE');
    assert.equal(eu.body.retryable, false);
    assert.ok(/You have not been charged/.test(eu.body.error));
    // No raw Stripe text may reach the customer.
    assert.ok(!/price|currency_option|usd|eur|stripe/i.test(eu.body.error.replace(/Checkout is temporarily unavailable for this price\./, '')));
    assert.equal(lastCheckout, null, 'no USD session may be created after a EUR quote');
    assert.ok(!eu.body.url);
  } finally {
    delete process.env.EUR_PRICING_ENABLED;
  }
});

test('a tampered currency/priceId in the body cannot change the selected catalog', async () => {
  process.env.EUR_PRICING_ENABLED = '1';
  try {
    reset();
    const r = await request(app).post('/api/payments/create-checkout-session')
      .set(...AUTHED).set('x-vercel-ip-country', 'US')
      .send({ plan: 'starter', interval: 'monthly', currency: 'eur', priceId: 'price_ATTACKER', catalog_version: 'x' });
    assert.equal(r.status, 200);
    assert.equal(lastCheckout.currency, undefined, 'client currency must be ignored');
    assert.equal(lastCheckout.line_items[0].price, 'price_starter_m');
    assert.equal(lastCheckout.metadata.catalog_currency, 'usd');
  } finally {
    delete process.env.EUR_PRICING_ENABLED;
  }
});

test('the checkout session is stamped with the catalog version and price key it was quoted from', async () => {
  reset();
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 200);
  const { CATALOG_VERSION } = require('../lib/plan-catalog');
  assert.equal(lastCheckout.metadata.catalog_version, CATALOG_VERSION);
  assert.equal(lastCheckout.metadata.price_key, 'STRIPE_PRICE_STARTER_MONTHLY');
});

test('an unconfigured plan price returns the stable public error, not env details', async () => {
  reset();
  const saved = process.env.STRIPE_PRICE_STUDIO_YEARLY;
  delete process.env.STRIPE_PRICE_STUDIO_YEARLY;
  try {
    const r = await request(app).post('/api/payments/create-checkout-session')
      .set(...AUTHED).send({ plan: 'studio', interval: 'yearly' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'CHECKOUT_UNAVAILABLE');
    assert.ok(!/STRIPE_PRICE/.test(r.body.error), 'must not leak env var names');
    assert.equal(lastCheckout, null);
  } finally {
    process.env.STRIPE_PRICE_STUDIO_YEARLY = saved;
  }
});

test('with EUR pricing disabled (default), no currency is pinned for anyone', async () => {
  delete process.env.EUR_PRICING_ENABLED;
  reset();
  const eu = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).set('x-vercel-ip-country', 'DE').send({ plan: 'starter', interval: 'monthly' });
  assert.equal(eu.status, 200);
  assert.equal(lastCheckout.currency, undefined);
});

test('an already-subscribed user is blocked (no duplicate subscription)', async () => {
  reset();
  state.currentPlan = 'pro';
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ALREADY_SUBSCRIBED');
});

// v13 SC-P0-01 — checkout FAILS CLOSED when entitlement cannot be verified.
test('checkout creates no Stripe session when the plan lookup is unavailable', async () => {
  reset();
  state.entitlementState = 'unavailable';
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'PLAN_UNAVAILABLE');
  assert.equal(r.body.retryable, true);
  assert.equal(lastCheckout, null, 'no Stripe Checkout Session may be created');
  assert.equal(createdCustomers, 0, 'no Stripe customer may be created either');
  assert.ok(!/supabase|postgres|PGRST/i.test(r.body.error), 'no raw provider text');
});

test('checkout also fails closed when an entitling subscription is on an unmapped price', async () => {
  reset();
  state.entitlementState = 'unmapped';
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 503);
  assert.equal(lastCheckout, null);
});

test('cancel-subscription requires auth', async () => {
  reset();
  state.user = null;
  const r = await request(app).post('/api/payments/cancel-subscription').send({ subscriptionId: 'sub_123' });
  assert.equal(r.status, 401);
});
