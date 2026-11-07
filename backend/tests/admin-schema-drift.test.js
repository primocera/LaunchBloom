// Schema-drift guards for the admin cohort + readiness reports.
//
// The fake below behaves like PostgREST: selecting or filtering on a column the
// migrations never created returns an error (which the routes swallow), and
// filters are actually applied to the rows. So a drifted column name shows up
// as a wrong number here instead of a silently-empty report in production.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.ADMIN_EMAILS = 'boss@app.com';

const { stubModule } = require('./helpers');

// Real columns, per migrations 014 + 033 (analytics_events) and 024 (ai_spend_ledger).
const SCHEMA = {
  analytics_events: ['id', 'event', 'user_id', 'workspace_id', 'properties', 'created_at', 'dedupe_key'],
  ai_spend_ledger: ['day', 'reserved', 'used', 'released', 'input_tokens', 'output_tokens', 'estimated_cost_usd', 'updated_at'],
};

const DAY = 24 * 3600 * 1000;
const isoDay = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const isoTs = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const TABLES = {
  analytics_events: [
    { event: 'workspace_created', user_id: 'u1', workspace_id: 'w1', properties: {}, created_at: isoTs(DAY) },
    // Two campaigns in ONE workspace reach three channel types: campaign scope
    // must count 2 (from properties.campaign_id), not 1 (workspace fallback).
    { event: 'three_channel_types_reached', user_id: 'u1', workspace_id: 'w1', properties: { channel_types: 3, campaign_id: 'c1' }, created_at: isoTs(DAY) },
    { event: 'three_channel_types_reached', user_id: 'u1', workspace_id: 'w1', properties: { channel_types: 3, campaign_id: 'c2' }, created_at: isoTs(DAY) },
  ],
  ai_spend_ledger: [
    { day: isoDay(0), estimated_cost_usd: '1.5000' },      // today (numeric comes back as a string)
    { day: isoDay(DAY), estimated_cost_usd: '2.2500' },    // yesterday
    { day: isoDay(3 * DAY), estimated_cost_usd: '100.0000' }, // outside a 24h / 1-day window
  ],
};

const calls = [];

function builder(table) {
  const q = { table, select: null, filters: [], head: false };
  calls.push(q);
  const cols = SCHEMA[table];
  const unknown = (c) => cols && !cols.includes(c);
  const b = {};
  b.select = (s, opts) => { q.select = s; q.head = Boolean(opts && opts.head); return b; };
  for (const op of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte']) {
    b[op] = (col, val) => { q.filters.push({ op, col, val }); return b; };
  }
  b.insert = () => b; // admin_audit writes
  b.not = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.single = () => Promise.resolve({ data: null, error: null });
  b.then = (ok, err) => {
    let result;
    const selected = (q.select || '').split(',').map((s) => s.trim()).filter(Boolean);
    const bad = [...selected, ...q.filters.map((f) => f.col)].find(unknown);
    if (bad) {
      result = { data: null, error: { code: '42703', message: `column ${table}.${bad} does not exist` } };
    } else if (TABLES[table]) {
      const rows = TABLES[table].filter((r) => q.filters.every(({ op, col, val }) => {
        const v = r[col];
        if (op === 'in') return val.includes(v);
        if (op === 'gte') return v != null && v >= val;
        if (op === 'eq') return v === val;
        return true;
      }));
      result = { data: rows, error: null, count: rows.length };
    } else {
      result = { data: [], error: null, count: 0 };
    }
    return Promise.resolve(result).then(ok, err);
  };
  return b;
}

stubModule('lib/supabase.js', {
  from: (t) => builder(t),
  rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }),
  authClient: () => ({ auth: {} }),
  adminClient: () => ({ auth: { admin: {} } }),
});
stubModule('lib/auth.js', {
  requireAuth: (req, _res, next) => { req.userEmail = 'boss@app.com'; req.userId = 'u-boss'; next(); },
  resolveUser: async () => null,
});

const express = require('express');
const request = require('supertest');
const app = express();
app.use(require('../routes/admin'));

test('cohort funnel reads campaign_id from analytics_events.properties', async () => {
  calls.length = 0;
  const r = await request(app).get('/api/admin/cohort?days=30');
  assert.equal(r.status, 200);

  const q = calls.find((c) => c.table === 'analytics_events');
  assert.ok(q, 'cohort must query analytics_events');
  assert.ok(!/\bcampaign_id\b/.test(q.select), 'campaign_id is not a column of analytics_events');
  assert.match(q.select, /\bproperties\b/);

  const steps = Object.fromEntries(r.body.cohort.steps.map((s) => [s.step, s]));
  assert.equal(steps.workspace_created.numerator, 1);
  assert.equal(steps.three_channel_types.numerator, 2, 'two distinct campaigns from properties.campaign_id');
});

test('cohort cost sums ai_spend_ledger.estimated_cost_usd filtered by day', async () => {
  calls.length = 0;
  const wide = await request(app).get('/api/admin/cohort?days=30');
  assert.equal(wide.status, 200);
  assert.equal(wide.body.cost.ai_spend_usd, 103.75);

  const q = calls.find((c) => c.table === 'ai_spend_ledger');
  assert.match(q.select, /\bestimated_cost_usd\b/);
  assert.deepEqual(q.filters.map((f) => [f.op, f.col]), [['gte', 'day']]);
  assert.match(q.filters[0].val, /^\d{4}-\d{2}-\d{2}$/, 'day filter is a YYYY-MM-DD date');

  // 1-day window: includes the UTC day containing `since` (yesterday) + today.
  const narrow = await request(app).get('/api/admin/cohort?days=1');
  assert.equal(narrow.body.cost.ai_spend_usd, 3.75);
});

test('readiness 24h AI spend sums estimated_cost_usd by day and trips the ceiling', async () => {
  const prev = process.env.AI_SPEND_DAILY_CEILING_USD;
  process.env.AI_SPEND_DAILY_CEILING_USD = '3';
  try {
    calls.length = 0;
    const r = await request(app).get('/api/admin/readiness');
    assert.equal(r.status, 200);
    assert.equal(r.body.live.ai_spend_24h_usd, 3.75);
    assert.equal(r.body.live.ai_spend_ceiling_usd, 3);
    assert.equal(r.body.live.spend_over_ceiling, true);

    const q = calls.find((c) => c.table === 'ai_spend_ledger');
    assert.match(q.select, /\bestimated_cost_usd\b/);
    assert.deepEqual(q.filters.map((f) => [f.op, f.col]), [['gte', 'day']]);
  } finally {
    if (prev === undefined) delete process.env.AI_SPEND_DAILY_CEILING_USD;
    else process.env.AI_SPEND_DAILY_CEILING_USD = prev;
  }
});
