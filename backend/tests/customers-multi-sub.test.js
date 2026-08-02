const test = require('node:test');
const assert = require('node:assert/strict');

// Regression: a paying customer who ALSO has an older entitling subscription on a
// now-retired price must not be dropped to free. planFor used to take one
// entitling row arbitrarily (.limit(1), no order); if it landed on the
// retired-price row (which maps to no plan) it returned null → free, even though
// a valid current subscription existed. Reproduced live 2026-08-02: an active
// Starter sub sat beside an old active sub on a retired price, and the account
// showed "Free" after a real payment.

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';

const { stubModule, makeFakeSupabase } = require('./helpers');

stubModule('lib/supabase.js', makeFakeSupabase({
  customers: { data: { id: 'cust-1' }, error: null },
  // Two entitling rows. The retired-price one is listed FIRST on purpose — the
  // mock ignores .order(), so this proves planFor scans past an unmapped row.
  subscriptions: {
    data: [
      { status: 'active', stripe_price_id: 'price_retired_old', stripe_event_at: '2026-07-17T00:00:00Z' },
      { status: 'active', stripe_price_id: 'price_starter_m', stripe_event_at: '2026-08-02T00:00:00Z' },
    ],
    error: null,
  },
}));

const { planFor } = require('../routes/customers');

test('planFor: a retired-price subscription does not mask a valid current one', async () => {
  assert.equal(await planFor('paid@example.com'), 'starter');
});
