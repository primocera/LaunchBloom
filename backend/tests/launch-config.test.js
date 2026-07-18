// Playbook v6 Prompt 1 — fail-closed launch config: live-Stripe production
// with missing config must hard-block money routes; test/preview stay
// permissive.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule, makeFakeSupabase, mockRes } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

function fresh(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve('../lib/launch-config.js')];
  const mod = require('../lib/launch-config.js');
  return {
    mod,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

const INCOMPLETE = {
  NODE_ENV: 'production',
  STRIPE_SECRET_KEY: 'sk_live_x',
  PUBLIC_URL: undefined,
  ALLOWED_ORIGINS: undefined,
  STRIPE_WEBHOOK_SECRET: undefined,
  SESSION_SECRET: undefined,
  ANTHROPIC_API_KEY: undefined,
  BRAND_LEGAL_NAME: undefined,
};

test('live-key production with missing config blocks checkout and generation with 503', () => {
  const { mod, restore } = fresh(INCOMPLETE);
  try {
    assert.equal(mod.launchMode(), 'production');
    assert.ok(mod.launchConfigProblems().length > 0);
    for (const kind of ['checkout', 'generation']) {
      const res = mockRes();
      let passed = false;
      mod.requireLaunchReady(kind)({ id: 'r1' }, res, () => { passed = true; });
      assert.equal(passed, false, `${kind} must not pass`);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'LAUNCH_CONFIG_INCOMPLETE');
    }
  } finally { restore(); }
});

test('test-mode Stripe in production = preview mode, permissive', () => {
  const { mod, restore } = fresh({ ...INCOMPLETE, STRIPE_SECRET_KEY: 'sk_test_x' });
  try {
    assert.equal(mod.launchMode(), 'preview');
    let passed = false;
    mod.requireLaunchReady('checkout')({ id: 'r1' }, mockRes(), () => { passed = true; });
    assert.equal(passed, true, 'preview mode must not block');
  } finally { restore(); }
});

test('local development is test mode and permissive', () => {
  const { mod, restore } = fresh({ ...INCOMPLETE, NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined });
  try {
    assert.equal(mod.launchMode(), 'test');
    let passed = false;
    mod.requireLaunchReady('generation')({ id: 'r1' }, mockRes(), () => { passed = true; });
    assert.equal(passed, true);
  } finally { restore(); }
});

test('fully configured production passes', () => {
  const { mod, restore } = fresh({
    NODE_ENV: 'production',
    STRIPE_SECRET_KEY: 'sk_live_x',
    PUBLIC_URL: 'https://launchbloom.app',
    ALLOWED_ORIGINS: 'https://launchbloom.app',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'key',
    SESSION_SECRET: 's',
    ANTHROPIC_API_KEY: 'sk-ant-x',
    BRAND_LEGAL_NAME: 'LaunchBloom LLC',
    BRAND_LEGAL_ADDRESS: '123 Main St, Austin, TX',
    BRAND_GOVERNING_LAW: 'the State of Texas, USA',
    STRIPE_PRICE_STARTER_MONTHLY: 'price_1', STRIPE_PRICE_STARTER_YEARLY: 'price_2',
    STRIPE_PRICE_PRO_MONTHLY: 'price_3', STRIPE_PRICE_PRO_YEARLY: 'price_4',
    STRIPE_PRICE_STUDIO_MONTHLY: 'price_5', STRIPE_PRICE_STUDIO_YEARLY: 'price_6',
  });
  try {
    // brand.js caches BRAND at load — reload it so legal env vars apply.
    delete require.cache[require.resolve('../lib/brand.js')];
    delete require.cache[require.resolve('../lib/launch-config.js')];
    const mod2 = require('../lib/launch-config.js');
    assert.deepEqual(mod2.launchConfigProblems(), []);
    let passed = false;
    mod2.requireLaunchReady('checkout')({ id: 'r1' }, mockRes(), () => { passed = true; });
    assert.equal(passed, true);
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/brand.js')];
  }
});
