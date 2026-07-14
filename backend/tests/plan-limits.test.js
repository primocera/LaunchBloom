const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { PLAN_LIMITS, limitsFor, usageFor } = require('../lib/plan-limits');

test('limitsFor: known plans, business alias, unknown falls back to free', () => {
  assert.equal(limitsFor('starter'), PLAN_LIMITS.starter);
  assert.equal(limitsFor('business'), PLAN_LIMITS.studio);
  assert.equal(limitsFor('nonsense'), PLAN_LIMITS.free);
  assert.equal(limitsFor(null), PLAN_LIMITS.free);
});

test('AI-action limits match the pricing promise', () => {
  assert.equal(PLAN_LIMITS.trial.ai_actions, 20);
  assert.equal(PLAN_LIMITS.starter.ai_actions, 30);
  assert.equal(PLAN_LIMITS.pro.ai_actions, 120);
  assert.equal(PLAN_LIMITS.studio.ai_actions, 400);
  assert.equal(PLAN_LIMITS.free.ai_actions, 0);
});

test('launch-kit sub-caps: trial 1, free 0', () => {
  assert.equal(PLAN_LIMITS.trial.launch_kits, 1);
  assert.equal(PLAN_LIMITS.free.launch_kits, 0);
});

test('every plan defines the metered fields', () => {
  for (const [name, limits] of Object.entries(PLAN_LIMITS)) {
    for (const f of ['workspaces', 'ai_actions', 'launch_kits']) {
      assert.ok(typeof limits[f] === 'number', `${name}.${f} must be numeric`);
    }
    assert.ok(typeof limits.monthly === 'boolean', `${name}.monthly`);
  }
});

test('usageFor returns ai_actions + launch_kits from the ledger', async () => {
  // makeFakeSupabase returns count 0 for usage_events by default.
  const u = await usageFor('ws-1', 'trial', 'a@b.com');
  assert.deepEqual(u, { ai_actions: 0, launch_kits: 0 });
});
