// ---------------------------------------------------------------------------
// v15 XAPP-01 — Scalvya's half of the two-app Stripe isolation contract.
//
// Scalvya (this repo) and Mellowa share ONE Stripe account. A shared account is
// not permission to infer ownership from an email: a Scalvya customer, product,
// price or webhook must never be adopted, charged, emailed or counted by
// Mellowa, and vice versa. These are the SYMMETRICAL negative tests the pack
// requires on the Scalvya side — same email, same-looking user id, foreign
// product/price, missing app metadata. The Mellowa side lives in that separate
// repository and is out of scope here (see docs/XAPP_ISOLATION_MATRIX.md).
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_m';

const { stubModule } = require('./helpers');

// Minimal stubs so the route modules load without real providers.
stubModule('lib/supabase.js', {
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
});
const stripeCreated = [];
stubModule('lib/stripe.js', {
  customers: {
    create: async (params) => { const c = { id: `cus_${stripeCreated.length + 1}`, ...params }; stripeCreated.push(c); return c; },
    retrieve: async (id) => ({ id, deleted: false }),
    search: async ({ query }) => {
      const uid = (query.match(/app_user_id'\]:'([^']+)'/) || [])[1];
      const src = (query.match(/source'\]:'([^']+)'/) || [])[1];
      return { data: stripeCreated.filter((c) => c.metadata && c.metadata.app_user_id === uid && c.metadata.source === src) };
    },
  },
});

const webhooks = require('../routes/webhooks');
const payments = require('../routes/payments');
const customers = require('../routes/customers');

const SCALVYA_USER = 'scalvya-user-uuid';

// --- webhook ownership: a foreign event is never ours ---------------------

test('a subscription with OUR app_user_id stamp is ours', () => {
  assert.equal(webhooks.isOurSubscription({ metadata: { app_user_id: SCALVYA_USER } }), true);
  // Even an empty-string stamp is OURS (presence, not truthiness).
  assert.equal(webhooks.isOurSubscription({ metadata: { app_user_id: '' } }), true);
});

test('a subscription on one of OUR configured prices is ours', () => {
  assert.equal(webhooks.isOurSubscription({ items: { data: [{ price: { id: 'price_starter_m' } }] }, metadata: {} }), true);
});

test('a foreign subscription (no app metadata, foreign price) is NOT ours', () => {
  assert.equal(webhooks.isOurSubscription({ metadata: {}, items: { data: [{ price: { id: 'price_mellowa_x' } }] } }), false);
  assert.equal(webhooks.isOurSubscription({}), false);
});

test('a charge is ours only with our stamp; a foreign or unstamped charge is not', () => {
  assert.equal(webhooks.isOurCharge({ metadata: { app_user_id: SCALVYA_USER } }), true);
  assert.equal(webhooks.isOurCharge({ metadata: { scalvya: '1' } }), true);
  assert.equal(webhooks.isOurCharge({ metadata: { source: 'mellowa' } }), false);
  assert.equal(webhooks.isOurCharge({ metadata: {} }), false); // unknown → foreign (fail safe)
});

// --- customer ownership: recovery never crosses the app boundary ----------

test('the idempotency key is app-namespaced on the stable user id, never the email', () => {
  const key = payments.stripeCustomerIdempotencyKey(SCALVYA_USER);
  assert.ok(key.startsWith('scalvya:'), 'app namespace');
  assert.ok(key.includes(SCALVYA_USER));
  assert.ok(!/@/.test(key));
});

test('recovery matches only Scalvya-owned metadata, never a foreign customer with the same user id', async () => {
  stripeCreated.length = 0;
  // A Mellowa customer with the SAME app_user_id value but a foreign source tag.
  stripeCreated.push({ id: 'cus_mellowa', metadata: { app_user_id: SCALVYA_USER, source: 'mellowa' } });
  const recovered = await payments.recoverScalvyaCustomer(SCALVYA_USER);
  assert.equal(recovered.status, 'zero', 'a foreign-source customer is never recovered as ours');
});

test('recovery matches our own customer by source + user id', async () => {
  stripeCreated.length = 0;
  stripeCreated.push({ id: 'cus_ours', metadata: { app_user_id: SCALVYA_USER, source: payments.APP_STRIPE_SOURCE } });
  const recovered = await payments.recoverScalvyaCustomer(SCALVYA_USER);
  assert.deepEqual(recovered, { status: 'one', id: 'cus_ours' });
});

test('multiple Scalvya candidates fail closed (reconciliation), never an arbitrary pick', async () => {
  stripeCreated.length = 0;
  stripeCreated.push({ id: 'cus_a', metadata: { app_user_id: SCALVYA_USER, source: payments.APP_STRIPE_SOURCE } });
  stripeCreated.push({ id: 'cus_b', metadata: { app_user_id: SCALVYA_USER, source: payments.APP_STRIPE_SOURCE } });
  const recovered = await payments.recoverScalvyaCustomer(SCALVYA_USER);
  assert.equal(recovered.status, 'multiple');
  assert.equal(recovered.count, 2);
});

// --- price ownership: every configured price is Scalvya's -----------------

test('every configured Stripe price maps to a Scalvya plan (no foreign price is honoured)', () => {
  const map = customers.pricePlans();
  assert.equal(map.price_starter_m, 'starter');
  assert.equal(map.price_pro_m, 'pro');
  // A price this app did not configure is not one of ours.
  assert.equal(map.price_mellowa_x, undefined);
  for (const plan of Object.values(map)) {
    assert.ok(['starter', 'pro', 'studio'].includes(plan), `unexpected plan mapping: ${plan}`);
  }
});
