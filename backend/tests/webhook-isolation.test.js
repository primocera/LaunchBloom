// ---------------------------------------------------------------------------
// Webhook isolation on a SHARED Stripe account.
//
// One Stripe account (acct_1TQcF60YzvSNMCpN) serves Scalvya, Mellowa and Frost.
// A Stripe webhook endpoint subscribes to event TYPES, not to products — so
// Stripe broadcasts every matching event to every endpoint on the account and
// this handler receives other products' subscription events. Separate URLs
// separate nothing; the filtering has to happen inside the handler.
//
// Two failure modes this suite prevents:
//   1. Acting on a foreign event — writing customer rows and sending Scalvya
//      lifecycle mail for a Mellowa trial. (This actually happened: the owner
//      got a Scalvya "trial ending" email for an account he does not have.)
//   2. THROWING on a foreign event — a permanently failing delivery. Stripe
//      disables endpoints that keep failing, and a disabled webhook means
//      paying users silently never get access.
//
// So the contract is: acknowledge (200) and drop. Never 500, never process.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
// One configured Scalvya price, so the price-based discriminator is exercised
// rather than trivially returning false for everything.
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_scalvya_pro';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

// Records every write so "did not act" can be asserted, not assumed.
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

// Capture lifecycle email attempts — the symptom that exposed this bug.
const sentEmails = [];
stubModule('lib/lifecycle-email.js', {
  sendLifecycleEmail: async (kind, key, email) => { sentEmails.push({ kind, email }); },
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
  const header = stripeSdk.webhooks.generateTestHeaderString({
    payload, secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return request(app).post('/api/webhooks/stripe').set('content-type', 'application/json')
    .set('stripe-signature', header).send(payload);
}

const CREATED = 1700000000;

/** A Mellowa/Frost subscription: no app_user_id stamp, a price we don't know. */
const foreignSub = (id, subId, type, status = 'trialing') => ({
  id, type, created: CREATED,
  data: { object: {
    id: subId, customer: 'cus_mellowa', status,
    items: { data: [{ price: { id: 'price_mellowa_monthly' } }] },
    cancel_at_period_end: false, metadata: { supabase_user_id: 'mellowa-user' },
    trial_end: CREATED + 259200, current_period_end: CREATED + 2592000,
  } },
});

function reset() {
  db._writes.length = 0;
  sentEmails.length = 0;
}

// ── foreign events are acked and dropped ───────────────────────────────────

for (const type of [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
]) {
  test(`${type} for another product is acked without writing or emailing`, async () => {
    reset();
    const r = await post(foreignSub(`evt_foreign_${type}`, 'sub_mellowa', type));

    assert.equal(r.status, 200, 'must ack — a retryable 5xx gets the endpoint disabled');
    assert.deepEqual(db._writes, [], 'a foreign product must not write to our tables');
    assert.deepEqual(sentEmails, [], 'a foreign trial must not trigger our lifecycle mail');
    assert.equal(db._subs.has('sub_mellowa'), false);
  });
}

test('trial_will_end for another product sends no "trial ending" email', async () => {
  reset();
  // The exact event that emailed the owner about a Mellowa trial from Scalvya.
  const r = await post(foreignSub('evt_foreign_twe', 'sub_mellowa2', 'customer.subscription.trial_will_end'));

  assert.equal(r.status, 200);
  assert.equal(sentEmails.length, 0, 'no Scalvya mail about another product\'s trial');
});

test('a foreign checkout.session.completed does not overwrite our customer id', async () => {
  reset();
  const r = await post({
    id: 'evt_foreign_cs', type: 'checkout.session.completed', created: CREATED,
    data: { object: {
      id: 'cs_mellowa', mode: 'subscription', subscription: 'sub_mellowa',
      customer: 'cus_mellowa', customer_details: { email: 'owner@example.com' },
      metadata: { mellowa: '1' },
    } },
  });

  assert.equal(r.status, 200);
  // This is the write that produced "No such customer" in live mode: a foreign
  // customer id landing on our customers row for a shared email address.
  assert.deepEqual(db._writes, [], 'a foreign session must not touch our customers table');
});

test('XAPP-95-01: a checkout with only app_user_id (no scalvya stamp) is dropped — exact proof', async () => {
  reset();
  // This is the only event that upserts customers.stripe_customer_id, so it must
  // require our EXACT discriminator (metadata.scalvya === "1"), not merely a
  // present app_user_id key that another product could also use.
  const r = await post({
    id: 'evt_ambiguous_cs', type: 'checkout.session.completed', created: CREATED,
    data: { object: {
      id: 'cs_ambiguous', mode: 'subscription', subscription: 'sub_x',
      customer: 'cus_foreign', customer_details: { email: 'owner@example.com' },
      metadata: { app_user_id: 'u_x' },
    } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(db._writes, [], 'no exact scalvya stamp → the foreign customer id never lands on our row');
});

test('a foreign invoice.paid is acked without recording a payment', async () => {
  reset();
  const r = await post({
    id: 'evt_foreign_inv', type: 'invoice.paid', created: CREATED,
    data: { object: {
      id: 'in_mellowa', subscription: 'sub_mellowa_unknown', customer: 'cus_mellowa',
      total: 999, currency: 'eur', billing_reason: 'subscription_cycle',
      period_start: CREATED, period_end: CREATED + 2592000,
      lines: { data: [{ price: { id: 'price_mellowa_monthly' } }] },
    } },
  });

  assert.equal(r.status, 200);
  assert.deepEqual(db._writes, []);
  assert.deepEqual(sentEmails, [], 'no Scalvya receipt for another product\'s charge');
});

// ── our own events still process (the filter must not be over-broad) ───────

test('our subscription is processed when identified by the EXACT source stamp', async () => {
  reset();
  // LB-V17-02: payments.js now stamps subscription_data.metadata.source. That
  // exact stamp is ours even on a price this test does not configure.
  const r = await post({
    id: 'evt_ours_meta', type: 'customer.subscription.created', created: CREATED,
    data: { object: {
      id: 'sub_ours_meta', customer: 'cus_scalvya', status: 'trialing',
      items: { data: [{ price: { id: 'price_unmapped_but_ours' } }] },
      cancel_at_period_end: false, metadata: { source: 'launchbloom', app_user_id: 'u_42' },
      trial_end: CREATED + 259200, current_period_end: CREATED + 2592000,
    } },
  });

  assert.equal(r.status, 200);
  assert.equal(db._subs.get('sub_ours_meta').status, 'trialing', 'our subscription must be recorded');
});

test('LB-V17-02: a bare/empty app_user_id with no exact stamp and no configured price is DROPPED', async () => {
  reset();
  // This is the vulnerability being closed: previously an empty (or arbitrary)
  // app_user_id key alone was accepted as our stamp, so a foreign object could
  // slip in. With no source stamp and an unconfigured price it is now foreign.
  const r = await post({
    id: 'evt_bare_uid', type: 'customer.subscription.created', created: CREATED,
    data: { object: {
      id: 'sub_bare_uid', customer: 'cus_foreign', status: 'active',
      items: { data: [{ price: { id: 'price_unmapped' } }] },
      cancel_at_period_end: false, metadata: { app_user_id: '' },
      current_period_end: CREATED + 2592000,
    } },
  });

  assert.equal(r.status, 200);
  assert.equal(db._subs.has('sub_bare_uid'), false, 'a bare app_user_id is no longer our stamp');
  assert.deepEqual(db._writes, [], 'nothing written for an unproven object');
});

test('our subscription is processed when identified by a configured price', async () => {
  reset();
  // The race the handoff calls out: a real event arriving before any local row
  // and without metadata must still be ours if the price is one of ours.
  const r = await post({
    id: 'evt_ours_price', type: 'customer.subscription.updated', created: CREATED,
    data: { object: {
      id: 'sub_ours_price', customer: 'cus_scalvya', status: 'active',
      items: { data: [{ price: { id: 'price_scalvya_pro' } }] },
      cancel_at_period_end: false, metadata: {},
      current_period_end: CREATED + 2592000,
    } },
  });

  assert.equal(r.status, 200);
  assert.equal(db._subs.get('sub_ours_price').status, 'active',
    'a configured Scalvya price identifies the subscription as ours');
});

test('every foreign event is still recorded in the ledger as processed', async () => {
  // Acked-and-dropped must be durable: a redelivery must not reprocess.
  for (const id of ['evt_foreign_cs', 'evt_foreign_inv', 'evt_foreign_twe']) {
    assert.equal(db._events.get(id).status, 'processed', `${id} should be marked processed`);
  }
});
