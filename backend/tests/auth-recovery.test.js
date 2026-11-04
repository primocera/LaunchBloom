// Password reset needs a recovery session, and logout revokes even an idle one.
//
// /reset-password used to accept ANY signed-in session and needed no current
// password, so a stolen cookie could lock the owner out. Only the recovery
// e-mail callback now issues the short-lived signed `sb_recovery` marker, and a
// reset ends every other session. Logout used to revoke with the access token
// only; an idle user's token is expired, so the refresh token stayed valid.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_URL = 'https://app.example.com';
process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');

const USER = { id: 'u-rec', email: 'r@example.com', created_at: '2026-01-01T00:00:00Z' };
const calls = { update: [], signOut: [] };
const state = { accessValid: true };

const fakeSupabase = makeFakeSupabase({});
fakeSupabase.authClient = () => ({
  auth: {
    getUser: async () => (state.accessValid ? { data: { user: USER }, error: null } : { data: null, error: { message: 'expired' } }),
    refreshSession: async () => ({ data: { session: { access_token: 'FRESH', refresh_token: 'R2' }, user: USER }, error: null }),
    exchangeCodeForSession: async () => ({ data: { session: { access_token: 'AAA', refresh_token: 'RRR', user: USER } }, error: null }),
  },
});
fakeSupabase.adminClient = () => ({
  auth: {
    admin: {
      updateUserById: async (id, attrs) => { calls.update.push({ id, attrs }); return { error: null }; },
      signOut: async (token, scope) => {
        calls.signOut.push({ token, scope });
        return token === 'EXPIRED' ? { error: { message: 'invalid JWT' } } : { error: null };
      },
    },
  },
});
stubModule('lib/supabase.js', fakeSupabase);

const express = require('express');
const request = require('supertest');
const authRouter = require('../routes/auth');
const app = express();
app.use(authRouter);

const cookieValue = (res, name) => {
  const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith(`${name}=`));
  return c ? c.split(';')[0] : null;
};

test('a plain session cannot set a new password', async () => {
  const r = await request(app).post('/api/auth/reset-password')
    .set('Cookie', 'sb_access=AAA').send({ password: 'newpassword1' });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'RECOVERY_REQUIRED');
  assert.equal(calls.update.length, 0);
});

test('the recovery link issues the marker, the reset succeeds and other sessions end', async () => {
  const cb = await request(app).get('/api/auth/callback?code=abc&flow=recovery');
  assert.equal(cb.status, 302);
  const marker = cookieValue(cb, 'sb_recovery');
  assert.ok(marker && marker.length > 'sb_recovery='.length, 'the recovery callback must set sb_recovery');
  assert.match((cb.headers['set-cookie'] || []).find((x) => x.startsWith('sb_recovery=')), /HttpOnly/);

  const r = await request(app).post('/api/auth/reset-password')
    .set('Cookie', `sb_access=AAA; ${marker}`).send({ password: 'newpassword1' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.update.at(-1), { id: USER.id, attrs: { password: 'newpassword1' } });
  assert.deepEqual(calls.signOut.at(-1), { token: 'AAA', scope: 'others' });
});

test('a marker issued to another user, or a forged one, is refused', async () => {
  const r = await request(app).post('/api/auth/reset-password')
    .set('Cookie', `sb_access=AAA; sb_recovery=${Math.floor(Date.now() / 1000) + 600}.forged`)
    .send({ password: 'newpassword1' });
  assert.equal(r.status, 401);
});

test('a normal sign-in callback does not issue the marker', async () => {
  const cb = await request(app).get('/api/auth/callback?code=abc');
  assert.equal(cookieValue(cb, 'sb_recovery'), null);
});

test('logout with an expired access token still revokes via the refresh token', async () => {
  calls.signOut.length = 0;
  const r = await request(app).post('/api/auth/logout').set('Cookie', 'sb_access=EXPIRED; sb_refresh=RRR').send({});
  assert.equal(r.status, 200);
  assert.deepEqual(calls.signOut.map((c) => c.token), ['EXPIRED', 'FRESH']);
  assert.equal(calls.signOut.at(-1).scope, 'global');
});
