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

test('LB-V17-02: only an EXACT source/scalvya stamp proves a subscription is ours', () => {
  // The exact discriminator payments.js now stamps on subscription_data.metadata.
  assert.equal(webhooks.isOurSubscription({ metadata: { source: payments.APP_STRIPE_SOURCE, app_user_id: SCALVYA_USER } }), true);
  assert.equal(webhooks.isOurSubscription({ metadata: { scalvya: '1' } }), true);
  // The vulnerability being closed: a BARE app_user_id key (which any product on
  // the shared account could also set) is NO LONGER accepted as proof.
  assert.equal(webhooks.isOurSubscription({ metadata: { app_user_id: SCALVYA_USER } }), false);
  assert.equal(webhooks.isOurSubscription({ metadata: { app_user_id: '' } }), false);
});

test('a subscription on one of OUR configured prices with no foreign stamp is ours (legacy fallback)', () => {
  assert.equal(webhooks.isOurSubscription({ items: { data: [{ price: { id: 'price_starter_m' } }] }, metadata: {} }), true);
  // Pre-LB-V17-02 subscription: app_user_id only, but on a configured Scalvya price.
  assert.equal(webhooks.isOurSubscription({ items: { data: [{ price: { id: 'price_pro_m' } }] }, metadata: { app_user_id: SCALVYA_USER } }), true);
});

test('a foreign stamp blocks the legacy price fallback even on a configured price', () => {
  // A Mellowa object cannot borrow our price fallback just by carrying a
  // same-looking app_user_id — its foreign stamp (supabase_user_id / source) wins.
  assert.equal(webhooks.isOurSubscription({ items: { data: [{ price: { id: 'price_starter_m' } }] }, metadata: { supabase_user_id: 'mellowa', app_user_id: SCALVYA_USER } }), false);
  assert.equal(webhooks.isOurSubscription({ items: { data: [{ price: { id: 'price_starter_m' } }] }, metadata: { source: 'mellowa' } }), false);
});

test('a foreign subscription (no app metadata, foreign price) is NOT ours', () => {
  assert.equal(webhooks.isOurSubscription({ metadata: {}, items: { data: [{ price: { id: 'price_mellowa_x' } }] } }), false);
  assert.equal(webhooks.isOurSubscription({}), false);
});

test('LB-V17-02: a charge is ours only via an exact stamp or a customer we own', async () => {
  // isOurCharge is async (it may consult our local customer link).
  assert.equal(await webhooks.isOurCharge({ metadata: { source: payments.APP_STRIPE_SOURCE } }), true);
  assert.equal(await webhooks.isOurCharge({ metadata: { scalvya: '1' } }), true);
  // Bare app_user_id no longer proves a charge is ours.
  assert.equal(await webhooks.isOurCharge({ metadata: { app_user_id: SCALVYA_USER } }), false);
  assert.equal(await webhooks.isOurCharge({ metadata: { source: 'mellowa' } }), false);
  assert.equal(await webhooks.isOurCharge({ metadata: {} }), false); // unknown → foreign (fail safe)
  // Unknown customer (our stub returns no local row) → foreign.
  assert.equal(await webhooks.isOurCharge({ metadata: {}, customer: 'cus_unknown' }), false);
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
