// ---------------------------------------------------------------------------
// v13 SC-P0-02 — the canonical entitlement policy across overlapping Stripe
// subscriptions. Policy: HIGHEST VALID ENTITLEMENT WINS, deterministic under
// any database row order. See docs/decisions/2026-08-02-canonical-entitlement.md
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCanonicalEntitlement,
  planRank,
  PLAN_RANK,
} = require('../lib/subscription-state');

// The price→plan map the app would build from STRIPE_PRICE_* env vars.
const PLANS = {
  price_starter_m: 'starter',
  price_pro_m: 'pro',
  price_studio_m: 'studio',
};

const row = (o) => ({ stripe_event_at: '2026-01-01T00:00:00Z', ...o });
const codes = (r) => r.anomalies.map((a) => a.code);

// -- 1. free only ------------------------------------------------------------
test('no rows at all → no plan, no anomaly', () => {
  const r = resolveCanonicalEntitlement([], PLANS);
  assert.equal(r.plan, null);
  assert.equal(r.canonical, null);
  assert.deepEqual(codes(r), []);
  assert.equal(r.unmapped, false);
});

test('null/undefined rows are tolerated', () => {
  assert.equal(resolveCanonicalEntitlement(null, PLANS).plan, null);
  assert.equal(resolveCanonicalEntitlement(undefined, PLANS).plan, null);
});

// -- 2. one current active plan ---------------------------------------------
test('a single active mapped subscription grants its plan', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_1' })],
    PLANS
  );
  assert.equal(r.plan, 'pro');
  assert.equal(r.canonical.stripe_subscription_id, 'sub_1');
  assert.deepEqual(codes(r), []);
});

// -- 3. one retired active price --------------------------------------------
test('an active row on a retired price alone grants nothing and is flagged', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', stripe_price_id: 'price_retired', stripe_subscription_id: 'sub_old' })],
    PLANS
  );
  assert.equal(r.plan, null);
  assert.equal(r.unmapped, true);
  assert.deepEqual(codes(r), ['unmapped_price']);
});

// -- 4. retired + current active --------------------------------------------
test('a retired-price row never masks a valid current subscription', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'active', stripe_price_id: 'price_retired', stripe_subscription_id: 'sub_old', stripe_event_at: '2026-08-02T00:00:00Z' }),
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_new', stripe_event_at: '2026-07-17T00:00:00Z' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'starter');
  assert.deepEqual(codes(r), ['unmapped_price']);
});

// -- 5. two current plans at different levels --------------------------------
test('two mapped active plans → the HIGHER one wins, overlap flagged', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'active', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_studio' }),
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_starter' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'studio');
  assert.deepEqual(codes(r), ['overlapping_subscriptions']);
});

test('PROPERTY: a lower plan cannot win just because it is newer', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'active', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_studio', stripe_event_at: '2026-01-01T00:00:00Z' }),
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_starter', stripe_event_at: '2026-08-02T00:00:00Z' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'studio', 'newest-row-wins would have downgraded this customer');
});

test('a trialing row beside a paid active row does not downgrade to trial', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'trialing', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_trial', stripe_event_at: '2026-08-02T00:00:00Z' }),
      row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_paid', stripe_event_at: '2026-01-01T00:00:00Z' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'pro');
});

// -- 6. active + past_due ----------------------------------------------------
test('past_due never entitles and never joins the overlap set', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'past_due', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_dunning' }),
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_ok' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'starter');
  assert.deepEqual(codes(r), []);
});

test('past_due alone → no access', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'past_due', stripe_price_id: 'price_pro_m' })],
    PLANS
  );
  assert.equal(r.plan, null);
  assert.deepEqual(codes(r), []);
});

// -- 7. cancel_at_period_end inside the entitlement window -------------------
test('cancel_at_period_end keeps access while the status is still active', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', cancel_at_period_end: true, stripe_price_id: 'price_pro_m' })],
    PLANS
  );
  assert.equal(r.plan, 'pro');
});

// -- 8. fully expired --------------------------------------------------------
for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
  test(`${status} grants nothing`, () => {
    const r = resolveCanonicalEntitlement(
      [row({ status, stripe_price_id: 'price_studio_m' })],
      PLANS
    );
    assert.equal(r.plan, null);
  });
}

test('an unknown status is treated as non-entitling, not assumed safe', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'some_future_stripe_status', stripe_price_id: 'price_studio_m' })],
    PLANS
  );
  assert.equal(r.plan, null);
  assert.deepEqual(codes(r), []);
});

