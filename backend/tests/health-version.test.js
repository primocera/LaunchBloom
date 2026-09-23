// ---------------------------------------------------------------------------
// v24 SV-24-01 (B) — GET /health exposes a verifiable, redacted deploy version.
//
// Production parity must be provable against the RC SHA, so /health carries a
// short hex prefix of VERCEL_GIT_COMMIT_SHA — and nothing else about the
// deployment: no env value verbatim, no key, model, config, deployment id or
// internal path. The real server is loaded in a child process per case so each
// environment is resolved from a clean module cache, exactly as at cold start.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveVersion, rootPackageVersion, SHORT_SHA_LENGTH } = require('../lib/version');

const ROOT = path.join(__dirname, '..', '..');
const FULL_SHA = '176a7c6859364ee0fd904bc900ec93e159b70197';

// Sentinel secrets/config that must never reach the public response body.
const SENTINELS = {
  SUPABASE_SERVICE_ROLE_KEY: 'sentinel-service-role-9f3a',
  STRIPE_SECRET_KEY: 'sk_test_sentinel_4c1d',
  STRIPE_WEBHOOK_SECRET: 'whsec_sentinel_77aa',
  ANTHROPIC_API_KEY: 'sk-ant-sentinel-0b2e',
  SESSION_SECRET: 'sentinel-session-secret-5e6f',
  RESEND_API_KEY: 're_sentinel_1a2b',
  CRON_SECRET: 'sentinel-cron-3c4d',
  VERCEL_DEPLOYMENT_ID: 'dpl_sentinelDeployment123',
  VERCEL_URL: 'sentinel-preview.vercel.app',
  VERCEL_GIT_COMMIT_REF: 'sentinel-branch',
  ANTHROPIC_MODEL: 'claude-sentinel-model',
};

function healthWith(extraEnv) {
  const script = `
    const request = require('supertest');
    const app = require('./backend/server');
    request(app).get('/health').then((r) => {
      process.stdout.write(JSON.stringify({ status: r.status, text: r.text }));
      process.exit(0);
    }).catch((e) => { console.error(e); process.exit(1); });
  `;
  const env = { ...process.env, NODE_ENV: 'test', ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `server child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  return { status: out.status, text: out.text, body: JSON.parse(out.text) };
}

// --- pure resolver ---------------------------------------------------------

test('production: a valid VERCEL_GIT_COMMIT_SHA yields its short hex prefix only', () => {
  assert.equal(resolveVersion({ VERCEL_GIT_COMMIT_SHA: FULL_SHA }, '1.0.0'), FULL_SHA.slice(0, SHORT_SHA_LENGTH));
  assert.equal(resolveVersion({ VERCEL_GIT_COMMIT_SHA: FULL_SHA.toUpperCase() }, '1.0.0'), FULL_SHA.slice(0, 12));
  assert.equal(resolveVersion({ VERCEL_GIT_COMMIT_SHA: `  ${FULL_SHA}\n` }, '1.0.0'), FULL_SHA.slice(0, 12));
  assert.ok(SHORT_SHA_LENGTH >= 7 && SHORT_SHA_LENGTH <= 12);
});

test('local: no commit SHA falls back deterministically to the package version', () => {
  assert.equal(resolveVersion({}, '1.0.0'), '1.0.0-dev');
  assert.equal(resolveVersion({}, null), 'dev');
  assert.equal(resolveVersion({}, 'not-a-version'), 'dev');
  assert.equal(resolveVersion({}, rootPackageVersion()), resolveVersion({}, rootPackageVersion()));
});

test('invalid SHA values are never echoed — they fall back', () => {
  for (const bad of ['', 'abc12', 'zzzzzzzzzzzz', 'HEAD', `${FULL_SHA}0`, '176a7c6; rm -rf /', '../../etc/passwd', 'g'.repeat(40), 42]) {
    const v = resolveVersion({ VERCEL_GIT_COMMIT_SHA: bad }, '1.0.0');
    assert.equal(v, '1.0.0-dev', `accepted invalid SHA ${JSON.stringify(bad)}`);
  }
});

// --- the real endpoint -----------------------------------------------------

test('GET /health returns the short production SHA', () => {
  const r = healthWith({ VERCEL_GIT_COMMIT_SHA: FULL_SHA });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, FULL_SHA.slice(0, 12));
  assert.ok(!r.text.includes(FULL_SHA), 'the full env value must not be echoed');
});

test('GET /health uses the local fallback without a commit SHA', () => {
  const r = healthWith({ VERCEL_GIT_COMMIT_SHA: undefined });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, `${rootPackageVersion()}-dev`);
});

test('GET /health falls back on an invalid SHA and does not echo it', () => {
  const r = healthWith({ VERCEL_GIT_COMMIT_SHA: 'not-a-sha-<script>' });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, `${rootPackageVersion()}-dev`);
  assert.ok(!r.text.includes('not-a-sha'));
});

test('GET /health exposes no secret, config, model, deployment id or internal path', () => {
  const r = healthWith({ VERCEL_GIT_COMMIT_SHA: FULL_SHA, ...SENTINELS });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['app', 'status', 'timestamp', 'version']);
  for (const [name, value] of Object.entries(SENTINELS)) {
    assert.ok(!r.text.includes(value), `health leaked ${name}`);
  }
  assert.ok(!/claude|anthropic|model|supabase|stripe|dpl_|vercel/i.test(r.text), `health leaked config: ${r.text}`);
  assert.ok(!r.text.includes(ROOT) && !r.text.includes(ROOT.replace(/\\/g, '/')) && !/backend[\\/]/.test(r.text), 'health leaked an internal path');
  assert.match(r.body.version, /^[0-9a-f]{12}$/);
});
