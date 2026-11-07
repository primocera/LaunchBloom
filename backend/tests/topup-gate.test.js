// ---------------------------------------------------------------------------
// AI-action top-ups at the gate and in the catalog. Added on top of the
// unchanged AI-action model: 1 generation = 1 action, plan limits unchanged.
// Valid packs only raise a PAID plan's limit for the current monthly window.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
// A pack price is configured, so paid plans are offered a top-up.
process.env.STRIPE_PRICE_ACTIONS_40 = 'price_test_40';

const { stubModule } = require('./helpers');

const events = []; // usage_events rows
const topups = []; // valid action_topups rows for the caller

function builder(table) {
  const st = { op: 'select', head: false, payload: null, filters: {} };
  const api = {
    select(_c, opts) { if (opts && opts.head) st.head = true; return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    in(k, v) { st.filters['__in_' + k] = v; return api; },
    is() { return api; },
    gt() { return api; },
    gte() { return api; },
    order() { return api; },
    limit() { return api; },
    single() {
      if (table === 'usage_events' && st.op === 'insert') {
        const row = { id: 'ue-' + (events.length + 1), ...st.payload };
        events.push(row);
        return Promise.resolve({ data: { id: row.id }, error: null });
      }
      if (table === 'workspaces' && st.op !== 'select') return Promise.resolve({ data: { id: 'ws1' }, error: null });
      return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
    },
    then(res, rej) {
      let out = { data: null, error: null };
      if (table === 'usage_events') {
        const match = (e) => (!st.filters.id || e.id === st.filters.id)
          && (!st.filters.feature || e.feature === st.filters.feature)
          && (!st.filters.__in_status || st.filters.__in_status.includes(e.status));
        if (st.op === 'update') { for (const e of events) if (match(e)) Object.assign(e, st.payload); }
        else if (st.head) out = { count: events.filter(match).length, error: null };
      }
      if (table === 'action_topups') out = { data: topups.slice(), error: null };
      return Promise.resolve(out).then(res, rej);
    },
  };
  return api;
}

stubModule('lib/supabase.js', {
  from: builder,
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  authClient: () => ({ auth: {
    getUser: async () => ({ data: { user: { id: 'user-1', email: 'me@app.com' } }, error: null }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
  } }),
});

const customers = require('../routes/customers');
let currentPlan = 'starter';
customers.planFor = async () => currentPlan;

const { planGate, usageFor, canBuyTopup, topupPlan, PLAN_LIMITS } = require('../lib/plan-limits');
const { publicCatalog, TOPUP_PACKS, PRICES } = require('../lib/plan-catalog');
const express = require('express');
const request = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.post('/gen', planGate('positioning'), (req, res) => res.json({ ok: true }));
  a.post('/kit', planGate('launch_kits'), (req, res) => res.json({ ok: true }));
  return a;
}
const AUTHED = ['Cookie', 'sb_access=tok'];

function useActions(n) {
  events.length = 0;
  for (let i = 0; i < n; i++) events.push({ id: 's' + i, feature: 'positioning', status: 'succeeded' });
}

test('only paying subscribers can buy top-ups (monthly or yearly alike)', () => {
  for (const p of ['starter', 'pro', 'studio', 'business']) {
    assert.equal(topupPlan(p), true, p);
    assert.equal(canBuyTopup(p), true, p);
  }
  for (const p of ['trial', 'free', null, undefined]) {
    assert.equal(topupPlan(p), false, String(p));
    assert.equal(canBuyTopup(p), false, String(p));
  }
});

test('with no pack price configured nothing is offered, so the upgrade path stays', () => {
  const saved = process.env.STRIPE_PRICE_ACTIONS_40;
  delete process.env.STRIPE_PRICE_ACTIONS_40;
  try {
    assert.equal(canBuyTopup('pro'), false);
    assert.equal(topupPlan('pro'), true, 'packs already bought still count at the gate');
  } finally {
    process.env.STRIPE_PRICE_ACTIONS_40 = saved;
  }
});

test('the plan limits themselves are unchanged by top-ups', () => {
  assert.equal(PLAN_LIMITS.trial.ai_actions, 20);
  assert.equal(PLAN_LIMITS.starter.ai_actions, 30);
  assert.equal(PLAN_LIMITS.pro.ai_actions, 120);
  assert.equal(PLAN_LIMITS.studio.ai_actions, 400);
});

test('a paid plan at its limit is blocked and offered a top-up', async () => {
  currentPlan = 'starter';
  useActions(30);
  topups.length = 0;
  const r = await request(app()).post('/gen').set(...AUTHED).send({});
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'UPGRADE');
  assert.equal(r.body.can_buy_topup, true);
});

