// ---------------------------------------------------------------------------
// AI-action top-up packs: the webhook grant.
//
// A paid top-up Checkout Session grants exactly ONE action_topups row:
//   - the action count comes from OUR catalog by pack key, never from metadata;
//   - the pack expires at the reset of the monthly window it was bought in,
//     for monthly AND yearly subscribers alike;
//   - a redelivered / concurrent event never grants twice (unique session id);
//   - an unpaid (delayed-method) session grants nothing until the money lands;
//   - nothing is ever written to `payments` (that table means lifetime access);
//   - a fully refunded pack charge revokes the pack, a partial refund does not.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
delete process.env.STRIPE_OWNERSHIP_ENFORCED;

const { stubModule } = require('./helpers');

const db = {
  sub: null,             // the subscriptions row customerWindowEnd reads
  subError: null,        // a non-PGRST116 read error on subscriptions
  topups: [],            // action_topups rows (unique on stripe_checkout_session_id)
  topupUpdates: [],      // recorded action_topups updates
  tablesWritten: new Set(),
  failTopups: false,
};

function builder(table) {
  const st = { table, op: 'select', payload: null, opts: null, filters: {} };
  const api = {
    select() { return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    upsert(p, opts) { st.op = 'upsert'; st.payload = p; st.opts = opts; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    in() { return api; },
    order() { return api; },
    limit() { return api; },
    single() {
      if (st.op !== 'select') db.tablesWritten.add(table);
      if (table === 'customers' && st.op === 'upsert') return Promise.resolve({ data: { id: 'cust_row_1' }, error: null });
      if (table === 'subscriptions' && db.subError) return Promise.resolve({ data: null, error: db.subError });
      if (table === 'subscriptions' && db.sub) return Promise.resolve({ data: db.sub, error: null });
      return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
    },
    then(res, rej) {
      if (st.op !== 'select') db.tablesWritten.add(table);
      let out = { data: null, error: null };
      if (table === 'action_topups' && st.op === 'upsert') {
        if (db.failTopups) out = { data: null, error: { message: 'relation does not exist' } };
        else {
          assert.equal(st.opts.onConflict, 'stripe_checkout_session_id');
          assert.equal(st.opts.ignoreDuplicates, true);
          const dup = db.topups.some((t) => t.stripe_checkout_session_id === st.payload.stripe_checkout_session_id);
          if (!dup) db.topups.push({ status: 'active', ...st.payload });
          out = { data: dup ? [] : [{ id: 'tu_' + db.topups.length }], error: null };
        }
      }
      if (table === 'action_topups' && st.op === 'update') {
        db.topupUpdates.push({ payload: st.payload, filters: st.filters });
        for (const t of db.topups) {
          if (t.stripe_payment_intent_id === st.filters.stripe_payment_intent_id) Object.assign(t, st.payload);
        }
      }
      return Promise.resolve(out).then(res, rej);
    },
  };
  return api;
}

stubModule('lib/supabase.js', { from: builder });
stubModule('lib/stripe.js', { customers: { retrieve: async () => ({}) }, webhooks: {} });

const webhooks = require('../routes/webhooks');
const { TOPUP_PACKS } = require('../lib/plan-catalog');
const usage = require('../lib/usage');

function reset() {
  db.sub = null;
  db.topups = [];
  db.topupUpdates = [];
  db.tablesWritten = new Set();
  db.failTopups = false;
  db.subError = null;
}

// Bought 2026-11-20 10:00 UTC.
const BOUGHT = Date.UTC(2026, 10, 20, 10, 0, 0) / 1000;

function packSession(over = {}) {
  return {
    id: 'cs_pack_1',
    mode: 'payment',
    payment_status: 'paid',
    created: BOUGHT,
    customer: 'cus_1',
    customer_details: { email: 'buyer@app.com' },
    payment_intent: 'pi_1',
    amount_total: 999,
    currency: 'usd',
    metadata: { scalvya: '1', kind: 'action_topup', pack: 'actions_40', app_user_id: 'user-1' },
    ...over,
  };
}

// The grant is dated when the payment lands (now), so expectations are derived
// from the real clock; the date math itself is pinned by the pure tests below.
function monthsAgo(n) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 5, 8, 0, 0)).toISOString();
}

test('a paid pack grants its catalog actions once, expiring at the next monthly reset', async () => {
  reset();
  db.sub = { current_period_start: monthsAgo(0) > new Date().toISOString() ? monthsAgo(1) : monthsAgo(0) };
  await webhooks.onCheckoutSessionCompleted(packSession());
  assert.equal(db.topups.length, 1);
  const g = db.topups[0];
  assert.equal(g.user_id, 'user-1');
  assert.equal(g.actions, TOPUP_PACKS.actions_40.actions);
  assert.equal(g.stripe_checkout_session_id, 'cs_pack_1');
  assert.equal(g.stripe_payment_intent_id, 'pi_1');
  assert.equal(g.expires_at, usage.monthlyWindowEnd(db.sub.current_period_start, new Date()));
  assert.ok(new Date(g.expires_at) > new Date(), 'a fresh grant is never already expired');
});

test('a yearly subscriber\'s pack expires at the next MONTHLY reset, not the yearly renewal', async () => {
  reset();
  db.sub = { current_period_start: monthsAgo(8) }; // yearly period started 8 months ago
  await webhooks.onCheckoutSessionCompleted(packSession());
  const exp = new Date(db.topups[0].expires_at);
  assert.ok(exp > new Date());
  assert.ok(exp - new Date() <= 32 * 24 * 3600 * 1000, 'within about a month, not at the yearly renewal');
});

