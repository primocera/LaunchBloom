// v12 SC-V12-04 — the billing lifecycle transitions the state machine must get
// right: cancel-at-period-end, reactivate, refund, dispute, and idempotent
// redelivery of every relevant event. Complements webhook-ordering.test.js
// (out-of-order safety) and webhook-isolation.test.js (foreign events).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_scalvya_pro';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

function makeSupabase() {
  const events = new Map();
  const subs = new Map();
  const writes = [];

  function builder(table) {
    const st = { table, op: 'select', filters: {}, payload: null };
    const api = {
      select() { return api; },
      insert(p) { st.op = 'insert'; st.payload = p; return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      single() { return Promise.resolve(resolve(st, true)); },
      then(res, rej) { return Promise.resolve(resolve(st, false)).then(res, rej); },
    };
    return api;
  }

  function resolve(st, single) {
    if (st.op !== 'select' && st.table !== 'stripe_events') {
      writes.push({ table: st.table, op: st.op, payload: st.payload });
    }
    if (st.table === 'stripe_events') {
      if (st.op === 'select') {
        const row = events.get(st.filters.event_id);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'insert') {
        if (events.has(st.payload.event_id)) return { error: { code: '23505' } };
        events.set(st.payload.event_id, { attempts: 1, ...st.payload });
        return { error: null };
      }
      if (st.op === 'update') {
        const row = events.get(st.filters.event_id);
        if (row) Object.assign(row, st.payload);
        return { error: null };
      }
    }
    if (st.table === 'subscriptions') {
      const id = st.filters.stripe_subscription_id;
      if (st.op === 'select') {
        const row = subs.get(id);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'upsert') {
        const key = st.payload.stripe_subscription_id;
        subs.set(key, { ...(subs.get(key) || {}), ...st.payload });
        return { error: null };
      }
      if (st.op === 'update') {
        const row = subs.get(id);
        if (row) Object.assign(row, st.payload);
        return { error: null };
      }
    }
    if (single) return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
  }

  return { from: builder, _events: events, _subs: subs, _writes: writes,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) } };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

const sentEmails = [];
stubModule('lib/lifecycle-email.js', {
  sendLifecycleEmail: async (kind, key, email) => { sentEmails.push({ kind, key, email }); },
});
// A known customer email so lifecycle lookups resolve (the fake customers table
// returns null, so we stub the email resolver via a customers row instead).
stubModule('lib/analytics.js', { track: () => {} });

const Stripe = require('stripe');
const stripeSdk = Stripe(process.env.STRIPE_SECRET_KEY);
const express = require('express');
const request = require('supertest');
const webhooksRouter = require('../routes/webhooks');

const app = express();
app.use('/api/webhooks', webhooksRouter);

function post(event) {
  const payload = JSON.stringify(event);
  const header = stripeSdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return request(app).post('/api/webhooks/stripe').set('content-type', 'application/json')
    .set('stripe-signature', header).send(payload);
}

const T0 = 1700000000;
const T1 = 1700003600;
const T2 = 1700007200;
const iso = (u) => new Date(u * 1000).toISOString();

const sub = (id, subId, created, overrides = {}, previous = null) => ({
  id, type: 'customer.subscription.updated', created,
  data: {
    object: {
      id: subId, customer: 'cus_1', status: 'active',
      items: { data: [{ price: { id: 'price_scalvya_pro' } }] },
      cancel_at_period_end: false, metadata: { app_user_id: 'u_1' },
      current_period_end: created + 2592000, ...overrides,
    },
    ...(previous ? { previous_attributes: previous } : {}),
  },
});

function seedSub(subId, row) { db._subs.set(subId, { stripe_subscription_id: subId, ...row }); }

// ── cancel at period end, then reactivate ──────────────────────────────────

test('cancel at period end keeps access and records the schedule once', async () => {
  seedSub('sub_cancel', { status: 'active', stripe_event_at: iso(T0) });

  const r = await post(sub('evt_cancel', 'sub_cancel', T1,
    { cancel_at_period_end: true }, { cancel_at_period_end: false }));

  assert.equal(r.status, 200);
  const row = db._subs.get('sub_cancel');
  assert.equal(row.status, 'active', 'access continues until the period ends');
  assert.equal(row.cancel_at_period_end, true, 'the scheduled cancellation is recorded');
});

test('reactivating clears the scheduled cancellation', async () => {
  seedSub('sub_react', { status: 'active', cancel_at_period_end: true, stripe_event_at: iso(T0) });

  const r = await post(sub('evt_react', 'sub_react', T1,
    { cancel_at_period_end: false }, { cancel_at_period_end: true }));

  assert.equal(r.status, 200);
  assert.equal(db._subs.get('sub_react').cancel_at_period_end, false, 'reactivation must clear the schedule');
  assert.equal(db._subs.get('sub_react').status, 'active');
});

// ── refund and dispute do NOT mutate entitlement ───────────────────────────

test('a refund of our charge is acknowledged and changes no subscription state', async () => {
  db._writes.length = 0;
  const r = await post({
    id: 'evt_refund', type: 'charge.refunded', created: T1,
    data: { object: { id: 'ch_1', amount_refunded: 2499, metadata: { app_user_id: 'u_1' } } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(db._writes, [], 'a refund must not itself change entitlement — a cancellation event does');
});

test('a dispute on our charge is acknowledged and changes no subscription state', async () => {
  db._writes.length = 0;
  const r = await post({
    id: 'evt_dispute', type: 'charge.dispute.created', created: T1,
    data: { object: { id: 'dp_1', charge: 'ch_1', metadata: { app_user_id: 'u_1' } } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(db._writes, [], 'a dispute must not itself change entitlement');
});

test('a FOREIGN refund/dispute is acked and dropped without touching our tables', async () => {
  db._writes.length = 0;
  for (const [id, type, object] of [
    ['evt_frefund', 'charge.refunded', { id: 'ch_m', metadata: { mellowa: '1' } }],
    ['evt_fdispute', 'charge.dispute.created', { id: 'dp_m', charge: 'ch_m', metadata: {} }],
  ]) {
    const r = await post({ id, type, created: T1, data: { object } });
    assert.equal(r.status, 200);
  }
  assert.deepEqual(db._writes, [], 'foreign refund/dispute must not write to our tables');
});

// ── idempotent redelivery of every relevant event ──────────────────────────

test('redelivering any event is acknowledged as a duplicate and does not reprocess', async () => {
  const events = [
    sub('evt_re_updated', 'sub_re', T2, { status: 'active' }),
    { id: 'evt_re_paid', type: 'invoice.paid', created: T2,
      data: { object: { id: 'in_re', subscription: 'sub_re', customer: 'cus_1', total: 2499, currency: 'usd', lines: { data: [] } } } },
    { id: 'evt_re_failed', type: 'invoice.payment_failed', created: T2,
      data: { object: { id: 'in_ref', subscription: 'sub_re', customer: 'cus_1' } } },
    { id: 'evt_re_refund', type: 'charge.refunded', created: T2,
      data: { object: { id: 'ch_re', metadata: { app_user_id: 'u_1' } } } },
  ];

  for (const e of events) {
    seedSub('sub_re', { status: 'active', stripe_event_at: iso(T0) });
    const first = await post(e);
    assert.equal(first.status, 200, `${e.id} first delivery should be handled`);
    assert.ok(!first.body.duplicate, `${e.id} first delivery is not a duplicate`);

    const second = await post(e);
    assert.equal(second.body.duplicate, true, `${e.id} redelivery must be a no-op duplicate`);
    assert.equal(db._events.get(e.id).status, 'processed', `${e.id} stays processed exactly once`);
  }
});
