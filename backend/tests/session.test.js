const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readCookie,
  setSessionCookies,
  clearSessionCookies,
  readAccessToken,
  readRefreshToken,
} = require('../lib/session');

/** Minimal res mock recording Set-Cookie headers. */
function mockRes() {
  const headers = {};
  return {
    getHeader: (k) => headers[k],
    setHeader: (k, v) => { headers[k] = v; },
    _cookies: () => {
      const c = headers['Set-Cookie'];
      return Array.isArray(c) ? c : c ? [c] : [];
    },
  };
}

test('readCookie parses a cookie header', () => {
  const req = { headers: { cookie: 'a=1; sb_access=tok%20en; b=2' } };
  assert.equal(readCookie(req, 'sb_access'), 'tok en'); // url-decoded
  assert.equal(readCookie(req, 'a'), '1');
  assert.equal(readCookie(req, 'missing'), null);
  assert.equal(readCookie({ headers: {} }, 'x'), null);
});

test('readAccessToken/readRefreshToken pull the right cookies', () => {
  const req = { headers: { cookie: 'sb_access=AAA; sb_refresh=RRR' } };
  assert.equal(readAccessToken(req), 'AAA');
  assert.equal(readRefreshToken(req), 'RRR');
});

test('setSessionCookies writes HttpOnly SameSite cookies for both tokens', () => {
  const res = mockRes();
  setSessionCookies(res, { access_token: 'AAA', refresh_token: 'RRR' });
  const cookies = res._cookies();
  assert.equal(cookies.length, 2);
  const access = cookies.find((c) => c.startsWith('sb_access='));
  const refresh = cookies.find((c) => c.startsWith('sb_refresh='));
  assert.ok(access.includes('AAA'));
  assert.ok(refresh.includes('RRR'));
  for (const c of cookies) {
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Max-Age=\d+/);
    assert.match(c, /Path=\//);
  }
});

test('setSessionCookies is a no-op without a full session', () => {
  const res = mockRes();
  setSessionCookies(res, { access_token: 'only-access' });
  assert.equal(res._cookies().length, 0);
});

test('Secure flag depends on NODE_ENV=production', () => {
  const prev = process.env.NODE_ENV;

  process.env.NODE_ENV = 'development';
  let res = mockRes();
  setSessionCookies(res, { access_token: 'A', refresh_token: 'R' });
  assert.ok(!res._cookies()[0].includes('Secure'));

  process.env.NODE_ENV = 'production';
  res = mockRes();
  setSessionCookies(res, { access_token: 'A', refresh_token: 'R' });
  assert.ok(res._cookies()[0].includes('Secure'));

  process.env.NODE_ENV = prev;
});

test('clearSessionCookies expires both cookies', () => {
  const res = mockRes();
  clearSessionCookies(res);
  const cookies = res._cookies();
  assert.equal(cookies.length, 2);
  for (const c of cookies) assert.match(c, /Max-Age=0/);
});
