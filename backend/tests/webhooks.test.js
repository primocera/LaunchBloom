const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

// Stateful fake: a real stripe_events ledger so idempotency can be exercised.
// Other tables are permissive no-ops (subscriptions upsert/update succeed).
function makeStatefulSupabase() {
  const events = new Map();
  const flags = { failSelect: false };

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
    if (st.table === 'stripe_events') {
      if (st.op === 'select') {
        if (flags.failSelect) return { data: null, error: { code: 'XXNET', message: 'db down' } };
        const row = events.get(st.filters.event_id);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'insert') {
        const p = st.payload;
        if (events.has(p.event_id)) return { error: { code: '23505', message: 'duplicate' } };
        events.set(p.event_id, { attempts: 1, ...p });
        return { error: null };
      }
      if (st.op === 'update') {
        const row = events.get(st.filters.event_id);
        if (row) Object.assign(row, st.payload);
        return { error: null };
      }
    }
    // customers/subscriptions: nothing found, writes succeed.
    if (single) return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
  }

  return {
    from: builder,
    _events: events,
    _flags: flags,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  };
}

const fakeSupabase = makeStatefulSupabase();
stubModule('lib/supabase.js', fakeSupabase);

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
  return request(app).post('/api/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', header).send(payload);
}

const subEvent = (id) => ({
  id,
  type: 'customer.subscription.updated',
  created: 1700000000,
  data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_x' } }] }, cancel_at_period_end: false, metadata: {} } },
});

test('rejects missing signature', async () => {
  const r = await request(app).post('/api/webhooks/stripe').set('content-type', 'application/json').send('{}');
  assert.equal(r.status, 400);
});

test('rejects an invalid signature', async () => {
  const r = await request(app).post('/api/webhooks/stripe').set('content-type', 'application/json')
    .set('stripe-signature', 't=1,v1=deadbeef').send(JSON.stringify({ id: 'evt_x', type: 'invoice.paid' }));
  assert.equal(r.status, 400);
});

test('a new event is processed and recorded', async () => {
  const r = await post(subEvent('evt_new_1'));
  assert.equal(r.status, 200);
  assert.equal(r.body.received, true);
  assert.equal(fakeSupabase._events.get('evt_new_1').status, 'processed');
});

test('a redelivered event is acked without reprocessing (idempotent)', async () => {
  await post(subEvent('evt_dup_1'));
  const before = { ...fakeSupabase._events.get('evt_dup_1') };
  const r = await post(subEvent('evt_dup_1'));
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  // attempts not bumped: we returned before re-claiming.
  assert.equal(fakeSupabase._events.get('evt_dup_1').attempts, before.attempts);
});

test('a transient DB failure returns 5xx so Stripe retries', async () => {
  fakeSupabase._flags.failSelect = true;
  const r = await post(subEvent('evt_fail_1'));
  assert.equal(r.status, 500);
  fakeSupabase._flags.failSelect = false;
});

test('an unhandled event type is still acked 200', async () => {
  const r = await post({ id: 'evt_unh_1', type: 'some.unhandled.event', created: 1700000000, data: { object: {} } });
  assert.equal(r.status, 200);
});
