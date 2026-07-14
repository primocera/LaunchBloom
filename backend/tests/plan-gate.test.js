const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// Stateful supabase: a real usage_events ledger; workspaces get-or-create
// returns a fixed workspace; customers/subscriptions empty (lifetime window).
function makeLedgerSupabase() {
  const events = [];

  function builder(table) {
    const st = { table, op: 'select', head: false, filters: {}, ins: null, minCreated: null };
    const api = {
      select(_cols, opts) { if (opts && opts.head) st.head = true; return api; },
      insert(p) { st.op = 'insert'; st.ins = p; return api; },
      update(p) { st.op = 'update'; st.ins = p; return api; },
      upsert(p) { st.op = 'upsert'; st.ins = p; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      neq() { return api; },
      in(k, vs) { st.filters['__in_' + k] = vs; return api; },
      is(k, v) { st.filters[k] = v; return api; },
      gte(_k, v) { st.minCreated = v; return api; },
      order() { return api; },
      limit() { return api; },
      single() { return Promise.resolve(resolveSingle(st)); },
      then(res, rej) { return Promise.resolve(resolveList(st)).then(res, rej); },
    };
    return api;
  }

  function matchEvent(e, st) {
    if (st.filters.workspace_id && e.workspace_id !== st.filters.workspace_id) return false;
    if (st.filters.feature && e.feature !== st.filters.feature) return false;
    if (st.filters.id && e.id !== st.filters.id) return false;
    const statuses = st.filters.__in_status;
    if (statuses && !statuses.includes(e.status)) return false;
    return true;
  }

  function resolveSingle(st) {
    if (st.table === 'usage_events' && st.op === 'insert') {
      const row = { id: 'ue-' + (events.length + 1), status: 'reserved', created_at: new Date().toISOString(), ...st.ins };
      events.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (st.table === 'workspaces') {
      if (st.op === 'insert' || st.op === 'upsert') return { data: { id: 'ws1', user_id: st.ins.user_id }, error: null };
      return { data: null, error: { code: 'PGRST116' } }; // get-or-create: none found → insert path
    }
    if (st.table === 'customers' || st.table === 'subscriptions') return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: { code: 'PGRST116' } };
  }

  function resolveList(st) {
    if (st.table === 'usage_events') {
      if (st.op === 'update') {
        for (const e of events) if (matchEvent(e, st)) Object.assign(e, st.ins);
        return { data: null, error: null };
      }
      if (st.head) {
        const count = events.filter((e) => matchEvent(e, st)).length;
        return { count, error: null };
      }
    }
    return { data: null, error: null };
  }

  return { from: builder, _events: events, storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
    authClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'me@app.com' } }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
    } }) };
}

const ledger = makeLedgerSupabase();
stubModule('lib/supabase.js', ledger);

// Fixed plan for the caller.
const customers = require('../routes/customers');
let currentPlan = 'trial';
customers.planFor = async () => currentPlan;

const { planGate } = require('../lib/plan-limits');

const express = require('express');
const request = require('supertest');

function appWith(handler, feature = 'positioning') {
  const app = express();
  app.use(express.json());
  app.post('/gen', planGate(feature), handler);
  return app;
}

const AUTHED = ['Cookie', 'sb_access=tok'];

test('a successful generation reserves then finalizes one action', async () => {
  ledger._events.length = 0;
  currentPlan = 'trial';
  const app = appWith((req, res) => res.json({ ok: true }));
  const r = await request(app).post('/gen').set(...AUTHED).send({});
  assert.equal(r.status, 200);
  // one event, finalized to succeeded (the finish hook runs after the response)
  await new Promise((res) => setImmediate(res));
  assert.equal(ledger._events.length, 1);
  assert.equal(ledger._events[0].status, 'succeeded');
});

test('a failed generation releases the reservation (no quota consumed)', async () => {
  ledger._events.length = 0;
  currentPlan = 'trial';
  const app = appWith((req, res) => res.status(500).json({ error: 'boom' }));
  const r = await request(app).post('/gen').set(...AUTHED).send({});
  assert.equal(r.status, 500);
  await new Promise((res) => setImmediate(res));
  assert.equal(ledger._events[0].status, 'failed');
});

test('at the action limit the gate blocks with 402 UPGRADE', async () => {
  ledger._events.length = 0;
  currentPlan = 'trial'; // 20 actions
  // Pre-fill 20 succeeded actions for the workspace.
  for (let i = 0; i < 20; i++) {
    ledger._events.push({ id: 'seed-' + i, workspace_id: 'ws1', feature: 'positioning', status: 'succeeded', created_at: new Date().toISOString() });
  }
  const app = appWith((req, res) => res.json({ ok: true }));
  const r = await request(app).post('/gen').set(...AUTHED).send({});
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'UPGRADE');
});

test('free plan (0 actions) is blocked immediately', async () => {
  ledger._events.length = 0;
  currentPlan = 'free';
  const app = appWith((req, res) => res.json({ ok: true }));
  const r = await request(app).post('/gen').set(...AUTHED).send({});
  assert.equal(r.status, 402);
});