test('pack expiry math: monthly, yearly, month-end anchors, paid after a reset', () => {
  // Monthly anchored on the 5th, paid mid-cycle.
  assert.equal(usage.monthlyWindowEnd('2026-11-05T08:00:00.000Z', new Date('2026-11-20T10:00:00Z')), '2026-12-05T08:00:00.000Z');
  // Yearly anchored Mar 15: the next MONTHLY anniversary.
  assert.equal(usage.monthlyWindowEnd('2026-03-15T08:00:00.000Z', new Date('2026-11-20T10:00:00Z')), '2026-12-15T08:00:00.000Z');
  // Anchor Jan 31: Feb 28 window ends Mar 31 (the anchor), not Mar 28.
  assert.equal(usage.monthlyWindowEnd('2026-01-31T00:00:00.000Z', new Date('2026-03-05T00:00:00Z')), '2026-03-31T00:00:00.000Z');
  // Monthly period Mar 31 → Apr 30 (clamped).
  assert.equal(usage.monthlyWindowEnd('2026-03-31T00:00:00.000Z', new Date('2026-04-15T00:00:00Z')), '2026-04-30T00:00:00.000Z');
  // Checkout opened Feb 28 23:50, paid Mar 1 00:10 (yearly from Jan 1): dated at
  // payment, so it covers the March window instead of landing expired.
  assert.equal(usage.monthlyWindowEnd('2026-01-01T00:00:00.000Z', new Date('2026-03-01T00:10:00Z')), '2026-04-01T00:00:00.000Z');
});

test('a subscription read error at grant time throws so Stripe retries (no calendar guess)', async () => {
  reset();
  db.subError = { code: 'XX000', message: 'connection reset' };
  await assert.rejects(() => webhooks.onCheckoutSessionCompleted(packSession()), /subscription window unavailable/);
  assert.equal(db.topups.length, 0);
});

test('the pack size comes from the catalog, never from an action count in metadata', async () => {
  reset();
  db.sub = { current_period_start: monthsAgo(1) };
  await webhooks.onCheckoutSessionCompleted(packSession({
    metadata: { scalvya: '1', kind: 'action_topup', pack: 'actions_100', actions: '999999', app_user_id: 'user-1' },
  }));
  assert.equal(db.topups[0].actions, TOPUP_PACKS.actions_100.actions);
});

test('a redelivered event never grants the same pack twice', async () => {
  reset();
  db.sub = { current_period_start: '2026-11-05T08:00:00.000Z' };
  await webhooks.onCheckoutSessionCompleted(packSession());
  await webhooks.onCheckoutSessionCompleted(packSession());
  // async_payment_succeeded for the same session is the same purchase too.
  await webhooks.onCheckoutSessionCompleted(packSession());
  assert.equal(db.topups.length, 1);
});

test('an unpaid (delayed method) session grants nothing until it is paid', async () => {
  reset();
  db.sub = { current_period_start: '2026-11-05T08:00:00.000Z' };
  await webhooks.onCheckoutSessionCompleted(packSession({ payment_status: 'unpaid' }));
  assert.equal(db.topups.length, 0);
  await webhooks.onCheckoutSessionCompleted(packSession({ payment_status: 'paid' }));
  assert.equal(db.topups.length, 1);
});

test('an unknown pack or a missing app user grants nothing', async () => {
  reset();
  await webhooks.onCheckoutSessionCompleted(packSession({
    metadata: { scalvya: '1', kind: 'action_topup', pack: 'actions_9999', app_user_id: 'user-1' },
  }));
  await webhooks.onCheckoutSessionCompleted(packSession({
    client_reference_id: undefined,
    metadata: { scalvya: '1', kind: 'action_topup', pack: 'actions_40' },
  }));
  assert.equal(db.topups.length, 0);
});

test('a pack is never written to payments (which would mean lifetime access)', async () => {
  reset();
  db.sub = { current_period_start: '2026-11-05T08:00:00.000Z' };
  await webhooks.onCheckoutSessionCompleted(packSession());
  assert.equal(db.tablesWritten.has('payments'), false);
  assert.equal(db.tablesWritten.has('subscriptions'), false);
});

test('a subscription checkout grants no extra actions', async () => {
  reset();
  await webhooks.onCheckoutSessionCompleted(packSession({ mode: 'subscription', subscription: 'sub_1', metadata: { scalvya: '1', app_user_id: 'user-1' } }));
  assert.equal(db.topups.length, 0);
});

test('a failed grant write throws so Stripe redelivers', async () => {
  reset();
  db.failTopups = true;
  await assert.rejects(() => webhooks.onCheckoutSessionCompleted(packSession()), /top-up pack grant failed/);
});

test('a fully refunded pack charge revokes the pack; a partial refund does not', async () => {
  reset();
  db.sub = { current_period_start: '2026-11-05T08:00:00.000Z' };
  await webhooks.onCheckoutSessionCompleted(packSession());
  await webhooks.revokeRefundedTopup({ id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount_refunded: 100 });
  assert.equal(db.topups[0].status, 'active');
  await webhooks.revokeRefundedTopup({ id: 'ch_1', payment_intent: 'pi_1', refunded: true });
  assert.equal(db.topups[0].status, 'refunded');
});

test('a LOST dispute on a pack charge revokes the pack; a won dispute does not', async () => {
  reset();
  db.sub = { current_period_start: '2026-11-05T08:00:00.000Z' };
  await webhooks.onCheckoutSessionCompleted(packSession());
  await webhooks.revokeLostDisputeTopup({ id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'won' });
  assert.equal(db.topups[0].status, 'active');
  await webhooks.revokeLostDisputeTopup({ id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'lost' });
  assert.equal(db.topups[0].status, 'refunded');
});
