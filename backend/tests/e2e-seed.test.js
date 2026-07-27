// v11 SC-03 — the seeding endpoint must be impossible to reach by accident.
//
// A route that creates users and deletes workspaces is the most dangerous
// thing in this repository. These tests assert it is fail-closed on every
// axis independently, so no single missing variable can expose it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const seedPath = path.join(ROOT, 'backend', 'routes', 'e2e-seed.js');

/** Load the router with a controlled environment. */
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve(seedPath)];
  delete require.cache[require.resolve(path.join(ROOT, 'backend', 'lib', 'launch-config.js'))];
  try {
    return fn(require(seedPath));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve(seedPath)];
    delete require.cache[require.resolve(path.join(ROOT, 'backend', 'lib', 'launch-config.js'))];
  }
}

const LONG_SECRET = 'x'.repeat(32);

// launchMode() is derived, not declared: NODE_ENV=production plus a live
// Stripe key is what makes a deployment 'production'.
const PRODUCTION = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_seed_test_only' };
const NON_PRODUCTION = { NODE_ENV: 'test', STRIPE_SECRET_KEY: '' };

test('seeding refuses to operate in production, whatever else is set', () => {
  withEnv({ ...PRODUCTION, E2E_SEED_ENABLED: '1', E2E_SEED_SECRET: LONG_SECRET }, (router) => {
    assert.match(router.seedingAllowed(), /production/);
  });
});

test('seeding refuses without the explicit enable flag', () => {
  withEnv({ ...NON_PRODUCTION, E2E_SEED_ENABLED: undefined, E2E_SEED_SECRET: LONG_SECRET }, (router) => {
    assert.match(router.seedingAllowed(), /E2E_SEED_ENABLED/);
  });
  withEnv({ ...NON_PRODUCTION, E2E_SEED_ENABLED: '0', E2E_SEED_SECRET: LONG_SECRET }, (router) => {
    assert.match(router.seedingAllowed(), /E2E_SEED_ENABLED/);
  });
});

test('seeding refuses a missing or guessable secret', () => {
  for (const secret of [undefined, '', 'short', 'x'.repeat(23)]) {
    withEnv({ ...NON_PRODUCTION, E2E_SEED_ENABLED: '1', E2E_SEED_SECRET: secret }, (router) => {
      assert.match(router.seedingAllowed(), /E2E_SEED_SECRET/, `secret ${JSON.stringify(secret)} was accepted`);
    });
  }
});

test('seeding is allowed only when every condition holds at once', () => {
  withEnv({ ...NON_PRODUCTION, E2E_SEED_ENABLED: '1', E2E_SEED_SECRET: LONG_SECRET }, (router) => {
    assert.equal(router.seedingAllowed(), null);
  });
});

test('seeded identities can never receive mail', () => {
  const router = withEnv({ ...NON_PRODUCTION, E2E_SEED_ENABLED: '1', E2E_SEED_SECRET: LONG_SECRET }, (r) => r);
  // .invalid is reserved by RFC 2606 and is guaranteed not to resolve, so a
  // seeded account cannot be mailed even if a lifecycle job picks it up.
  assert.equal(router.SEED_DOMAIN, 'e2e.invalid');
  assert.equal(router.RUN_PREFIX, 'e2e-run-');
});

test('server.js mounts the seed router only behind the enable flag', () => {
  const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  assert.match(server, /if \(process\.env\.E2E_SEED_ENABLED === '1'\)/);
  // The require itself must sit inside the branch, so the module is not even
  // loaded in a normal deployment.
  const branch = server.slice(server.indexOf("if (process.env.E2E_SEED_ENABLED === '1')"));
  assert.match(branch.slice(0, 600), /require\('\.\/routes\/e2e-seed'\)/);
  assert.match(branch.slice(0, 600), /seedingAllowed\(\)/);
});

test('cleanup is scoped to the run and cannot delete arbitrary workspaces', () => {
  const source = fs.readFileSync(seedPath, 'utf8');
  // The only delete paths must be filtered by the run's synthetic email
  // pattern or by an id that came from that filter.
  assert.match(source, /\.like\('user_email', like\)/);
  assert.match(source, /const like = `\$\{RUN_PREFIX\}\$\{runId\}-%@\$\{SEED_DOMAIN\}`/);
  assert.ok(
    !/\.delete\(\)\s*$/m.test(source.replace(/\.delete\(\)\.eq\([^)]*\)/g, '')),
    'an unfiltered delete would be able to remove real workspaces',
  );
});

test('the seed route never grants entitlement directly', () => {
  const source = fs.readFileSync(seedPath, 'utf8');
  for (const table of ['subscriptions', 'payments', 'customers']) {
    assert.ok(
      !new RegExp(`from\\('${table}'\\)`).test(source),
      `seeding must not write ${table}: plan state has to come from the billing tables as it does in production`,
    );
  }
});

test('the authenticated suite treats missing credentials as BLOCKED, not skipped', () => {
  const fixtures = fs.readFileSync(path.join(ROOT, 'e2e', 'authenticated', 'fixtures.js'), 'utf8');
  assert.match(fixtures, /BLOCKED/);
  assert.match(fixtures, /throw new Error\(BLOCKED_MESSAGE\)/);
  // test.skip() would let a release read the suite as "nothing to report".
  assert.ok(!/test\.skip\(/.test(fixtures), 'a missing environment must fail the run, never skip it');
});

test('the launch manifest lists authenticated E2E as a required check', () => {
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'launch', 'launch-state.json'), 'utf8'));
  const check = state.checks.find((c) => c.id === 'e2e_authenticated');
  assert.ok(check, 'the authenticated matrix must appear in the launch manifest');
  assert.equal(check.required, true, 'it must be required, or skipping it costs nothing');
});
