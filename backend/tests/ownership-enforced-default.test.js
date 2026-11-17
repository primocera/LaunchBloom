// ---------------------------------------------------------------------------
// Audit B5 (2026-11-15): in live production a missing
// STRIPE_OWNERSHIP_ENFORCED no longer silently reverts billing to email-keyed
// customers and the price-only fallback, and any value other than 1 is a
// blocking launch-config problem. Outside live production only '1' enforces,
// exactly as before.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { ownershipEnforced } = require('../lib/stripe-ownership');
const { launchConfigProblems } = require('../lib/launch-config');

const KEYS = ['NODE_ENV', 'STRIPE_SECRET_KEY', 'STRIPE_OWNERSHIP_ENFORCED'];
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
const LIVE = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_xyz' };
const flagProblem = (problems) => problems.filter((p) => /STRIPE_OWNERSHIP_ENFORCED/.test(p));

test('B5: live production enforces when the variable is missing', () => {
  withEnv({ ...LIVE }, () => {
    assert.equal(ownershipEnforced(), true);
    assert.deepEqual(flagProblem(launchConfigProblems()), []);
  });
});

test('B5: live production with the flag set to 1 enforces with no problem', () => {
  withEnv({ ...LIVE, STRIPE_OWNERSHIP_ENFORCED: '1' }, () => {
    assert.equal(ownershipEnforced(), true);
    assert.deepEqual(flagProblem(launchConfigProblems()), []);
  });
});

test('B5: any other explicit value in live production is a blocking problem', () => {
  for (const v of ['0', 'true', 'yes']) {
    withEnv({ ...LIVE, STRIPE_OWNERSHIP_ENFORCED: v }, () => {
      assert.equal(flagProblem(launchConfigProblems()).length, 1, `value ${v}`);
    });
  }
});

test('B5: outside live production nothing changes - only 1 enforces', () => {
  withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_xyz' }, () => assert.equal(ownershipEnforced(), false));
  withEnv({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_live_xyz' }, () => assert.equal(ownershipEnforced(), false));
  withEnv({}, () => assert.equal(ownershipEnforced(), false));
  withEnv({ STRIPE_OWNERSHIP_ENFORCED: '1' }, () => assert.equal(ownershipEnforced(), true));
});
