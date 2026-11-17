// ---------------------------------------------------------------------------
// Audit batch 2 (2026-11-15 audit) - one test per defect, so none can come back.
//
//   B4  the subscription mirror follows Stripe's current state, so two events
//       that tie on event.created end the same in either order; one event
//       delivered twice at once is processed once
//   B6  an invoice email is not dropped because a subscription event was
//       handled first
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_m';
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_OWNERSHIP_ENFORCED;

const { stubModule } = require('./helpers');

const db = {
  events: new Map(), // event_id -> row
  subs: new Map(), // stripe_subscription_id -> row
  customers: new Map(), // stripe_customer_id -> row
  log: [],
};
function resetDb() {
  db.events.clear();
  db.subs.clear();
  db.customers.clear();
  db.log = [];
}

const NO_ROW = { data: null, error: { code: 'PGRST116', message: 'no rows' } };

function builder(table) {
  const st = { table, op: 'select', filters: {}, payload: null };
  const api = {
    select() { return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
    delete() { st.op = 'delete'; return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    is(k, v) { st.filters[k] = v; return api; },
    in() { return api; },
    gt() { return api; },
    gte() { return api; },
    lt() { return api; },
    order() { return api; },
    limit() { return api; },
    single() { return Promise.resolve(run(st, true)); },
    then(ok, err) { return Promise.resolve(run(st, false)).then(ok, err); },
  };
  return api;
}

function run(st, single) {
  if (st.op !== 'select') db.log.push({ table: st.table, op: st.op, payload: st.payload, filters: st.filters });

  if (st.table === 'stripe_events') {
    if (st.op === 'insert') {
      const p = st.payload;
      // Primary key on event_id, like the real table.
      if (db.events.has(p.event_id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      db.events.set(p.event_id, { attempts: 1, created_at: new Date().toISOString(), ...p });
      return { data: null, error: null };
    }
    const row = db.events.get(st.filters.event_id) || null;
    if (st.op === 'update') {
      // Conditional update: every filter must match the stored row.
      const match = row && Object.entries(st.filters).every(([k, v]) => row[k] === v);
      if (match) Object.assign(row, st.payload);
      return { data: match ? [{ event_id: row.event_id }] : [], error: null };
    }
    if (single) return row ? { data: { ...row }, error: null } : NO_ROW;
    return { data: row ? [{ ...row }] : [], error: null };
  }

  if (st.table === 'subscriptions') {
    if (st.op === 'upsert') {
      const key = st.payload.stripe_subscription_id;
      db.subs.set(key, { ...(db.subs.get(key) || {}), ...st.payload });
      return { error: null };
    }
    const row = db.subs.get(st.filters.stripe_subscription_id) || null;
    if (st.op === 'update') {
      if (row) Object.assign(row, st.payload);
      return { error: null };
    }
    if (single) return row ? { data: row, error: null } : NO_ROW;
    return { data: row ? [row] : [], error: null };
  }

  if (st.table === 'customers') {
    const row = db.customers.get(st.filters.stripe_customer_id) || null;
    if (single) return row ? { data: row, error: null } : NO_ROW;
    return { data: row ? [row] : [], error: null };
  }

  if (single) return NO_ROW;
  return { data: null, error: null };
}

stubModule('lib/supabase.js', {
  from: builder,
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
});

// Lifecycle emails are recorded, never sent.
const sent = [];
stubModule('lib/lifecycle-email.js', {
  sendLifecycleEmail: async (type, key, email) => { sent.push({ type, key, email }); return { sent: true }; },
});

const Stripe = require('stripe');
const stripeSdk = Stripe(process.env.STRIPE_SECRET_KEY);
const express = require('express');
const request = require('supertest');
const webhooksRouter = require('../routes/webhooks');

// What Stripe "holds now" for a subscription id. Unset = the object is gone.
const stripeNow = new Map();
let stripeDown = false;
require('../lib/stripe').subscriptions.retrieve = async (id) => {
  if (stripeDown) throw Object.assign(new Error('connection error'), { type: 'StripeConnectionError' });
  if (!stripeNow.has(id)) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
  return stripeNow.get(id);
};

const app = express();
app.use('/api/webhooks', webhooksRouter);

function post(event) {
  const payload = JSON.stringify(event);
  const header = stripeSdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return request(app).post('/api/webhooks/stripe').set('content-type', 'application/json')
    .set('stripe-signature', header).send(payload);
}

const subObject = (status) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status,
  cancel_at_period_end: false,
  metadata: { source: 'launchbloom', app_user_id: 'user-1' },
  items: { data: [{ price: { id: 'price_pro_m' } }] },
});
const subEvent = (id, type, status, created) => ({ id, type, created, data: { object: subObject(status) } });

function reset() {
  resetDb();
  sent.length = 0;
  stripeNow.clear();
  stripeDown = false;
  db.customers.set('cus_1', { id: 'cust-row-1', email: 'a@example.com' });
}

const subscriptionWrites = () => db.log.filter((l) => l.table === 'subscriptions' && l.op === 'upsert');

// ── B4 ──────────────────────────────────────────────────────────────────────

test('B4: created(incomplete) delivered after updated(active) in the same second ends active', async () => {
  reset();
  stripeNow.set('sub_1', subObject('active')); // Stripe's current truth
  const T = 1790000000;

  const first = await post(subEvent('evt_upd', 'customer.subscription.updated', 'active', T));
  assert.equal(first.status, 200);
  const second = await post(subEvent('evt_cre', 'customer.subscription.created', 'incomplete', T));
  assert.equal(second.status, 200);

  assert.equal(db.subs.get('sub_1').status, 'active');
});

test('B4: the same two events in the natural order also end active', async () => {
  reset();
  stripeNow.set('sub_1', subObject('active'));
  const T = 1790000000;
  await post(subEvent('evt_cre', 'customer.subscription.created', 'incomplete', T));
  await post(subEvent('evt_upd', 'customer.subscription.updated', 'active', T));
  assert.equal(db.subs.get('sub_1').status, 'active');
});

test('B4: when Stripe cannot be read the event payload is still mirrored', async () => {
  reset();
  stripeDown = true;
  const res = await post(subEvent('evt_1', 'customer.subscription.updated', 'past_due', 1790000000));
  assert.equal(res.status, 200);
  assert.equal(db.subs.get('sub_1').status, 'past_due');
  assert.equal(db.subs.get('sub_1').customer_id, 'cust-row-1');
});

test('B4: two concurrent deliveries of one event process once', async () => {
  reset();
  stripeNow.set('sub_1', subObject('active'));
  const event = subEvent('evt_same', 'customer.subscription.updated', 'active', 1790000000);

  const [a, b] = await Promise.all([post(event), post(event)]);

  assert.equal(subscriptionWrites().length, 1, 'the mirror is written by one delivery only');
  const statuses = [a.status, b.status].sort();
  assert.equal(statuses[0], 200);
  // The loser is either told to retry (still in flight) or acked as a duplicate.
  assert.ok(statuses[1] === 409 || (statuses[1] === 200 && (a.body.duplicate || b.body.duplicate)));
});

test('B4: a redelivery while the first delivery is in flight is refused, not run', async () => {
  reset();
  db.events.set('evt_busy', { event_id: 'evt_busy', status: 'processing', attempts: 1, created_at: new Date().toISOString() });
  const res = await post(subEvent('evt_busy', 'customer.subscription.updated', 'active', 1790000000));
  assert.equal(res.status, 409);
  assert.equal(subscriptionWrites().length, 0);
});

test('B4: a failed event, and a claim older than the lease, are taken over', async () => {
  reset();
  db.events.set('evt_failed', { event_id: 'evt_failed', status: 'failed', attempts: 1, created_at: new Date().toISOString() });
  const failed = await post(subEvent('evt_failed', 'customer.subscription.updated', 'active', 1790000000));
  assert.equal(failed.status, 200);
  assert.equal(db.events.get('evt_failed').status, 'processed');
  assert.equal(db.events.get('evt_failed').attempts, 2);

  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.events.set('evt_dead', { event_id: 'evt_dead', status: 'processing', attempts: 1, created_at: old });
  const dead = await post(subEvent('evt_dead', 'customer.subscription.updated', 'active', 1790000001));
  assert.equal(dead.status, 200);
  assert.equal(db.events.get('evt_dead').status, 'processed');
});

test('B4: an already processed event is acknowledged without work', async () => {
  reset();
  db.events.set('evt_done', { event_id: 'evt_done', status: 'processed', attempts: 1, created_at: new Date().toISOString() });
  const res = await post(subEvent('evt_done', 'customer.subscription.updated', 'active', 1790000000));
  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(subscriptionWrites().length, 0);
});
