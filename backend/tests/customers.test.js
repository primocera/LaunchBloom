const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
process.env.STRIPE_PRICE_BUSINESS = 'price_legacy_biz';

const { stubModule, makeFakeSupabase } = require('./helpers');

// planFor: customer exists with a trialing subscription
stubModule('lib/supabase.js', makeFakeSupabase({
  customers: { data: { id: 'cust-1' }, error: null },
  subscriptions: { data: { status: 'trialing', stripe_price_id: 'price_pro_y' }, error: null },
}));

const { planFor, pricePlans } = require('../routes/customers');

test('pricePlans maps env price ids to plans, legacy business → studio', () => {
  const map = pricePlans();
  assert.equal(map.price_starter_m, 'starter');
  assert.equal(map.price_pro_y, 'pro');
  assert.equal(map.price_legacy_biz, 'studio');
});

test('planFor: trialing subscription resolves to the limited trial plan', async () => {
  assert.equal(await planFor('user@example.com'), 'trial');
});

test('planFor: empty email is null', async () => {
  assert.equal(await planFor(''), null);
  assert.equal(await planFor(null), null);
});
