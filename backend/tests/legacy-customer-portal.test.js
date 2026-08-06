// ---------------------------------------------------------------------------
// v13 SC-P0-05 — security regression coverage for the removed legacy billing
// surface and the one canonical portal endpoint.
//
// Replaces the (nonexistent) coverage of:
//   POST /api/customers                     — client-supplied billing email
//   GET  /api/customers/:id/portal?returnUrl — client-controlled open redirect
//
// The rules being locked down:
//   1. No route mints a customer for a client-supplied email.
//   2. No route forwards arbitrary metadata to Stripe.
//   3. The portal return URL comes from server configuration only; external,
//      protocol-relative, encoded, mixed-case, localhost, javascript: and
//      data: values are rejected and can never reach Stripe.
//   4. Unauthenticated and cross-account requests fail without leaking whether
//      another account exists.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';

const { stubModule, makeFakeSupabase } = require('./helpers');

const state = { user: { id: 'user-1', email: 'me@app.com' } };

const fakeSupabase = makeFakeSupabase({
  workspaces: { data: { id: 'ws1', user_id: 'user-1' }, error: null },
  customers: { data: { id: 'cust-1', email: 'me@app.com', stripe_customer_id: 'cus_1' }, error: null },
  subscriptions: { data: [], error: null },
});
fakeSupabase.authClient = () => ({
  auth: {
    getUser: async () => (state.user
      ? { data: { user: state.user }, error: null }
      : { data: { user: null }, error: { message: 'no' } }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
  },
});
stubModule('lib/supabase.js', fakeSupabase);

let lastPortal = null;
let createdStripeCustomers = 0;
stubModule('lib/stripe.js', {
  customers: {
    create: async () => { createdStripeCustomers += 1; return { id: 'cus_new' }; },
    // XAPP-95-01: the portal/delete now verify ownership before any Stripe call.
    // The stored cus_1 is a normal Scalvya customer — created by us with our
    // ownership metadata (source + this user's app_user_id).
    retrieve: async (id) => ({ id, deleted: false, metadata: { source: 'launchbloom', app_user_id: 'user-1' } }),
    del: async () => ({}),
  },
  subscriptions: { list: async () => ({ data: [] }), cancel: async () => ({}) },
  billingPortal: {
    sessions: {
      create: async (args) => { lastPortal = args; return { url: 'https://billing.stripe.com/session' }; },
    },
  },
});

const express = require('express');
const request = require('supertest');
const customerRouter = require('../routes/customers');
const accountRouter = require('../routes/account');
const { configuredAppUrl } = require('../lib/launch-config');

const app = express();
app.use(express.json());
app.use('/api/customers', customerRouter);
app.use(accountRouter);

const AUTHED = ['Cookie', 'sb_access=tok'];

// --- 1. The legacy routes are gone --------------------------------------

test('POST /api/customers no longer exists — no client-supplied billing email', async () => {
  createdStripeCustomers = 0;
  const r = await request(app)
    .post('/api/customers')
    .set(...AUTHED)
    .send({ email: 'victim@other.com', name: 'x', metadata: { admin: 'true' } });
  assert.equal(r.status, 404);
  // and crucially: nothing was created in Stripe for the attacker's email
  assert.equal(createdStripeCustomers, 0);
});

test('GET /api/customers/:id/portal no longer exists — no client return URL', async () => {
  lastPortal = null;
  for (const returnUrl of [
    'https://evil.example.com/steal',
    '//evil.example.com',
    'https%3A%2F%2Fevil.example.com',
    'HtTpS://EVIL.example.com',
    'http://localhost:3000/app',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    const r = await request(app)
      .get('/api/customers/cust-1/portal')
      .query({ returnUrl })
      .set(...AUTHED);
    assert.equal(r.status, 404, `expected 404 for ${returnUrl}`);
  }
  assert.equal(lastPortal, null, 'no Stripe portal session may be opened by the legacy route');
});

// --- 2. The canonical portal endpoint -----------------------------------

test('canonical portal returns to the configured application URL', async () => {
  lastPortal = null;
  const r = await request(app).post('/api/account/billing-portal').set(...AUTHED).send({});
  assert.equal(r.status, 200);
  assert.equal(lastPortal.customer, 'cus_1');
  assert.equal(lastPortal.return_url, 'https://app.example.com/app/account');
});

test('canonical portal ignores any client-supplied return URL', async () => {
  for (const returnUrl of [
    'https://evil.example.com/steal',
    '//evil.example.com',
    'javascript:alert(1)',
    'http://localhost:3000/app',
  ]) {
    lastPortal = null;
    const r = await request(app)
      .post('/api/account/billing-portal')
      .query({ returnUrl, return_url: returnUrl })
      .set(...AUTHED)
      .send({ returnUrl, return_url: returnUrl });
    assert.equal(r.status, 200);
    assert.equal(lastPortal.return_url, 'https://app.example.com/app/account');
  }
});

test('canonical portal requires auth', async () => {
  state.user = null;
  lastPortal = null;
  const r = await request(app).post('/api/account/billing-portal').send({});
  assert.equal(r.status, 401);
  assert.equal(lastPortal, null);
  state.user = { id: 'user-1', email: 'me@app.com' };
});

test('portal identity is the session, not a path/body customer id', async () => {
  lastPortal = null;
  await request(app).post('/api/account/billing-portal').set(...AUTHED)
    .send({ customerId: 'cus_someone_else', email: 'victim@other.com' });
  // The route only ever filters customers by req.userEmail.
  const filters = fakeSupabase.lastFilters ? fakeSupabase.lastFilters('customers') : null;
  assert.equal(lastPortal.customer, 'cus_1');
  if (filters) assert.ok(!JSON.stringify(filters).includes('victim@other.com'));
});

// --- 3. The server-config URL builder itself ----------------------------

test('configuredAppUrl builds only from the configured origin plus our path', () => {
  process.env.PUBLIC_URL = 'https://app.example.com/';
  assert.equal(configuredAppUrl('/app/account'), 'https://app.example.com/app/account');
  process.env.PUBLIC_URL = 'https://app.example.com';
});

test('configuredAppUrl rejects unsafe configured values', () => {
  const original = process.env.PUBLIC_URL;
  const bad = [
    '//evil.example.com',               // protocol-relative
    'javascript:alert(1)',                // scheme abuse
    'data:text/html,x',                   // scheme abuse
    'ftp://app.example.com',              // wrong scheme
    'https://user:pw@app.example.com',    // embedded credentials
    'https://app.example.com/?next=https://evil.example.com', // redirect carrier
    'https://app.example.com/#@evil.example.com',             // fragment carrier
    'not a url',
  ];
  for (const value of bad) {
    process.env.PUBLIC_URL = value;
    assert.throws(() => configuredAppUrl('/app/account'), /PUBLIC_URL/, `accepted: ${value}`);
  }
  process.env.PUBLIC_URL = original;
});

test('configuredAppUrl falls back to the configured brand URL, still validated', () => {
  const original = process.env.PUBLIC_URL;
  delete process.env.PUBLIC_URL;
  const url = configuredAppUrl('/app/account');
  assert.match(url, /^https:\/\/[^/]+\/app\/account$/);
  process.env.PUBLIC_URL = original;
});

test('configuredAppUrl rejects non-internal paths', () => {
  for (const p of ['//evil.example.com', 'https://evil.example.com', '/app/../../x', '/app%2f..', '/app\\evil']) {
    assert.throws(() => configuredAppUrl(p), /Invalid application path/, `accepted path: ${p}`);
  }
});

test('configuredAppUrl rejects localhost and placeholder hosts in production', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.PUBLIC_URL;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.NODE_ENV = 'production';
  process.env.STRIPE_SECRET_KEY = 'sk_live_x';
  for (const value of ['http://localhost:3000', 'https://localhost', 'https://example.com', 'https://yourdomain.com']) {
    process.env.PUBLIC_URL = value;
    assert.throws(() => configuredAppUrl('/app/account'), /PUBLIC_URL/, `accepted in production: ${value}`);
  }
  process.env.NODE_ENV = originalEnv;
  process.env.PUBLIC_URL = originalUrl;
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});

test('configuredAppUrl allows http://localhost outside production (dev ergonomics)', () => {
  const original = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = 'http://localhost:3000';
  assert.equal(configuredAppUrl('/app/account'), 'http://localhost:3000/app/account');
  process.env.PUBLIC_URL = original;
});
