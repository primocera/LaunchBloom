// ---------------------------------------------------------------------------
// SC-V10-00 — entitlement safety under delayed, duplicate and out-of-order
// Stripe deliveries.
//
// Stripe guarantees neither ordering nor exactly-once delivery. The failure
// this suite exists to prevent is silent and expensive: a late
// invoice.payment_failed landing AFTER the recovery invoice.paid, flipping a
// recovered subscription back to past_due and revoking entitlement the
// customer has already paid for.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

// Stateful fake with a real stripe_events ledger AND a real subscriptions
// table, so ordering guards are exercised rather than assumed.
function makeSupabase() {
  const events = new Map();
  const subs = new Map();

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

    if (st.table === 'subscriptions') {
      const id = st.filters.stripe_subscription_id;
      if (st.op === 'select') {
        const row = subs.get(id);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'update') {
        const row = subs.get(id);
        if (row) Object.assign(row, st.payload);
        return { error: null };
      }
      if (st.op === 'upsert') {
        const p = st.payload;
        const key = p.stripe_subscription_id;
        subs.set(key, { ...(subs.get(key) || {}), ...p });
        return { error: null };
      }
    }

    // customers: unknown → lifecycle email lookups return null (no-op).
    if (single) return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
  }

  return {
    from: builder,
    _events: events,
    _subs: subs,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

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

// Fixed clock: T_OLD is strictly before T_NEW.
const T_OLD = 1700000000;
const T_NEW = 1700003600;
const iso = (unix) => new Date(unix * 1000).toISOString();

const paymentFailed = (id, subId, created) => ({
  id,
  type: 'invoice.payment_failed',
  created,
  data: { object: { id: `in_${id}`, subscription: subId, customer: 'cus_1' } },
});

const invoicePaid = (id, subId, created) => ({
  id,
  type: 'invoice.paid',
  created,
  data: {
    object: {
      id: `in_${id}`, subscription: subId, customer: 'cus_1', total: 2499, currency: 'usd',
      period_start: created, period_end: created + 2592000, lines: { data: [] },
    },
  },
});

const subUpdated = (id, subId, created, status) => ({
  id,
  type: 'customer.subscription.updated',
  created,
  data: {
    object: {
      id: subId, customer: 'cus_1', status,
      items: { data: [{ price: { id: 'price_x' } }] },
      // LB-V17-02: `source` is our EXACT webhook-isolation stamp (see
      // webhook-isolation.test.js). Every subscription our checkout creates
      // carries it; a bare app_user_id key is no longer accepted as proof.
      cancel_at_period_end: false, metadata: { source: 'launchbloom', app_user_id: 'u_1' },
    },
  },
});

function seedSub(subId, row) {
  db._subs.set(subId, { stripe_subscription_id: subId, ...row });
}

// ── the regression this slice fixes ────────────────────────────────────────

test('a late payment_failed does NOT revoke entitlement after recovery', async () => {
  // Recovery already recorded at the newer timestamp.
  seedSub('sub_late', { status: 'active', stripe_event_at: iso(T_NEW) });

  // The failure event was generated earlier but is delivered now.
  const r = await post(paymentFailed('evt_late_fail', 'sub_late', T_OLD));

  assert.equal(r.status, 200, 'stale events are acked, not retried forever');
  assert.equal(db._subs.get('sub_late').status, 'active', 'entitlement must survive an out-of-order failure');
  assert.equal(db._subs.get('sub_late').stripe_event_at, iso(T_NEW), 'the newer event timestamp is preserved');
});

test('an in-order payment_failed still moves the subscription to past_due', async () => {
  seedSub('sub_inorder', { status: 'active', stripe_event_at: iso(T_OLD) });

  const r = await post(paymentFailed('evt_inorder_fail', 'sub_inorder', T_NEW));

  assert.equal(r.status, 200);
  assert.equal(db._subs.get('sub_inorder').status, 'past_due');
  assert.equal(db._subs.get('sub_inorder').stripe_event_at, iso(T_NEW), 'payment_failed must stamp its event time');
});

test('recovery after a failure restores active entitlement', async () => {
  seedSub('sub_recover', { status: 'active', stripe_event_at: iso(T_OLD - 1) });

  await post(paymentFailed('evt_rec_fail', 'sub_recover', T_OLD));
  assert.equal(db._subs.get('sub_recover').status, 'past_due');

  await post(invoicePaid('evt_rec_paid', 'sub_recover', T_NEW));
  assert.equal(db._subs.get('sub_recover').status, 'active');
  assert.equal(db._subs.get('sub_recover').stripe_event_at, iso(T_NEW));
});

// ── duplicate delivery ─────────────────────────────────────────────────────

test('a redelivered payment_failed is acked without reprocessing', async () => {
  seedSub('sub_dup', { status: 'active', stripe_event_at: iso(T_OLD - 1) });

  await post(paymentFailed('evt_dup_fail', 'sub_dup', T_OLD));
  // Recovery lands between the original delivery and Stripe's retry.
  await post(invoicePaid('evt_dup_paid', 'sub_dup', T_NEW));
  assert.equal(db._subs.get('sub_dup').status, 'active');

  const r = await post(paymentFailed('evt_dup_fail', 'sub_dup', T_OLD));

  assert.equal(r.body.duplicate, true, 'the ledger short-circuits the redelivery');
  assert.equal(db._subs.get('sub_dup').status, 'active', 'a retry cannot undo the recovery');
});

// ── out-of-order subscription state ────────────────────────────────────────

test('a stale subscription.updated does not overwrite a newer status', async () => {
  seedSub('sub_ooo', { status: 'canceled', stripe_event_at: iso(T_NEW) });

  await post(subUpdated('evt_ooo', 'sub_ooo', T_OLD, 'active'));

  assert.equal(db._subs.get('sub_ooo').status, 'canceled', 'an older event must not resurrect a canceled subscription');
});

test('an unseeded subscription is written by its first event', async () => {
  const r = await post(subUpdated('evt_first', 'sub_first', T_NEW, 'trialing'));

  assert.equal(r.status, 200);
  assert.equal(db._subs.get('sub_first').status, 'trialing');
  assert.equal(db._subs.get('sub_first').stripe_event_at, iso(T_NEW));
});

// ── ledger durability ──────────────────────────────────────────────────────

test('every processed event is recorded exactly once in the ledger', async () => {
  const ids = ['evt_late_fail', 'evt_inorder_fail', 'evt_rec_fail', 'evt_rec_paid', 'evt_dup_fail', 'evt_ooo'];
  for (const id of ids) {
    assert.equal(db._events.get(id).status, 'processed', `${id} should be durably processed`);
  }
});
