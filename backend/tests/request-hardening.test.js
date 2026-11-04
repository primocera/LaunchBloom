// Request-path hardening (2026-11 review):
//   - the AI limiter is keyed by the verified user, not a JWT prefix that every
//     Supabase user shares;
//   - limiters mounted in front of several routers count a request once;
//   - each big-body router's declared JSON limit actually applies;
//   - requireAuth is idempotent within a request;
//   - the workspace e-mail fallback only matches legacy rows (user_id IS NULL).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the AI limiter keys on the verified user id, never a cookie prefix', () => {
  assert.ok(!/sb_access=\(\[\^;\]\+\)/.test(server), 'the JWT-prefix key must be gone');
  assert.match(server, /keyGenerator: \(req\) => \(req\.userId \? `u:\$\{req\.userId\}`/);
  for (const m of server.matchAll(/app\.use\('\/api\/ai',([^)]*)\)/g)) {
    const chain = m[1];
    assert.ok(chain.indexOf('requireAuth') > -1 && chain.indexOf('requireAuth') < chain.indexOf('aiLimit'),
      `requireAuth must run before aiLimit on: ${m[0]}`);
  }
});

test('every mount uses the count-once limiter wrappers', () => {
  assert.ok(!/app\.use\([^)]*\bapiLimiter\b/.test(server), 'mount apiLimit (count-once), not apiLimiter');
  assert.ok(!/app\.use\([^)]*\baiLimiter\b/.test(server), 'mount aiLimit (count-once), not aiLimiter');
});

test('a limiter passed several times in one request counts once', async () => {
  const express = require('express');
  const request = require('supertest');
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({ windowMs: 60000, max: 2, standardHeaders: true, legacyHeaders: false });
  const once = (req, res, next) => { if (req._c) return next(); req._c = true; return limiter(req, res, next); };
  const app = express();
  for (let i = 0; i < 6; i++) app.use(once, express.Router()); // six routers, none match
  app.get('/x', (req, res) => res.json({ ok: true }));
  assert.equal((await request(app).get('/x')).status, 200);
  assert.equal((await request(app).get('/x')).status, 200, 'two requests fit a limit of two');
  assert.equal((await request(app).get('/x')).status, 429);
});

test('big-body routers get their declared JSON limit, everything else 10kb', () => {
  assert.match(server, /\/\^\\\/api\\\/\(assets\|usage\)\(\\\/\|\$\)\/\.test\(p\)\) return jsonAsset/);
  assert.match(server, /\/\^\\\/api\\\/\(campaigns\|playbooks\|templates\|evidence\)\(\\\/\|\$\)\/\.test\(p\)\) return jsonBrief/);
  assert.match(server, /const jsonAsset = express\.json\(\{ limit: '32kb' \}\)/);
  assert.match(server, /const jsonBrief = express\.json\(\{ limit: '16kb' \}\)/);
  assert.match(server, /const jsonDefault = express\.json\(\{ limit: '10kb' \}\)/);
  // Each router still declares the same limit, so the two can never drift silently.
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
  assert.match(read('campaigns.js'), /express\.json\(\{ limit: '16kb' \}\)/);
  assert.match(read('evidence.js'), /express\.json\(\{ limit: '16kb' \}\)/);
  assert.match(read('library.js'), /express\.json\(\{ limit: '32kb' \}\)/);
});

test('requireAuth reuses an identity already resolved in the same request', async () => {
  const { stubModule } = require('./helpers');
  let calls = 0;
  stubModule('lib/supabase.js', {
    authClient: () => ({ auth: { getUser: async () => { calls++; return { data: { user: { id: 'u1', email: 'a@b.com' } }, error: null }; } } }),
    from: () => ({}),
  });
  delete require.cache[require.resolve('../lib/auth')];
  const { requireAuth } = require('../lib/auth');
  const req = { headers: { cookie: 'sb_access=tok' } };
  const res = { status() { return this; }, json() { return this; }, setHeader() {}, getHeader() {} };
  await new Promise((done) => requireAuth(req, res, done));
  await new Promise((done) => requireAuth(req, res, done));
  assert.equal(req.userId, 'u1');
  assert.equal(calls, 1, 'the second requireAuth in one request must not call Supabase again');
});

test('the workspace e-mail fallback only matches legacy rows without a user_id', async () => {
  const { stubModule } = require('./helpers');
  const seen = [];
  const row = { id: 'ws-victim', user_id: 'victim', user_email: 'old@example.com' };
  function builder() {
    const f = { is: {}, eq: {} };
    const b = {
      select: () => b,
      eq: (k, v) => { f.eq[k] = v; return b; },
      is: (k, v) => { f.is[k] = v; return b; },
      single: async () => {
        seen.push(JSON.parse(JSON.stringify(f)));
        const legacyOnly = Object.prototype.hasOwnProperty.call(f.is, 'user_id') && f.is.user_id === null;
        if (f.eq.user_id) return { data: f.eq.user_id === row.user_id ? row : null, error: null };
        if (f.eq.user_email === row.user_email) return { data: legacyOnly && row.user_id !== null ? null : row, error: null };
        return { data: null, error: { code: 'PGRST116' } };
      },
    };
    return b;
  }
  stubModule('lib/supabase.js', { from: builder });
  delete require.cache[require.resolve('../routes/workspaces')];
  const { ownedWorkspace } = require('../routes/workspaces');

  // Attacker registered the victim's previous address; the victim's workspace
  // is already stamped with the victim's user_id.
  const got = await ownedWorkspace('ws-victim', 'old@example.com', 'attacker');
  assert.equal(got, null, 'a stamped workspace must not be reachable through its old e-mail');
  assert.ok(seen.some((f) => f.is.user_id === null), 'the fallback query must filter user_id IS NULL');
});