// -- 9. unknown price --------------------------------------------------------
test('an unknown price on an active row is flagged, never granted', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', stripe_price_id: 'price_typo', stripe_subscription_id: 'sub_x' })],
    PLANS
  );
  assert.equal(r.plan, null);
  assert.equal(r.anomalies[0].code, 'unmapped_price');
  assert.deepEqual(r.anomalies[0].price_ids, ['price_typo']);
});

test('a missing price id does not crash and does not grant', () => {
  const r = resolveCanonicalEntitlement([row({ status: 'active' })], PLANS);
  assert.equal(r.plan, null);
  assert.equal(r.unmapped, true);
});

test('an empty price map grants nothing (misconfigured env is not free access)', () => {
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', stripe_price_id: 'price_pro_m' })],
    {}
  );
  assert.equal(r.plan, null);
  assert.equal(r.unmapped, true);
});

// -- 10. foreign product -----------------------------------------------------
test('a foreign product on the shared Stripe account cannot entitle', () => {
  // The isolation IS the price map: another product's price id is never in
  // STRIPE_PRICE_*, so it can only ever resolve to unmapped.
  const r = resolveCanonicalEntitlement(
    [row({ status: 'active', stripe_price_id: 'price_other_product', stripe_subscription_id: 'sub_foreign' })],
    PLANS
  );
  assert.equal(r.plan, null);
  assert.deepEqual(codes(r), ['unmapped_price']);
});

test('a foreign product row cannot raise the plan of a real customer', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'active', stripe_price_id: 'price_other_product_premium', stripe_subscription_id: 'sub_foreign' }),
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_ours' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'starter');
});

// -- 11. unordered / replayed webhook events ---------------------------------
test('PROPERTY: the result does not depend on database row order', () => {
  const rows = [
    row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_a', stripe_event_at: '2026-08-02T00:00:00Z' }),
    row({ status: 'active', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_b', stripe_event_at: '2026-01-01T00:00:00Z' }),
    row({ status: 'active', stripe_price_id: 'price_retired', stripe_subscription_id: 'sub_c', stripe_event_at: null }),
    row({ status: 'canceled', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_d' }),
  ];
  // Every permutation of 4 rows must produce the same plan and canonical row.
  const permute = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) =>
    permute([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  const seen = new Set();
  for (const p of permute(rows)) {
    const r = resolveCanonicalEntitlement(p, PLANS);
    seen.add(`${r.plan}|${r.canonical && r.canonical.stripe_subscription_id}|${codes(r).slice().sort().join(',')}`);
  }
  assert.equal(seen.size, 1, `row order changed the answer: ${[...seen].join(' / ')}`);
  assert.ok([...seen][0].startsWith('studio|sub_b|'));
});

test('duplicate/replayed identical rows resolve to one deterministic winner', () => {
  const dup = row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_1' });
  const r = resolveCanonicalEntitlement([dup, { ...dup }], PLANS);
  assert.equal(r.plan, 'pro');
  assert.equal(r.canonical.stripe_subscription_id, 'sub_1');
  // Two mirror rows for the same subscription is itself worth reconciling.
  assert.deepEqual(codes(r), ['overlapping_subscriptions']);
});

test('a future-dated event still resolves by plan rank, not by timestamp', () => {
  const r = resolveCanonicalEntitlement(
    [
      row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_future', stripe_event_at: '2099-01-01T00:00:00Z' }),
      row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_now' }),
    ],
    PLANS
  );
  assert.equal(r.plan, 'pro');
});

test('ties inside one rank break deterministically by subscription id', () => {
  const a = row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_a', stripe_event_at: null });
  const b = row({ status: 'active', stripe_price_id: 'price_pro_m', stripe_subscription_id: 'sub_b', stripe_event_at: null });
  assert.equal(resolveCanonicalEntitlement([a, b], PLANS).canonical.stripe_subscription_id, 'sub_a');
  assert.equal(resolveCanonicalEntitlement([b, a], PLANS).canonical.stripe_subscription_id, 'sub_a');
});

// -- purity / rank -----------------------------------------------------------
test('the resolver does not mutate or reorder the caller\'s array', () => {
  const rows = [
    row({ status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_a' }),
    row({ status: 'active', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_b' }),
  ];
  const snapshot = JSON.stringify(rows);
  resolveCanonicalEntitlement(rows, PLANS);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('plan rank order is trial < starter < pro < studio, unknown = 0', () => {
  assert.ok(PLAN_RANK.trial < PLAN_RANK.starter);
  assert.ok(PLAN_RANK.starter < PLAN_RANK.pro);
  assert.ok(PLAN_RANK.pro < PLAN_RANK.studio);
  assert.equal(planRank('free'), 0);
  assert.equal(planRank(undefined), 0);
});
