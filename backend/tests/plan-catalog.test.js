// v5 Prompt 1 — contract tests: the public catalog can never disagree with
// PLAN_LIMITS enforcement, and savings labels are calculated, not handwritten.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { PLAN_LIMITS } = require('../lib/plan-limits');
const {
  PRICES,
  yearlySavings,
  maxSavingsPct,
  publicCatalog,
  missingStripeEnv,
  AI_ACTION_DEFINITION,
} = require('../lib/plan-catalog');

test('contract: /api/plans catalog limits equal PLAN_LIMITS for every paid plan', () => {
  const { plans } = publicCatalog();
  assert.deepEqual(plans.map((p) => p.plan), ['starter', 'pro', 'studio']);
  for (const p of plans) {
    const limits = PLAN_LIMITS[p.plan];
    assert.equal(p.ai_actions, limits.ai_actions, `${p.plan}.ai_actions`);
    assert.equal(p.launch_kits, limits.launch_kits, `${p.plan}.launch_kits`);
    assert.equal(p.workspaces, limits.workspaces, `${p.plan}.workspaces`);
    assert.equal(p.can_export, limits.can_export, `${p.plan}.can_export`);
    assert.equal(p.label, limits.label);
  }
});

test('contract: trial block equals PLAN_LIMITS.trial and discloses the card requirement', () => {
  const { trial } = publicCatalog();
  assert.equal(trial.days, 3);
  assert.equal(trial.ai_actions_total, PLAN_LIMITS.trial.ai_actions);
  assert.equal(trial.launch_kits_total, PLAN_LIMITS.trial.launch_kits);
  assert.equal(trial.workspaces, PLAN_LIMITS.trial.workspaces);
  assert.match(trial.disclosure, /Payment method required/);
  assert.equal(trial.eyebrow, 'Start with 3 days free');
});

test('savings are calculated exactly from 12 monthly payments', () => {
  assert.deepEqual(yearlySavings('starter'), { amount: 56.88, pct: 36.5 });
  assert.deepEqual(yearlySavings('pro'), { amount: 100.88, pct: 33.6 });
  assert.deepEqual(yearlySavings('studio'), { amount: 209, pct: 29.5 });
  assert.equal(maxSavingsPct(), 36);
  assert.equal(publicCatalog().yearly_badge, 'Save up to 36%');
});

test('every plan has a price and both Stripe env names', () => {
  const { plans } = publicCatalog();
  for (const p of plans) {
    assert.ok(PRICES[p.plan].monthly > 0 && PRICES[p.plan].yearly > 0);
    assert.match(p.stripe_env.monthly, /^STRIPE_PRICE_.+_MONTHLY$/);
    assert.match(p.stripe_env.yearly, /^STRIPE_PRICE_.+_YEARLY$/);
    assert.ok(p.price.display.monthly.startsWith('$'));
  }
});

test('AI action definition covers failures/edits/exports', () => {
  const { ai_action_definition } = publicCatalog();
  assert.equal(ai_action_definition, AI_ACTION_DEFINITION);
  assert.match(ai_action_definition, /Failed generations do not count/);
  assert.match(ai_action_definition, /editing and exporting do not count/);
});

test('missingStripeEnv reports unset price vars and honors legacy monthly fallbacks', () => {
  const saved = {};
  const vars = [
    'STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_STARTER_YEARLY',
    'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_STUDIO_MONTHLY', 'STRIPE_PRICE_STUDIO_YEARLY',
    'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_BUSINESS',
  ];
  for (const v of vars) { saved[v] = process.env[v]; delete process.env[v]; }
  try {
    assert.equal(missingStripeEnv().length, 6);
    process.env.STRIPE_PRICE_PRO = 'price_legacy'; // legacy covers pro monthly only
    assert.ok(!missingStripeEnv().includes('STRIPE_PRICE_PRO_MONTHLY'));
    assert.ok(missingStripeEnv().includes('STRIPE_PRICE_PRO_YEARLY'));
  } finally {
    for (const v of vars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  }
});
