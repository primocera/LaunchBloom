// Request-flood protection on the endpoints that create accounts or send email:
// a honeypot field, a per-IP signup limit, and per-address limits so a script
// rotating IPs still cannot loop signups for one address or flood an inbox.
// Own file on purpose: the limiters are per-process, so the counts here are
// not disturbed by the other auth tests.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_URL = 'https://app.example.com';
delete process.env.NODE_ENV; // limits are lifted only when NODE_ENV=test

const { stubModule, makeFakeSupabase } = require('./helpers');

const calls = { signUp: 0, reset: 0 };
const fakeSupabase = makeFakeSupabase({});
fakeSupabase.authClient = () => ({
  auth: {
    signUp: async () => { calls.signUp++; return { data: { session: null, user: { id: `u${calls.signUp}` } }, error: null }; },
    resetPasswordForEmail: async () => { calls.reset++; return { error: null }; },
    resend: async () => ({ error: null }),
  },
});
stubModule('lib/supabase.js', fakeSupabase);

const express = require('express');
const request = require('supertest');
const authRouter = require('../routes/auth');

const app = express();
app.set('trust proxy', 1);
app.use(authRouter);

const signup = (body, ip = '203.0.113.1') =>
  request(app).post('/api/auth/signup').set('X-Forwarded-For', ip)
    .send({ password: 'password1', acceptTerms: true, ...body });

test('a filled honeypot gets the normal generic response and creates nothing', async () => {
  const r = await signup({ email: 'bot@example.com', website: 'http://spam.example' }, '198.51.100.9');
  assert.equal(r.status, 201);
  assert.equal(r.body.requiresVerification, true);
  assert.equal(calls.signUp, 0, 'no Supabase account may be created for a honeypot hit');
});

test('one address can only be signed up a few times a day, from any IP', async () => {
  for (const ip of ['203.0.113.10', '203.0.113.11', '203.0.113.12']) {
    const ok = await signup({ email: 'Loop@Example.com' }, ip);
    assert.equal(ok.status, 201);
  }
  const blocked = await signup({ email: 'loop@example.com' }, '203.0.113.13');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after'], '429 must tell the client when to retry');
});

test('one IP can only create a handful of accounts per hour', async () => {
  const ip = '192.0.2.50';
  for (let i = 0; i < 5; i++) {
    assert.equal((await signup({ email: `user${i}@example.com` }, ip)).status, 201);
  }
  const blocked = await signup({ email: 'user5@example.com' }, ip);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('password-reset mail to one address is capped, so nobody can flood an inbox', async () => {
  const send = (ip) => request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', ip)
    .send({ email: 'victim@example.com' });
  for (const ip of ['192.0.2.60', '192.0.2.61', '192.0.2.62']) assert.equal((await send(ip)).status, 200);
  const blocked = await send('192.0.2.63');
  assert.equal(blocked.status, 429);
  assert.equal(calls.reset, 3, 'the capped request must not reach Supabase');
});
