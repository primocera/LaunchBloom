const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

// A configurable fake auth client. Tests set `getUserResult` / `refreshResult`
// before calling requireAuth.
const authState = {
  getUserResult: { data: { user: null }, error: { message: 'no' } },
  refreshResult: { data: { session: null, user: null }, error: { message: 'no' } },
};

const fakeAuth = {
  auth: {
    getUser: async () => authState.getUserResult,
    refreshSession: async () => authState.refreshResult,
  },
};

// Stub lib/supabase.js with just what lib/auth.js touches.
stubModule('lib/supabase.js', {
  authClient: () => fakeAuth,
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
});

const { requireAuth } = require('../lib/auth');

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    getHeader: (k) => headers[k],
    setHeader: (k, v) => { headers[k] = v; },
    _cookies: () => {
      const c = headers['Set-Cookie'];
      return Array.isArray(c) ? c : c ? [c] : [];
    },
  };
}

function run(req) {
  return new Promise((resolve) => {
    const res = mockRes();
    const origJson = res.json.bind(res);
    // Resolve when the middleware either calls next() or writes a response.
    res.json = (b) => { origJson(b); resolve({ res, req, nexted: false }); return res; };
    requireAuth(req, res, () => resolve({ res, req, nexted: true }));
  });
}

test('valid access cookie authenticates and sets req.userId/email', async () => {
  authState.getUserResult = { data: { user: { id: 'uuid-1', email: 'User@Example.com' } }, error: null };
  const req = { headers: { cookie: 'sb_access=goodtoken' } };
  const { nexted } = await run(req);
  assert.equal(nexted, true);
  assert.equal(req.userId, 'uuid-1');
  assert.equal(req.userEmail, 'user@example.com');
});

test('no cookies → 401 AUTH and cleared cookies', async () => {
  authState.getUserResult = { data: { user: null }, error: { message: 'no' } };
  const req = { headers: {} };
  const { res, nexted } = await run(req);
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH');
  assert.equal(res._cookies().length, 2); // both expired
});

test('expired access but valid refresh → refreshed session, cookies re-set', async () => {
  authState.getUserResult = { data: { user: null }, error: { message: 'expired' } };
  authState.refreshResult = {
    data: {
      session: { access_token: 'NEW_A', refresh_token: 'NEW_R' },
      user: { id: 'uuid-2', email: 'a@b.com' },
    },
    error: null,
  };
  const req = { headers: { cookie: 'sb_access=old; sb_refresh=validrefresh' } };
  const { res, req: r, nexted } = await run(req);
  assert.equal(nexted, true);
  assert.equal(r.userId, 'uuid-2');
  const cookies = res._cookies();
  assert.ok(cookies.some((c) => c.includes('NEW_A')));
  assert.ok(cookies.some((c) => c.includes('NEW_R')));
});

test('bad access and bad refresh → 401', async () => {
  authState.getUserResult = { data: { user: null }, error: { message: 'no' } };
  authState.refreshResult = { data: { session: null, user: null }, error: { message: 'bad' } };
  const req = { headers: { cookie: 'sb_access=x; sb_refresh=y' } };
  const { res, nexted } = await run(req);
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});
