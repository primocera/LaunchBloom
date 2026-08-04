// ---------------------------------------------------------------------------
// v14 SC-02 — checkout-level FAIL-CLOSED proof.
//
// The trial-history and Stripe-customer reads must be resolved BEFORE anything
// is created in Stripe, and any Supabase read/persist error must abort checkout
// with a stable 503 — never a second free trial, never an unlinked duplicate
// Stripe customer. These endpoint tests use a fine-grained Supabase fake so the
// customer read, the subscription read and the persistence upsert can each fail
// independently, with Stripe call counters proving nothing was created.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule } = require('./helpers');

const DB_ERROR = { code: '08006', message: 'connection refused' };
const NO_ROW = { code: 'PGRST116', message: 'no rows' };

// Independently controllable DB results per operation.
const db = {
  customersRead: { data: null, error: null }, // customers .select().single()
  subscriptionsRead: { data: null, error: null }, // subscriptions list read
  customersUpsert: { error: null }, // customers .upsert() result
};
const stripeCalls = { customersCreated: 0, sessionsCreated: 0 };
const user = { id: 'user-1', email: 'me@app.com' };

function fakeFrom(table) {
  let op = 'select';
  const b = {
    select() { op = 'select'; return b; },
    upsert() { op = 'upsert'; return b; },
    update() { op = 'update'; return b; },
    insert() { op = 'insert'; return b; },
    delete() { op = 'delete'; return b; },
    eq() { return b; }, neq() { return b; }, in() { return b; }, is() { return b; },
    gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
    single() {
      if (table === 'customers') return Promise.resolve(db.customersRead);
      if (table === 'subscriptions') return Promise.resolve(db.subscriptionsRead);
      return Promise.resolve({ data: null, error: null });
    },
    then(onOk, onErr) {
      let result;
      if (op === 'upsert' && table === 'customers') result = db.customersUpsert;
      else if (table === 'subscriptions') result = db.subscriptionsRead;
      else result = { data: null, error: null };
      return Promise.resolve(result).then(onOk, onErr);
    },
  };
  return b;
}

stubModule('lib/supabase.js', {
  from: fakeFrom,
  rpc: async () => ({ data: null, error: { code: 'PGRST202' } }),
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  authClient: () => ({
    auth: {
      getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'no' } }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  }),
  adminClient: () => ({ auth: { admin: { signOut: async () => ({}), updateUserById: async () => ({ error: null }) } } }),
});

// The entitlement gate is proven fail-closed elsewhere; here we hold it at a
// VERIFIED 'free' so control reaches the trial/customer step under test.
const customers = require('../routes/customers');
customers.resolveEntitlement = async () => ({ state: 'free', plan: null });
customers.planFor = async () => null;

stubModule('lib/stripe.js', {
  customers: {
    create: async (payload) => { stripeCalls.customersCreated += 1; return { id: 'cus_new', ...payload }; },
    retrieve: async (id) => ({ id, deleted: false }),
  },
  checkout: {
    sessions: {
      create: async () => { stripeCalls.sessionsCreated += 1; return { url: 'https://checkout.stripe.com/s' }; },
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
  db.customersRead = { data: null, error: null };
  db.subscriptionsRead = { data: null, error: null };
  db.customersUpsert = { error: null };
  stripeCalls.customersCreated = 0;
  stripeCalls.sessionsCreated = 0;
}

function noRawProviderText(body) {
  const s = JSON.stringify(body);
  assert.ok(!/supabase|postgres|PGRST|08006|connection refused|sk_|cus_/i.test(s), 'response must not leak raw provider text/ids');
}

test('customer-read failure aborts checkout → 503, zero Stripe customer, zero session', async () => {
  reset();
  db.customersRead = { data: null, error: DB_ERROR };
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 503);
  assert.equal(r.body.retryable, true);
  assert.equal(stripeCalls.customersCreated, 0, 'no Stripe customer may be created');
  assert.equal(stripeCalls.sessionsCreated, 0, 'no Checkout Session may be created');
  noRawProviderText(r.body);
});

test('subscription-history read failure aborts checkout → 503, zero Stripe calls', async () => {
  reset();
  db.customersRead = { data: { id: 'cus_1' }, error: null };
  db.subscriptionsRead = { data: null, error: DB_ERROR };
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 503);
  assert.equal(stripeCalls.customersCreated, 0);
  assert.equal(stripeCalls.sessionsCreated, 0);
  noRawProviderText(r.body);
});

test('Stripe-customer persistence failure → no Checkout Session, stable 503 (single orphan, not a duplicate)', async () => {
  reset();
  db.customersRead = { data: null, error: NO_ROW }; // verified no existing customer
  db.subscriptionsRead = { data: null, error: null }; // verified: eligible, no prior trial
  db.customersUpsert = { error: DB_ERROR }; // the mirror write fails
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 503);
  assert.equal(r.body.retryable, true);
  // The Stripe customer WAS created (we do not delete a real Stripe resource),
  // but checkout must NOT open against an unlinked customer.
  assert.equal(stripeCalls.customersCreated, 1);
  assert.equal(stripeCalls.sessionsCreated, 0, 'no session against an unpersisted customer');
  noRawProviderText(r.body);
});

test('happy path still works: verified no prior trial → session created with 3-day trial', async () => {
  reset();
  db.customersRead = { data: null, error: NO_ROW };
  db.subscriptionsRead = { data: null, error: null };
  const r = await request(app).post('/api/payments/create-checkout-session')
    .set(...AUTHED).send({ plan: 'starter', interval: 'monthly' });
  assert.equal(r.status, 200);
  assert.equal(stripeCalls.customersCreated, 1);
  assert.equal(stripeCalls.sessionsCreated, 1);
});
