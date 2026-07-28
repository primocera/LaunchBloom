const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_URL = 'https://app.example.com';

const { stubModule, makeFakeSupabase } = require('./helpers');

// Configurable auth-client behaviour per test.
const authState = {
  exchangeCode: { data: { session: null }, error: { message: 'x' } },
  signUp: { data: { session: null, user: { id: 'u1' } }, error: null },
  signIn: { data: null, error: { message: 'Invalid', code: 'invalid_credentials' } },
  verifyOtp: { data: { session: null }, error: { message: 'bad' } },
};

const fakeSupabase = makeFakeSupabase({
  // ensureWorkspace resolves this immediately (found by user_id).
  workspaces: { data: { id: 'ws1', user_id: 'u1' }, error: null },
  customers: { data: null, error: null },
  subscriptions: { data: null, error: null },
});
fakeSupabase.authClient = () => ({
  auth: {
    signUp: async () => authState.signUp,
    signInWithPassword: async () => authState.signIn,
    resetPasswordForEmail: async () => ({ error: null }),
    resend: async () => ({ error: null }),
    verifyOtp: async () => authState.verifyOtp,
    exchangeCodeForSession: async () => authState.exchangeCode,
  },
});
fakeSupabase.adminClient = () => ({
  auth: { admin: { signOut: async () => ({}), updateUserById: async () => ({ error: null }) } },
});

stubModule('lib/supabase.js', fakeSupabase);

const express = require('express');
const request = require('supertest');
const authRouter = require('../routes/auth');

const app = express();
app.use(authRouter);

test('signup returns generic success (no account-existence leak)', async () => {
  authState.signUp = { data: { session: null, user: { id: 'u1' } }, error: null };
  const r = await request(app).post('/api/auth/signup').send({ email: 'new@b.com', password: 'password1', acceptTerms: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.requiresVerification, true);
});

test('signup with an existing email still returns generic success', async () => {
  authState.signUp = { data: { user: null }, error: { message: 'User already registered' } };
  const r = await request(app).post('/api/auth/signup').send({ email: 'taken@b.com', password: 'password1', acceptTerms: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.requiresVerification, true);
});

test('signup rejects short passwords', async () => {
  const r = await request(app).post('/api/auth/signup').send({ email: 'a@b.com', password: 'short', acceptTerms: true });
  assert.equal(r.status, 400);
});

test('signup requires accepting the terms', async () => {
  const r = await request(app).post('/api/auth/signup').send({ email: 'a@b.com', password: 'password1' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Terms|Privacy/);
});

test('login with bad credentials is a generic 401', async () => {
  authState.signIn = { data: null, error: { message: 'Invalid login', code: 'invalid_credentials' } };
  const r = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'password1' });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Incorrect email or password/);
});

test('login with unconfirmed email returns 403 EMAIL_NOT_CONFIRMED', async () => {
  authState.signIn = { data: null, error: { message: 'Email not confirmed', code: 'email_not_confirmed' } };
  const r = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'password1' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'EMAIL_NOT_CONFIRMED');
});

test('successful login sets session cookies', async () => {
  authState.signIn = {
    data: {
      session: { access_token: 'AAA', refresh_token: 'RRR' },
      user: { id: 'u1', email: 'a@b.com' },
    },
    error: null,
  };
  const r = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'password1' });
  assert.equal(r.status, 200);
  const cookies = r.headers['set-cookie'] || [];
  assert.ok(cookies.some((c) => c.startsWith('sb_access=') && /HttpOnly/.test(c)));
  assert.ok(cookies.some((c) => c.startsWith('sb_refresh=')));
});

test('forgot-password is always a generic 200', async () => {
  const r = await request(app).post('/api/auth/forgot-password').send({ email: 'whoever@b.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('logout clears cookies', async () => {
  const r = await request(app).post('/api/auth/logout').send({});
  assert.equal(r.status, 200);
  const cookies = r.headers['set-cookie'] || [];
  assert.ok(cookies.some((c) => /sb_access=;/.test(c) && /Max-Age=0/.test(c)));
});

test('callback with a stale link redirects to login with an error', async () => {
  authState.verifyOtp = { data: { session: null }, error: { message: 'expired' } };
  const r = await request(app).get('/api/auth/callback?token_hash=stale&type=signup');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/app\/login\?error=expired_link/);
});

test('callback with a valid signup link sets cookies and redirects to onboarding (v5 P2)', async () => {
  authState.verifyOtp = {
    data: { session: { access_token: 'AAA', refresh_token: 'RRR' } },
    error: null,
  };
  const r = await request(app).get('/api/auth/callback?token_hash=ok&type=signup');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/app\/brand\?welcome=1$/);
  const cookies = r.headers['set-cookie'] || [];
  assert.ok(cookies.some((c) => c.startsWith('sb_access=')));
});

// 2026-07-28 — Supabase's default template sends `{{ .ConfirmationURL }}`, i.e.
// `?code=…` with NO `type`. Every signup consequence used to hang off
// `type === 'signup'`, so on a real deployment a confirmed signup sent no
// welcome email, fired no `verified` event and skipped onboarding. Production
// email_events contained not a single `welcome` row, which is how it surfaced.
test('a PKCE ?code= signup is treated as a signup, not as a plain sign-in', async () => {
  authState.exchangeCode = {
    data: {
      session: {
        access_token: 'AAA',
        refresh_token: 'RRR',
        user: { id: 'u-new', email: 'new@example.com', created_at: new Date().toISOString() },
      },
    },
    error: null,
  };
  const r = await request(app).get('/api/auth/callback?code=abc123');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/app\/brand\?welcome=1$/,
    'a freshly created account must land on Brand Profile onboarding, whichever link form carried it');
});

test('a ?code= sign-in by an established account is not mistaken for a signup', async () => {
  const old = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  authState.exchangeCode = {
    data: {
      session: {
        access_token: 'AAA',
        refresh_token: 'RRR',
        user: { id: 'u-old', email: 'old@example.com', created_at: old },
      },
    },
    error: null,
  };
  const r = await request(app).get('/api/auth/callback?code=abc123');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/app$/, 'an existing account must not be re-onboarded');
});

test('a recovery link is never treated as a signup, whichever form it arrives in', async () => {
  authState.exchangeCode = {
    data: {
      session: {
        access_token: 'AAA',
        refresh_token: 'RRR',
        user: { id: 'u-r', email: 'r@example.com', created_at: new Date().toISOString() },
      },
    },
    error: null,
  };
  const r = await request(app).get('/api/auth/callback?code=abc123&flow=recovery');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/app\/reset-password$/);
});
