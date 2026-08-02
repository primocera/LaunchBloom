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

// --- v13 SC-P0-04 -----------------------------------------------------------

const VALID_PROD = {
  NODE_ENV: 'production',
  STRIPE_SECRET_KEY: 'sk_live_x',
  PUBLIC_URL: 'https://scalvya.com',
  ALLOWED_ORIGINS: 'https://scalvya.com',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
  SESSION_SECRET: 'session-secret-value',
  ANTHROPIC_API_KEY: 'sk-ant-secret-value',
  BRAND_LEGAL_NAME: 'Scalvya LLC',
  BRAND_LEGAL_ADDRESS: '123 Main St, Austin, TX',
  BRAND_GOVERNING_LAW: 'the State of Texas, USA',
  BRAND_TERMS_URL: undefined,
  BRAND_PRIVACY_URL: undefined,
  EUR_PRICING_ENABLED: undefined,
  EUR_PRICES_VERIFIED: undefined,
  ENFORCE_LAUNCH_CONFIG: undefined,
  UNSAFE_SKIP_LAUNCH_CONFIG_CHECK: undefined,
  STRIPE_PRICE_STARTER_MONTHLY: 'price_1', STRIPE_PRICE_STARTER_YEARLY: 'price_2',
  STRIPE_PRICE_PRO_MONTHLY: 'price_3', STRIPE_PRICE_PRO_YEARLY: 'price_4',
  STRIPE_PRICE_STUDIO_MONTHLY: 'price_5', STRIPE_PRICE_STUDIO_YEARLY: 'price_6',
  STRIPE_PRICE_STARTER: undefined, STRIPE_PRICE_PRO: undefined, STRIPE_PRICE_BUSINESS: undefined,
};

function freshProd(overrides = {}) {
  const ctx = fresh({ ...VALID_PROD, ...overrides });
  delete require.cache[require.resolve('../lib/brand.js')];
  delete require.cache[require.resolve('../lib/launch-config.js')];
  const mod = require('../lib/launch-config.js');
  const restore = () => {
    ctx.restore();
    delete require.cache[require.resolve('../lib/brand.js')];
    delete require.cache[require.resolve('../lib/launch-config.js')];
  };
  return { mod, restore };
}

function blocked(mod, kind = 'checkout') {
  const res = mockRes();
  let passed = false;
  mod.requireLaunchReady(kind)({ id: 'r1' }, res, () => { passed = true; });
  return { passed, res };
}

test('SC-P0-04: production enforces automatically without ENFORCE_LAUNCH_CONFIG', () => {
  const { mod, restore } = freshProd({ SESSION_SECRET: undefined });
  try {
    assert.equal(process.env.ENFORCE_LAUNCH_CONFIG, undefined);
    assert.equal(mod.launchConfigEnforced(), true);
    const { passed, res } = blocked(mod);
    assert.equal(passed, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'LAUNCH_CONFIG_INCOMPLETE');
  } finally { restore(); }
});

test('SC-P0-04: production with a localhost/placeholder legal URL fails', () => {
  for (const bad of ['http://localhost:3000/terms', 'https://example.com/terms', 'not-a-url']) {
    const { mod, restore } = freshProd({ BRAND_TERMS_URL: bad });
    try {
      const problems = mod.launchConfigProblems();
      assert.ok(problems.some((p) => p.includes('BRAND_TERMS_URL')), `expected BRAND_TERMS_URL problem for ${bad}`);
      assert.equal(blocked(mod).passed, false);
    } finally { restore(); }
  }
});

test('SC-P0-04: production with a missing Stripe price mapping fails', () => {
  const { mod, restore } = freshProd({ STRIPE_PRICE_PRO_YEARLY: undefined });
  try {
    assert.ok(mod.launchConfigProblems().some((p) => p.includes('STRIPE_PRICE_PRO_YEARLY')));
    assert.equal(blocked(mod).passed, false);
  } finally { restore(); }
});

test('SC-P0-04: enabled-but-unverified currency catalog fails production', () => {
  const { mod, restore } = freshProd({ EUR_PRICING_ENABLED: '1' });
  try {
    assert.ok(mod.launchConfigProblems().some((p) => p.includes('EUR_PRICES_VERIFIED')));
    assert.equal(blocked(mod).passed, false);
  } finally { restore(); }

  const ok = freshProd({ EUR_PRICING_ENABLED: '1', EUR_PRICES_VERIFIED: '1' });
  try {
    assert.deepEqual(ok.mod.launchConfigProblems(), []);
  } finally { ok.restore(); }
});

test('SC-P0-04: unsafe bypass is rejected in production (refuses to start)', () => {
  const { mod, restore } = freshProd({ UNSAFE_SKIP_LAUNCH_CONFIG_CHECK: '1' });
  try {
    assert.equal(mod.bypassRequested(), true);
    assert.equal(mod.bypassAllowed(), false, 'bypass must never be honoured in production');
    assert.ok(mod.launchConfigProblems().some((p) => p.includes(mod.UNSAFE_BYPASS)));
    const result = mod.startupLaunchConfigCheck({ exit: false });
    assert.equal(result.fatal, true);
    assert.equal(blocked(mod).passed, false);
  } finally { restore(); }
});

test('SC-P0-04: development stays usable, and the bypass works there', () => {
  const { mod, restore } = freshProd({
    NODE_ENV: 'development',
    STRIPE_SECRET_KEY: 'sk_test_x',
    SESSION_SECRET: undefined,
    ENFORCE_LAUNCH_CONFIG: '1',
    UNSAFE_SKIP_LAUNCH_CONFIG_CHECK: '1',
  });
  try {
    assert.equal(mod.bypassAllowed(), true);
    assert.equal(mod.launchConfigEnforced(), false);
    assert.equal(blocked(mod, 'generation').passed, true);
    assert.equal(mod.startupLaunchConfigCheck({ exit: false }).fatal, false);
  } finally { restore(); }
});

test('SC-P0-04: valid production config passes and prints no secret values', () => {
  const { mod, restore } = freshProd();
  const logs = [];
  const [warn, error] = [console.warn, console.error];
  console.warn = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    assert.deepEqual(mod.launchConfigProblems(), []);
    const result = mod.startupLaunchConfigCheck({ exit: false });
    assert.equal(result.ok, true);
    assert.equal(blocked(mod).passed, true);

    // And an INVALID production config must still not echo any secret value.
    restore();
    const bad = freshProd({ SESSION_SECRET: undefined, STRIPE_PRICE_PRO_YEARLY: undefined });
    bad.mod.startupLaunchConfigCheck({ exit: false });
    blocked(bad.mod);
    const text = logs.join('\n');
    for (const secret of ['service-role-secret-value', 'session-secret-value', 'sk-ant-secret-value', 'whsec_x', 'sk_live_x', 'price_1']) {
      assert.equal(text.includes(secret), false, `log leaked ${secret}`);
    }
    bad.restore();
  } finally {
    console.warn = warn;
    console.error = error;
  }
});

test('fully configured production passes', () => {
  const { restore } = fresh({
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
