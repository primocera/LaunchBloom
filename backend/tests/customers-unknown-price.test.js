// v5 Prompt 1 — an active subscription on an UNMAPPED Stripe price must not
// silently grant a plan (previously fell back to 'pro').

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule, makeFakeSupabase } = require('./helpers');

stubModule('lib/supabase.js', makeFakeSupabase({
  customers: { data: { id: 'cust-1' }, error: null },
  subscriptions: { data: { status: 'active', stripe_price_id: 'price_not_in_env' }, error: null },
}));

const { planFor } = require('../routes/customers');

test('planFor: active subscription with unknown price id grants no plan', async () => {
  assert.equal(await planFor('user@example.com'), null);
});
