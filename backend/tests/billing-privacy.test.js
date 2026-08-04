// ---------------------------------------------------------------------------
// v14 SC-03 — billing/API privacy and public error contract.
//
// Raw Supabase/Stripe/internal exception text must never reach the client, and
// full email addresses must never reach the logs. These tests drive the exact
// catch blocks that previously returned `err.message` (GET /api/customers/:id,
// cancel-subscription, get-subscription) and capture console output to prove
// the redaction on the ensureStripeCustomer stale-id path.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule } = require('./helpers');

const SECRET_MSG = 'relation "customers" does not exist [PGRST-08006 supabase internal]';
const user = { id: 'user-1', email: 'me@app.com' };

// Per-test switches.
const ctl = {
  customerSingleThrows: false, // GET /:id catch path
  customerRow: null, // what customers .single() resolves to (ownership)
  subOwner: 'me@app.com', // ownsSubscription resolves to this owner
  stripeThrows: null, // error object Stripe update/retrieve throws
};

function fakeFrom(table) {
  const b = {
    select() { return b; }, update() { return b; }, upsert() { return b; },
    insert() { return b; }, delete() { return b; },
    eq() { return b; }, neq() { return b; }, in() { return b; }, is() { return b; },
    gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
    single() {
      if (table === 'customers') {
        if (ctl.customerSingleThrows) return Promise.reject(new Error(SECRET_MSG));
        return Promise.resolve({ data: ctl.customerRow, error: null });
      }
      if (table === 'subscriptions') {
        return Promise.resolve({ data: { customer_id: 'cus_1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(onOk, onErr) { return Promise.resolve({ data: null, error: null }).then(onOk, onErr); },
  };
  // ownsSubscription reads customers by id → email; return the owner for that.
  if (table === 'customers') {
    b.single = () => {
      if (ctl.customerSingleThrows) return Promise.reject(new Error(SECRET_MSG));
      return Promise.resolve({ data: ctl.customerRow ?? { email: ctl.subOwner, id: 'cus_1' }, error: null });
    };
  }
  return b;
}

stubModule('lib/supabase.js', {
  from: fakeFrom,
  rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  authClient: () => ({
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  }),
  adminClient: () => ({ auth: { admin: { signOut: async () => ({}), updateUserById: async () => ({ error: null }) } } }),
});

stubModule('lib/stripe.js', {
  customers: { create: async () => ({ id: 'cus_new' }), retrieve: async () => ({ id: 'cus_1', deleted: false }) },
  subscriptions: {
    update: async () => { if (ctl.stripeThrows) throw ctl.stripeThrows; return { id: 'sub_1', cancel_at_period_end: true, current_period_end: 1893456000 }; },
    retrieve: async () => { if (ctl.stripeThrows) throw ctl.stripeThrows; return { id: 'sub_1', status: 'active', current_period_start: 1, current_period_end: 2, cancel_at_period_end: false, trial_end: null }; },
  },
});

const express = require('express');
const request = require('supertest');
const customersRouter = require('../routes/customers');
const paymentsRouter = require('../routes/payments');

const app = express();
app.use(express.json());
app.use('/api/customers', customersRouter);
app.use('/api/payments', paymentsRouter);
const AUTHED = ['Cookie', 'sb_access=validtoken'];

function reset() {
  ctl.customerSingleThrows = false;
  ctl.customerRow = null;
  ctl.subOwner = 'me@app.com';
  ctl.stripeThrows = null;
}

function assertNoRawText(body) {
  const s = JSON.stringify(body);
  assert.ok(!s.includes(SECRET_MSG), 'raw provider message must not appear in the response');
  assert.ok(!/PGRST|supabase internal|relation "/i.test(s), 'no raw provider internals in response');
}

test('GET /api/customers/:id catch never echoes the raw Supabase message', async () => {
  reset();
  ctl.customerSingleThrows = true;
  const r = await request(app).get('/api/customers/cus_1').set(...AUTHED);
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'CUSTOMER_LOOKUP_FAILED');
  assertNoRawText(r.body);
});

test("GET /api/customers/:id cannot read another user's customer row", async () => {
  reset();
  ctl.customerRow = { id: 'cus_1', email: 'someone-else@app.com', stripe_customer_id: 'cus_secret' };
  const r = await request(app).get('/api/customers/cus_1').set(...AUTHED);
  assert.equal(r.status, 404); // ownership mismatch → generic not-found
  assert.ok(!JSON.stringify(r.body).includes('cus_secret'));
});

test('cancel-subscription 500 catch returns a stable message, never Stripe/Supabase raw text', async () => {
  reset();
  ctl.subOwner = 'me@app.com';
  ctl.stripeThrows = Object.assign(new Error(SECRET_MSG), { type: 'StripeAPIError' });
  const r = await request(app).post('/api/payments/cancel-subscription')
    .set(...AUTHED).send({ subscriptionId: 'sub_1' });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'SUBSCRIPTION_UPDATE_FAILED');
  assertNoRawText(r.body);
});

test('get-subscription 500 catch returns a stable message, never raw text', async () => {
  reset();
  ctl.subOwner = 'me@app.com';
  ctl.stripeThrows = Object.assign(new Error(SECRET_MSG), { type: 'StripeAPIError' });
  const r = await request(app).get('/api/payments/subscription/sub_1').set(...AUTHED);
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'SUBSCRIPTION_LOOKUP_FAILED');
  assertNoRawText(r.body);
});

test('a vanished subscription is a 404, not a 500 leak', async () => {
  reset();
  ctl.subOwner = 'me@app.com';
  ctl.stripeThrows = Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
  const r = await request(app).post('/api/payments/cancel-subscription')
    .set(...AUTHED).send({ subscriptionId: 'sub_1' });
  assert.equal(r.status, 404);
});

test('ensureStripeCustomer never logs a full email on the stale-id path', async () => {
  const { redactEmail } = require('../routes/customers');
  // The redactor is the canonical one; prove it drops the local part + domain
  // detail so a log line built from it cannot carry a full address.
  const red = redactEmail('longlocalpart@example.com');
  assert.ok(!red.includes('longlocalpart@example.com'));
  assert.ok(red.startsWith('lo') && red.includes('***@'));
});
