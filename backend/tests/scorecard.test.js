// Playbook v6 Prompt 10 — the scorecard computes real cohorts with
// numerator/denominator/window and reconciles to a known fixture.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'admin@app.com';
process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

// Fixture: u1 activates fast and retains; u2 signs up but never saves;
// u3 activates but slowly (26h — NOT activation); u1 converts a trial.
const EVENTS = [
  { event: 'signup_started', user_id: 'u1', created_at: iso(20 * DAY) },
  { event: 'signup_completed', user_id: 'u1', created_at: iso(20 * DAY) },
  { event: 'first_asset_saved', user_id: 'u1', created_at: iso(20 * DAY - 10 * 60 * 1000) }, // +10 min
  { event: 'first_generation', user_id: 'u1', created_at: iso(14 * DAY) }, // day 6 → D7 retained
  { event: 'trial_started', user_id: 'u1', created_at: iso(19 * DAY) },
  { event: 'subscription_activated', user_id: 'u1', created_at: iso(16 * DAY) },

  { event: 'signup_started', user_id: 'u2', created_at: iso(15 * DAY) },
  { event: 'signup_completed', user_id: 'u2', created_at: iso(15 * DAY) },

  { event: 'signup_completed', user_id: 'u3', created_at: iso(12 * DAY) },
  { event: 'first_asset_saved', user_id: 'u3', created_at: iso(12 * DAY - 26 * 3600 * 1000) }, // +26h → not activated

  { event: 'subscription_canceled', user_id: 'u9', created_at: iso(2 * DAY), properties: { reason: 'too_expensive' } },
];

function builder(table) {
  const b = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'lte', 'order', 'limit']) b[m] = () => b;
  let filtered = null;
  b.in = (_col, events) => { filtered = EVENTS.filter((e) => events.includes(e.event)); return b; };
  b.gte = () => b;
  b.single = () => Promise.resolve({ data: null, error: null });
  b.then = (ok, err) => {
    if (table === 'analytics_events') {
      return Promise.resolve({ data: (filtered || EVENTS).map((e) => ({ properties: {}, ...e })) }).then(ok, err);
    }
    if (table === 'usage_events') {
      // 97 succeeded / 3 released
      return Promise.resolve({ count: b.__status === 'succeeded' ? 97 : 3 }).then(ok, err);
    }
    return Promise.resolve({ data: null, error: null, count: 0 }).then(ok, err);
  };
  const origEq = b.eq;
  b.eq = (col, val) => { if (col === 'status') b.__status = val; return origEq(); };
  return b;
}

const fakeSupabase = {
  from: (t) => builder(t),
  authClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin', email: 'admin@app.com' } }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  }),
  adminClient: () => ({ auth: { admin: {} } }),
};
stubModule('lib/supabase.js', fakeSupabase);

const express = require('express');
const request = require('supertest');
const adminRouter = require('../routes/admin');

const app = express();
app.use(adminRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('scorecard reconciles to the fixture with numerator/denominator/window', async () => {
  const r = await request(app).get('/api/admin/scorecard?days=30').set(...AUTHED);
  assert.equal(r.status, 200);
  const m = r.body.metrics;

  assert.equal(r.body.window.days, 30);
  assert.ok(r.body.window.since && r.body.window.until);

  // 3 signups completed; only u1 activated within 24h.
  assert.equal(m.signups_completed.value, 3);
  assert.equal(m.activation.numerator, 1);
  assert.equal(m.activation.denominator, 3);
  assert.equal(m.activation.value, 33.3);

  // TTFV median = 10 minutes (only activated users count).
  assert.equal(m.time_to_first_value_minutes.value, 10);

  // 1 trial, 1 converted.
  assert.equal(m.trial_conversion.numerator, 1);
  assert.equal(m.trial_conversion.denominator, 1);

  // D7: u1/u2/u3 all signed up ≥9 days ago; only u1 had a day 5–9 event.
  assert.equal(m.d7_retention.denominator, 3);
  assert.equal(m.d7_retention.numerator, 1);

  // Generation success 97/(97+3).
  assert.equal(m.generation_success.numerator, 97);
  assert.equal(m.generation_success.denominator, 100);
  assert.equal(m.generation_success.value, 97);

  assert.deepEqual(m.cancellation_reasons, { too_expensive: 1 });
});

test('scorecard requires admin', async () => {
  const fake2 = { ...fakeSupabase };
  const prev = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'someoneelse@app.com';
  try {
    const r = await request(app).get('/api/admin/scorecard').set(...AUTHED);
    assert.equal(r.status, 403);
  } finally {
    process.env.ADMIN_EMAILS = prev;
  }
});
