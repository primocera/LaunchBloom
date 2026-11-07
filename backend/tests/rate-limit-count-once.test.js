// A request is never counted twice against the same rate limiter.
//
// server.js mounts the /api/ai chain (apiLimit, requireAuth, aiLimit, ...)
// twice - once for routes/ai.js and once for routes/assets.js - and puts
// apiLimit in front of every later router. A request that falls through the
// first /api/ai mount (the asset studios, /api/ai/asset/:table/:id/rewrite in
// routes/library.js, or any unknown path) therefore passes those limiters
// several times. countOnce() must make each limiter count it exactly once.
//
// Two layers:
//   1. Source contract on server.js (no raw limiter mounted anywhere).
//   2. The REAL server.js app, booted with Supabase stubbed and
//      express-rate-limit wrapped so every store increment is counted per
//      limiter. Requests are sent through supertest and the increments, plus
//      the RateLimit-Remaining header, are asserted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-unit-tests';
delete process.env.ANTHROPIC_API_KEY; // never reach a real model
delete process.env.E2E_SEED_ENABLED;
delete process.env.SERVE_APP;

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const server = fs.readFileSync(SERVER_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 1. Source contract
// ---------------------------------------------------------------------------

/** Every `app.use(...)` call in server.js, with its 1-based line number. */
function appUseCalls(src) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*app\.use\(/.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

test('server.js: no app.use mounts a raw apiLimiter / aiLimiter', () => {
  const uses = appUseCalls(server);
  assert.ok(uses.length > 10, 'expected to find the app.use mounts in server.js');
  for (const u of uses) {
    assert.ok(!/\bapiLimiter\b/.test(u.text), `server.js:${u.line} mounts raw apiLimiter: ${u.text}`);
    assert.ok(!/\baiLimiter\b/.test(u.text), `server.js:${u.line} mounts raw aiLimiter: ${u.text}`);
  }
});

test('server.js: raw limiters are referenced only by their definition and countOnce wrapper', () => {
  // Code only: comments may mention the raw limiters by name.
  const code = server.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refs = (name) => (code.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
  // `const apiLimiter = rateLimit(` + `countOnce(apiLimiter, ...)` = 2, likewise aiLimiter.
  assert.equal(refs('apiLimiter'), 2, 'apiLimiter may only be defined and wrapped by countOnce');
  assert.equal(refs('aiLimiter'), 2, 'aiLimiter may only be defined and wrapped by countOnce');
  assert.match(server, /const apiLimit = countOnce\(apiLimiter, '_apiLimitCounted'\);/);
  assert.match(server, /const aiLimit = countOnce\(aiLimiter, '_aiLimitCounted'\);/);
  // countOnce itself: skip when flagged, otherwise flag then count.
  assert.match(server, /if \(req\[flag\]\) return next\(\);\s*req\[flag\] = true;\s*return limiter\(req, res, next\);/);
});

test('server.js: paymentLimiter is mounted exactly once, on /api/payments only', () => {
  const uses = appUseCalls(server).filter((u) => /\bpaymentLimiter\b/.test(u.text));
  assert.equal(uses.length, 1, `paymentLimiter must be mounted once, found: ${uses.map((u) => u.line).join(', ')}`);
  assert.match(uses[0].text, /^app\.use\('\/api\/payments',/);
  // It is not countOnce-wrapped, so it must also appear exactly once in that chain.
  assert.equal((uses[0].text.match(/\bpaymentLimiter\b/g) || []).length, 1);
});

test('server.js: each mount chain names each limiter at most once', () => {
  for (const u of appUseCalls(server)) {
    for (const name of ['apiLimit', 'aiLimit', 'paymentLimiter']) {
      const n = (u.text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      assert.ok(n <= 1, `server.js:${u.line} lists ${name} ${n} times: ${u.text}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Behaviour on the real server.js app
// ---------------------------------------------------------------------------

const hits = { api: 0, ai: 0, payment: 0, other: 0 };
function resetHits() { for (const k of Object.keys(hits)) hits[k] = 0; }

function limiterName(opts) {
  const msg = (opts && opts.message && opts.message.error) || '';
  if (msg.startsWith('Too many requests')) return 'api';
  if (msg.startsWith('Too many payment')) return 'payment';
  if (msg.startsWith('AI generation')) return 'ai';
  return 'other';
}

let app;
function loadApp() {
  if (app) return app;
  const { stubModule, makeFakeSupabase } = require('./helpers');

  // Wrap express-rate-limit: real limiter, but its MemoryStore increments are
  // counted per limiter, so a second count of the same request is visible.
  const realRl = require('express-rate-limit');
  const real = realRl.rateLimit || realRl;
  const wrapped = (opts = {}) => {
    const name = limiterName(opts);
    const inner = new realRl.MemoryStore();
    const store = {
      localKeys: true,
      init: (o) => inner.init(o),
      get: (k) => inner.get(k),
      increment: async (k) => { hits[name] += 1; return inner.increment(k); },
      decrement: (k) => inner.decrement(k),
      resetKey: (k) => inner.resetKey(k),
      resetAll: () => inner.resetAll(),
      shutdown: () => inner.shutdown(),
    };
    return real({ ...opts, store, validate: false });
  };
  wrapped.rateLimit = wrapped;
  wrapped.default = wrapped;
  wrapped.MemoryStore = realRl.MemoryStore;
  const rlPath = require.resolve('express-rate-limit', { paths: [path.dirname(SERVER_PATH)] });
  require.cache[rlPath] = { id: rlPath, filename: rlPath, loaded: true, exports: wrapped };

  // Supabase: no network; any sb_access cookie is a signed-in user.
  const fake = makeFakeSupabase({
    workspaces: { data: { id: '33333333-3333-4333-8333-333333333333', user_id: '11111111-1111-4111-8111-111111111111' }, error: null },
  });
  fake.authClient = () => ({
    auth: {
      getUser: async (tok) => (tok
        ? { data: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'count-once@example.com' } }, error: null }
        : { data: { user: null }, error: { message: 'no session' } }),
      refreshSession: async () => ({ data: {}, error: { message: 'no refresh' } }),
    },
  });
  stubModule('lib/supabase.js', fake);

  app = require(SERVER_PATH);
  return app;
}

const AUTH = 'sb_access=test-token';

async function send(method, url, { auth = true, body } = {}) {
  const request = require('supertest');
  let r = request(loadApp())[method](url);
  if (auth) r = r.set('Cookie', AUTH);
  if (body) r = r.send(body);
  return r;
}

/** Hits recorded by one request, plus its response. */
async function hitsFor(method, url, opts) {
  resetHits();
  const res = await send(method, url, opts);
  return { res, counted: { ...hits } };
}

test('an unknown /api/ai path passes both /api/ai mounts and every apiLimit mount, counted once each', async () => {
  const { res, counted } = await hitsFor('get', '/api/ai/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.equal(counted.api, 1, 'apiLimiter must count the request exactly once');
  assert.equal(counted.ai, 1, 'aiLimiter must count the request exactly once');
  assert.equal(counted.payment, 0);
});

test('a first-mount AI route (routes/ai.js) counts api and ai once each', async () => {
  const { counted } = await hitsFor('post', '/api/ai/generate-positioning', { body: {} });
  assert.deepEqual({ api: counted.api, ai: counted.ai, payment: counted.payment }, { api: 1, ai: 1, payment: 0 });
});

test('a second-mount studio route (routes/assets.js) counts api and ai once each', async () => {
  for (const route of ['generate-website-kit', 'generate-email-flow', 'generate-social-assets']) {
    const { counted } = await hitsFor('post', `/api/ai/${route}`, { body: {} });
    assert.equal(counted.api, 1, `${route}: apiLimiter counted ${counted.api} times`);
    assert.equal(counted.ai, 1, `${route}: aiLimiter counted ${counted.ai} times`);
    assert.equal(counted.payment, 0);
  }
});

test('the Library AI rewrite (/api/ai/asset/... in routes/library.js) counts api and ai once each', async () => {
  const { counted } = await hitsFor(
    'post',
    '/api/ai/asset/website_pages/22222222-2222-4222-8222-222222222222/rewrite',
    { body: { mode: 'shorter' } },
  );
  assert.equal(counted.api, 1, `apiLimiter counted ${counted.api} times`);
  assert.equal(counted.ai, 1, `aiLimiter counted ${counted.ai} times`);
  assert.equal(counted.payment, 0);
});

test('an unauthenticated /api/ai request counts apiLimiter once and never reaches aiLimiter', async () => {
  const { res, counted } = await hitsFor('post', '/api/ai/generate-website-kit', { auth: false, body: {} });
  assert.equal(res.status, 401);
  assert.equal(counted.api, 1);
  assert.equal(counted.ai, 0);
});

test('non-AI routes count apiLimiter once and never touch aiLimiter', async () => {
  for (const [method, url] of [
    ['get', '/api/assets/library'], // routes/library.js, mounted last among the apiLimit routers
    ['get', '/api/nope-not-a-route'], // falls through every apiLimit mount
    ['get', '/api/plans'],
  ]) {
    const { counted } = await hitsFor(method, url);
    assert.equal(counted.api, 1, `${method.toUpperCase()} ${url}: apiLimiter counted ${counted.api} times`);
    assert.equal(counted.ai, 0, `${method.toUpperCase()} ${url}: aiLimiter must not count`);
    assert.equal(counted.payment, 0);
  }
});

test('/api/payments counts apiLimiter and paymentLimiter once each', async () => {
  const { counted } = await hitsFor('post', '/api/payments/create-checkout-session', { body: {} });
  assert.equal(counted.api, 1);
  assert.equal(counted.payment, 1);
  assert.equal(counted.ai, 0);
});

test('RateLimit-Remaining drops by exactly one per request through a double mount', async () => {
  // On /api/ai the last limiter to run (aiLimiter) owns the RateLimit-* headers.
  const remaining = (res) => Number(res.headers['ratelimit-remaining']);
  const a = await send('post', '/api/ai/generate-website-kit', { body: {} });
  const b = await send('post', '/api/ai/generate-website-kit', { body: {} });
  assert.ok(Number.isFinite(remaining(a)), 'RateLimit-Remaining header expected on /api/ai');
  assert.equal(remaining(a) - remaining(b), 1, 'one studio request must cost exactly one AI-limit unit');

  // On a non-AI route only apiLimiter runs, so the header is apiLimiter's.
  const c = await send('get', '/api/nope-not-a-route');
  const d = await send('get', '/api/nope-not-a-route');
  assert.ok(Number.isFinite(remaining(c)), 'RateLimit-Remaining header expected on /api');
  assert.equal(remaining(c) - remaining(d), 1, 'one request must cost exactly one API-limit unit');
});
