// ---------------------------------------------------------------------------
// Invoice webhooks on the dahlia API shape (Stripe 2026-04-22).
//
// dahlia removed `invoice.subscription` and `invoice.lines.data[].price`; the
// subscription reference lives under `invoice.parent.subscription_details`.
// The invoice handlers used to bail on the missing top-level field, so no
// payment-failed email, receipt or recovery email was ever sent in production
// (docs/BILLING_FINDINGS_2026-08-02.md). These tests pin the fixed behaviour:
// emails go out for our own subscriptions, and invoice events still never
// touch the subscription mirror.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

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
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'insert') {
        if (events.has(st.payload.event_id)) return { error: { code: '23505', message: 'duplicate' } };
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
      const row = subs.get(st.filters.stripe_subscription_id);
      if (st.op === 'select') {
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'update' || st.op === 'upsert') {
        throw new Error('invoice events must never write the subscriptions mirror');
      }
    }
    if (single) return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
  }

  return { from: builder, _subs: subs, _events: events };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

const sent = [];
stubModule('lib/lifecycle-email.js', {
  sendLifecycleEmail: async (type, dedupeId, to, params) => { sent.push({ type, dedupeId, to, params }); return 'sent'; },
});

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

const T = 1780000000;
const PERIOD_END = T + 30 * 86400;

// A dahlia invoice: no top-level `subscription`, no line `price`.
const dahliaInvoice = (id, subId, extra = {}) => ({
  id: `in_${id}`,
  customer: 'cus_d',
  customer_email: 'buyer@example.com',
  total: 2499,
  currency: 'usd',
  attempt_count: 1,
  billing_reason: 'subscription_cycle',
  period_end: T, // previous period on a cycle invoice - must not be used for "active through"
  parent: { type: 'subscription_details', subscription_details: { subscription: subId, metadata: {} } },
  lines: { data: [{ period: { start: T, end: PERIOD_END }, pricing: { price_details: { price: 'price_unknown' } } }] },
  ...extra,
});

function seedSub(subId, status) {
  db._subs.set(subId, { stripe_subscription_id: subId, status, stripe_event_at: new Date((T - 100) * 1000).toISOString(), metadata: { source: 'launchbloom' } });
}

test('dahlia invoice.payment_failed sends the payment-failed email and leaves status alone', async () => {
  seedSub('sub_d1', 'active');
  const r = await post({ id: 'evt_d1', type: 'invoice.payment_failed', created: T, data: { object: dahliaInvoice('d1', 'sub_d1') } });

  assert.equal(r.status, 200);
  const mail = sent.find((m) => m.dedupeId === 'in_d1');
  assert.ok(mail, 'payment_failed must be sent for a dahlia invoice');
  assert.equal(mail.type, 'payment_failed');
  assert.equal(mail.to, 'buyer@example.com');
  assert.equal(db._subs.get('sub_d1').status, 'active', 'status comes from subscription.updated, not the invoice');
});

test('dahlia invoice.paid sends a receipt dated to the line period, not the previous period', async () => {
  seedSub('sub_d2', 'active');
  const r = await post({ id: 'evt_d2', type: 'invoice.paid', created: T, data: { object: dahliaInvoice('d2', 'sub_d2') } });

  assert.equal(r.status, 200);
  const mail = sent.find((m) => m.dedupeId === 'in_d2');
  assert.ok(mail, 'a receipt must be sent for a dahlia invoice');
  assert.equal(mail.type, 'payment_succeeded');
  assert.equal(mail.params.periodEnd, new Date(PERIOD_END * 1000).toISOString());
  assert.equal(mail.params.amount, '$24.99');
});

test('a paid invoice that needed a retry is a recovery even if the mirror is already active', async () => {
  seedSub('sub_d3', 'active');
  await post({ id: 'evt_d3', type: 'invoice.paid', created: T, data: { object: dahliaInvoice('d3', 'sub_d3', { attempt_count: 2 }) } });

  assert.equal(sent.find((m) => m.dedupeId === 'in_d3').type, 'payment_recovered');
});

test('a $0 trial invoice sends nothing', async () => {
  seedSub('sub_d4', 'trialing');
  await post({ id: 'evt_d4', type: 'invoice.paid', created: T, data: { object: dahliaInvoice('d4', 'sub_d4', { total: 0, billing_reason: 'subscription_create' }) } });

  assert.ok(!sent.find((m) => m.dedupeId === 'in_d4'));
});

test('an invoice for a subscription that is not ours sends nothing', async () => {
  // No local mirror and no configured price/stamp: classified foreign, dropped.
  await post({ id: 'evt_d5', type: 'invoice.payment_failed', created: T, data: { object: dahliaInvoice('d5', 'sub_mellowa') } });

  assert.ok(!sent.find((m) => m.dedupeId === 'in_d5'), 'never email about another product\'s subscription');
});
