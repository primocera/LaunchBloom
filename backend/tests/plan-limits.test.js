const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');

// Stub the DB before requiring the module under test.
stubModule('lib/supabase.js', makeFakeSupabase({
  launch_kits: { data: null, error: null, count: 3 },
  offers: { data: null, error: null, count: 7 },
}));

const {
  PLAN_LIMITS,
  limitsFor,
  canGenerate,
  canCreateWorkspace,
} = require('../lib/plan-limits');

test('limitsFor: known plans, business alias, unknown falls back to free', () => {
  assert.equal(limitsFor('starter'), PLAN_LIMITS.starter);
  assert.equal(limitsFor('business'), PLAN_LIMITS.studio);
  assert.equal(limitsFor('nonsense'), PLAN_LIMITS.free);
  assert.equal(limitsFor(null), PLAN_LIMITS.free);
});

test('every plan defines the gated features', () => {
  const features = ['workspaces', 'positioning', 'offer_generations', 'launch_kits', 'asset_generations'];
  for (const [name, limits] of Object.entries(PLAN_LIMITS)) {
    for (const f of features) {
      assert.ok(typeof limits[f] === 'number', `${name}.${f} must be numeric`);
    }
    assert.ok(typeof limits.monthly === 'boolean', `${name}.monthly`);
  }
});

test('trial plan matches the pricing promise: 1 kit, lifetime caps', () => {
  assert.equal(PLAN_LIMITS.trial.launch_kits, 1);
  assert.equal(PLAN_LIMITS.trial.monthly, false);
  assert.equal(PLAN_LIMITS.free.launch_kits, 0);
});

test('canGenerate: Infinity limits always pass without counting', async () => {
  const r = await canGenerate('positioning', 'pro', 'ws-1');
  assert.deepEqual(r, { ok: true, used: null, limit: null, plan: 'pro' });
});

test('canGenerate: blocks at the limit, counts offer rows / 3', async () => {
  // starter launch_kits limit is 3, stub says 3 used → blocked
  const kits = await canGenerate('launch_kits', 'starter', 'ws-1');
  assert.equal(kits.ok, false);
  assert.equal(kits.used, 3);

  // 7 offer rows = ceil(7/3) = 3 generations; starter limit 5 → allowed
  const offers = await canGenerate('offer_generations', 'starter', 'ws-1');
  assert.equal(offers.ok, true);
  assert.equal(offers.used, 3);
});

test('canCreateWorkspace enforces per-plan workspace counts', async () => {
  assert.equal(await canCreateWorkspace('starter', 0), true);
  assert.equal(await canCreateWorkspace('starter', 1), false);
  assert.equal(await canCreateWorkspace('pro', 2), true);
  assert.equal(await canCreateWorkspace('pro', 3), false);
  assert.equal(await canCreateWorkspace('studio', 9), true);
  assert.equal(await canCreateWorkspace('studio', 10), false);
});
