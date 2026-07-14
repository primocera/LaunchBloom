const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { mockRes } = require('./helpers');
const {
  mintSession,
  sessionEmail,
  requireAuth,
  hashPassword,
  verifyPassword,
} = require('../lib/auth');

test('passwords: hash/verify roundtrip', () => {
  const stored = hashPassword('hunter22');
  assert.notEqual(stored, 'hunter22');
  assert.equal(verifyPassword('hunter22', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  assert.equal(verifyPassword('hunter22', 'garbage'), false);
  assert.equal(verifyPassword('hunter22', null), false);
});

test('sessions: mint/verify roundtrip lowercases email', () => {
  const token = mintSession('User@Example.com');
  assert.equal(sessionEmail(token), 'user@example.com');
});

test('sessions: tampered token is rejected', () => {
  const token = mintSession('a@b.com');
  const [payload, sig] = token.split('.');
  // Forge a different payload with the original signature
  const forged = Buffer.from('evil@b.com|9999999999999').toString('base64url') + '.' + sig;
  assert.equal(sessionEmail(forged), null);
  assert.equal(sessionEmail(payload), null); // missing signature
  assert.equal(sessionEmail('not-a-token'), null);
  assert.equal(sessionEmail(''), null);
});

test('sessions: expired token is rejected', () => {
  // Hand-mint an expired payload with the real secret
  const crypto = require('node:crypto');
  const payload = 'a@b.com|' + (Date.now() - 1000);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  const token = Buffer.from(payload).toString('base64url') + '.' + sig;
  assert.equal(sessionEmail(token), null);
});

test('requireAuth: 401 without/with bad token, passes with valid token', () => {
  const cases = [
    { header: undefined, ok: false },
    { header: 'Bearer garbage', ok: false },
    { header: 'Basic abc', ok: false },
    { header: 'Bearer ' + mintSession('u@x.com'), ok: true },
  ];
  for (const c of cases) {
    const req = { get: () => c.header };
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    if (c.ok) {
      assert.equal(called, true);
      assert.equal(req.userEmail, 'u@x.com');
    } else {
      assert.equal(called, false);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'AUTH');
    }
  }
});
