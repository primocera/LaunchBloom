// ---------------------------------------------------------------------------
// Audit S1 (2026-11-15): rate limits that hold on serverless.
//
//   - the auth limiters count in one shared Postgres counter (migration 043),
//     so two instances see the same total; keys are hashed, never raw emails
//   - until 043 is applied, or when the database is unreachable, they count in
//     memory as before (sign-in never fails because of a limiter)
//   - the general API limit is keyed by the signed-in user, not the office IP
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { stubModule } = require('./helpers');

// rate_limit_hit() with the migration's fixed-window semantics.
const table = new Map(); // key -> { hits, reset_at }
const rpcCalls = [];
let rpcMode = 'ok'; // 'ok' | 'missing' | 'down'
stubModule('lib/supabase.js', {
  rpc: async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (rpcMode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rate_limit_hit' } };
    if (rpcMode === 'down') return { data: null, error: { code: '08006', message: 'connection failure' } };
    const now = Date.now();
    const row = table.get(args.p_key);
    if (!row || row.reset_at <= now) table.set(args.p_key, { hits: 1, reset_at: now + args.p_window_ms });
    else row.hits += 1;
    const r = table.get(args.p_key);
    return { data: [{ hits: r.hits, reset_at: new Date(r.reset_at).toISOString() }], error: null };
  },
  from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
});

const { PostgresStore, claimedUserId } = require('../lib/rate-limit-store');

function freshStore(name = 'auth_login') {
  const s = new PostgresStore(name);
  s.init({ windowMs: 15 * 60 * 1000 });
  return s;
}
function reset(mode = 'ok') {
  table.clear();
  rpcCalls.length = 0;
  rpcMode = mode;
}

test('S1: two instances share one counter', async () => {
  reset();
  const instanceA = freshStore();
  const instanceB = freshStore();
  assert.equal((await instanceA.increment('ip:203.0.113.7')).totalHits, 1);
  assert.equal((await instanceB.increment('ip:203.0.113.7')).totalHits, 2);
  assert.equal((await instanceA.increment('ip:203.0.113.7')).totalHits, 3);
  const r = await instanceB.increment('ip:203.0.113.7');
  assert.ok(r.resetTime instanceof Date && r.resetTime > new Date());
});

test('S1: limiters with the same client key keep separate counters', async () => {
  reset();
  await freshStore('auth_signup_email').increment('e:a@example.com');
  const other = await freshStore('auth_email_send').increment('e:a@example.com');
  assert.equal(other.totalHits, 1);
});

test('S1: no email address or IP is sent to the database', async () => {
  reset();
  await freshStore('auth_email_send').increment('e:someone@example.com');
  const sent = rpcCalls[0].args.p_key;
  assert.match(sent, /^[0-9a-f]{64}$/);
  assert.ok(!sent.includes('example.com'));
});

test('S1: before migration 043 the limiter counts in memory and stops asking', async () => {
  reset('missing');
  const s = freshStore();
  assert.equal((await s.increment('ip:1')).totalHits, 1);
  assert.equal((await s.increment('ip:1')).totalHits, 2);
  assert.equal(rpcCalls.length, 1, 'a missing function is detected once');
});

test('S1: a database outage never blocks sign-in; it counts in memory', async () => {
  reset('down');
  const s = freshStore();
  const r = await s.increment('ip:1');
  assert.equal(r.totalHits, 1);
  rpcMode = 'ok';
  // Recovers on the next request (an outage is not "missing").
  assert.equal((await s.increment('ip:1')).totalHits, 1);
  assert.equal(rpcCalls.length, 2);
});

test('S1: migration 043 keeps the counter table off the public API', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '043_rate_limit_hits.sql'), 'utf8');
  assert.match(sql, /alter table public\.rate_limit_hits enable row level security/);
  assert.match(sql, /revoke execute on function public\.rate_limit_hit\(text, integer\) from public, anon, authenticated/);
});

test('S1: every auth limiter uses the shared store', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  for (const name of ['loginLimiter', 'signupIpLimiter', 'signupEmailLimiter', 'emailSendLimiter']) {
    const def = new RegExp(`const ${name} = rateLimit\\(\\{\\s*store: new PostgresStore\\('`);
    assert.match(src, def, `${name} must use PostgresStore`);
  }
});

// ── the general limiter key ─────────────────────────────────────────────────

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (payload) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

test('S1: colleagues behind one office IP get separate general-limit keys', () => {
  const a = claimedUserId({ headers: { cookie: `theme=x; sb_access=${token({ sub: USER_A })}` } });
  const b = claimedUserId({ headers: { cookie: `sb_access=${token({ sub: USER_B })}; sb_refresh=r` } });
  assert.equal(a, USER_A);
  assert.equal(b, USER_B);
});

test('S1: no cookie, a malformed token or a non-uuid subject falls back to the IP key', () => {
  assert.equal(claimedUserId({ headers: {} }), null);
  assert.equal(claimedUserId({ headers: { cookie: 'sb_access=not-a-jwt' } }), null);
  assert.equal(claimedUserId({ headers: { cookie: `sb_access=${token({ sub: 'admin' })}` } }), null);
  assert.equal(claimedUserId({ headers: { cookie: 'sb_access=a.%%%.c' } }), null);
});

test('S1: server.js keys the general limiter by user and mounts the IP backstop once', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const userId = claimedUserId\(req\);\s*return userId \? `u:\$\{userId\}` : `ip:\$\{req\.ip\}`;/);
  const mounts = src.split(/\r?\n/).filter((l) => /^\s*app\.use\(.*ipBackstopLimiter/.test(l));
  assert.deepEqual(mounts.map((l) => l.trim()), ["app.use('/api', ipBackstopLimiter);"]);
  assert.ok(src.indexOf("app.use('/api/webhooks', webhookRouter);") < src.indexOf("app.use('/api', ipBackstopLimiter);"),
    'Stripe webhooks are not limited by the backstop');
});