test('valid top-up actions let a paid plan keep generating past its limit', async () => {
  currentPlan = 'starter';
  useActions(30);
  topups.length = 0;
  topups.push({ actions: 40 });
  try {
    const r = await request(app()).post('/gen').set(...AUTHED).send({});
    assert.equal(r.status, 200);
    useActions(70); // 30 plan + 40 top-up all used
    const r2 = await request(app()).post('/gen').set(...AUTHED).send({});
    assert.equal(r2.status, 402);
  } finally {
    topups.length = 0;
  }
});

test('top-ups never apply to a trial, and a trial is not offered one', async () => {
  currentPlan = 'trial';
  useActions(20);
  topups.push({ actions: 40 });
  try {
    const r = await request(app()).post('/gen').set(...AUTHED).send({});
    assert.equal(r.status, 402);
    assert.equal(r.body.can_buy_topup, false);
  } finally {
    topups.length = 0;
  }
});

test('a launch-kit request blocked by the ACTION pool is offered a top-up', async () => {
  currentPlan = 'starter';
  useActions(30); // pool full, no kits used yet
  topups.length = 0;
  const r = await request(app()).post('/kit').set(...AUTHED).send({});
  assert.equal(r.status, 402);
  assert.equal(r.body.can_buy_topup, true);
});

test('a launch-kit sub-cap block does not offer a top-up (packs do not add kits)', async () => {
  currentPlan = 'starter';
  events.length = 0;
  for (let i = 0; i < 3; i++) events.push({ id: 'k' + i, feature: 'launch_kits', status: 'succeeded' });
  const r = await request(app()).post('/kit').set(...AUTHED).send({});
  assert.equal(r.status, 402);
  assert.equal(r.body.feature, 'launch_kits');
  assert.equal(r.body.can_buy_topup, false);
});

test('usageFor reports valid top-up actions separately; zero for a trial', async () => {
  topups.length = 0;
  topups.push({ actions: 40 }, { actions: 100 });
  try {
    useActions(0);
    const paid = await usageFor('ws1', 'pro', 'me@app.com', 'user-1');
    assert.equal(paid.ai_actions_extra, 140);
    const trial = await usageFor('ws1', 'trial', 'me@app.com', 'user-1');
    assert.equal(trial.ai_actions_extra ?? 0, 0);
  } finally {
    topups.length = 0;
  }
});

test('catalog offers only configured packs, priced from the catalog', () => {
  const saved = { a: process.env.STRIPE_PRICE_ACTIONS_40, b: process.env.STRIPE_PRICE_ACTIONS_100 };
  delete process.env.STRIPE_PRICE_ACTIONS_40;
  delete process.env.STRIPE_PRICE_ACTIONS_100;
  try {
    assert.deepEqual(publicCatalog().topups, [], 'no price configured → nothing offered');
    process.env.STRIPE_PRICE_ACTIONS_100 = 'price_test_100';
    const [only] = publicCatalog().topups;
    assert.equal(only.pack, 'actions_100');
    assert.equal(only.actions, TOPUP_PACKS.actions_100.actions);
    assert.equal(only.price.display, '$24.99');
    assert.equal(publicCatalog('eur').topups[0].price.display, '€21.76');
    assert.match(publicCatalog().topup_disclosure, /expire when your monthly AI actions reset/);
  } finally {
    for (const [k, v] of [['STRIPE_PRICE_ACTIONS_40', saved.a], ['STRIPE_PRICE_ACTIONS_100', saved.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('packs cost more per AI action than the Pro and Studio plans', () => {
  // A plan upgrade must stay the better deal for steady use.
  for (const pack of Object.values(TOPUP_PACKS)) {
    const perAction = pack.usd / pack.actions;
    for (const plan of ['pro', 'studio']) {
      assert.ok(perAction > PRICES[plan].usd.monthly / PLAN_LIMITS[plan].ai_actions, `${pack.env} undercuts ${plan}`);
    }
  }
});
