// ---------------------------------------------------------------------------
// Audit batch 1 (2026-11-15) - one test per defect, so none can come back.
//
//   B2  a subscription webhook never replaces a customer link with null
//   B1  customer.updated tolerates an email another row already holds
//   M1  the usage ledger fails closed (503), never "0 used"
//   M2  a reservation stops counting once it is too old to be in flight
//   D1  a failed workspace read creates nothing; parallel first requests
//       converge on one workspace
//   D2  every table a migration creates has row-level security enabled
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_signature_checks';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_m';
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_OWNERSHIP_ENFORCED;

const { stubModule, mockRes } = require('./helpers');

// One scriptable fake for the whole file. `db.fail[table]` makes every query on
// that table answer with an error; `db.log` records each write.
const db = {
  fail: {},
  log: [],
  customers: new Map(), // stripe_customer_id -> row
  subs: new Map(), // stripe_subscription_id -> row
  workspaces: [],
  usage: [],
  customerUpdateError: null,
  user: { id: 'user-1', email: 'a@example.com', email_confirmed_at: 'x' },
};
function resetDb() {
  db.fail = {};
  db.log = [];
  db.customers.clear();
  db.subs.clear();
  db.workspaces = [];
  db.usage = [];
  db.customerUpdateError = null;
}

const NO_ROW = { data: null, error: { code: 'PGRST116', message: 'no rows' } };

function builder(table) {
  const st = { table, op: 'select', filters: {}, payload: null, head: false, gte: null };
  const api = {
    select(_c, opts) { if (opts && opts.head) st.head = true; return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
    delete() { st.op = 'delete'; return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    is(k, v) { st.filters[k] = v; return api; },
    in() { return api; },
    gt() { return api; },
    gte(k, v) { st.gte = { k, v }; return api; },
    lt() { return api; },
    order() { return api; },
    limit() { return api; },
    single() { return Promise.resolve(run(st, true)); },
    then(ok, err) { return Promise.resolve(run(st, false)).then(ok, err); },
  };
  return api;
}

function run(st, single) {
  if (db.fail[st.table]) return { data: null, count: null, error: { code: '08006', message: 'connection failure' } };
  if (st.op !== 'select') db.log.push({ table: st.table, op: st.op, payload: st.payload, filters: st.filters });

  if (st.table === 'stripe_events') return single ? NO_ROW : { data: null, error: null };

  if (st.table === 'customers') {
    if (st.op === 'update') return { error: db.customerUpdateError };
    const row = db.customers.get(st.filters.stripe_customer_id) || null;
    if (single) return row ? { data: row, error: null } : NO_ROW;
    return { data: row ? [row] : [], error: null };
  }

  if (st.table === 'subscriptions') {
    if (st.op === 'upsert') {
      const key = st.payload.stripe_subscription_id;
      // Same semantics as Postgres: only the columns sent are written.
      db.subs.set(key, { ...(db.subs.get(key) || {}), ...st.payload });
      return { error: null };
    }
    const row = db.subs.get(st.filters.stripe_subscription_id) || null;
    if (single) return row ? { data: row, error: null } : NO_ROW;
    return { data: row ? [row] : [], error: null };
  }

  if (st.table === 'workspaces') {
    if (st.op === 'insert') {
      const row = { id: `ws-${db.workspaces.length + 1}`, archived: false, created_at: new Date(Date.now() + db.workspaces.length).toISOString(), ...st.payload };
      db.workspaces.push(row);
      return { data: row, error: null };
    }
    if (st.op === 'delete') {
      db.workspaces = db.workspaces.filter((w) => w.id !== st.filters.id);
      return { error: null };
    }
    const rows = db.workspaces.filter((w) => Object.entries(st.filters).every(([k, v]) => w[k] === v));
    if (single) return rows[0] ? { data: rows[0], error: null } : NO_ROW;
    return { data: rows, error: null };
  }

  if (st.table === 'usage_events') {
    if (st.op === 'insert') {
      const row = { id: `ue-${db.usage.length + 1}`, ...st.payload };
      db.usage.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (st.head) {
      const rows = db.usage.filter((e) => Object.entries(st.filters).every(([k, v]) => e[k] === v)
        && (!st.gte || e[st.gte.k] >= st.gte.v));
      return { count: rows.length, error: null };
    }
    return { data: null, error: null };
  }

  if (single) return NO_ROW;
  return { data: null, error: null };
}

stubModule('lib/supabase.js', {
  from: builder,
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  authClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: db.user }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  }),
  adminClient: () => ({ auth: { admin: {} } }),
});

const Stripe = require('stripe');
const stripeSdk = Stripe(process.env.STRIPE_SECRET_KEY);
const express = require('express');
const request = require('supertest');
const webhooksRouter = require('../routes/webhooks');
// Audit B4: the subscription handler refetches the subscription from Stripe.
// These tests have no Stripe to reach, so the refetch is unavailable and the
// handler mirrors the event payload - without a real network call.
require('../lib/stripe').subscriptions.retrieve = async () => {
  throw Object.assign(new Error('stripe unreachable in tests'), { type: 'StripeConnectionError' });
};
const usage = require('../lib/usage');
const { planGate } = require('../lib/plan-limits');
const { ensureWorkspace } = require('../routes/workspaces');

const app = express();
app.use('/api/webhooks', webhooksRouter);

function post(event) {
  const payload = JSON.stringify(event);
  const header = stripeSdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return request(app).post('/api/webhooks/stripe').set('content-type', 'application/json')
    .set('stripe-signature', header).send(payload);
}

const subscriptionUpdated = (id, created) => ({
  id,
  type: 'customer.subscription.updated',
  created,
  data: {
    object: {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { source: 'launchbloom', app_user_id: 'user-1' },
      items: { data: [{ price: { id: 'price_pro_m' } }] },
    },
  },
});

// ── B2 ──────────────────────────────────────────────────────────────────────

test('B2: a customer lookup miss keeps the existing subscription link', async () => {
  resetDb();
  db.subs.set('sub_1', { stripe_subscription_id: 'sub_1', customer_id: 'c1', status: 'trialing' });
  // No customers row resolves for cus_1.
  const r = await post(subscriptionUpdated('evt_b2_miss', 1700000000));
  assert.equal(r.status, 200);
  const row = db.subs.get('sub_1');
  assert.equal(row.status, 'active', 'the status is still mirrored');
  assert.equal(row.customer_id, 'c1', 'the link must not be replaced with null');
});

test('B2: an unreadable customer lookup is retried, not mirrored unlinked', async () => {
  resetDb();
  db.subs.set('sub_1', { stripe_subscription_id: 'sub_1', customer_id: 'c1', status: 'trialing' });
  db.fail.customers = true;
  const r = await post(subscriptionUpdated('evt_b2_err', 1700000000));
  assert.equal(r.status, 500, 'Stripe must redeliver');
  assert.equal(db.subs.get('sub_1').status, 'trialing', 'nothing was written');
  assert.equal(db.subs.get('sub_1').customer_id, 'c1');
});

test('B2: a resolved customer is still linked', async () => {
  resetDb();
  db.customers.set('cus_1', { id: 'c9', email: 'a@example.com' });
  const r = await post(subscriptionUpdated('evt_b2_ok', 1700000000));
  assert.equal(r.status, 200);
  assert.equal(db.subs.get('sub_1').customer_id, 'c9');
});

// ── B1 ──────────────────────────────────────────────────────────────────────

test('B1: customer.updated with an email another row holds is acknowledged', async () => {
  resetDb();
  db.customerUpdateError = { code: '23505', message: 'duplicate key value violates unique constraint "customers_email_key"' };
  const r = await post({
    id: 'evt_b1',
    type: 'customer.updated',
    created: 1700000000,
    data: { object: { id: 'cus_1', email: 'taken@example.com', metadata: { source: 'launchbloom' } } },
  });
  assert.equal(r.status, 200, 'a unique conflict must not be retried by Stripe for days');
});

test('B1: any other customer sync failure is still retried', async () => {
  resetDb();
  db.customerUpdateError = { code: '08006', message: 'connection failure' };
  const r = await post({
    id: 'evt_b1_err',
    type: 'customer.updated',
    created: 1700000000,
    data: { object: { id: 'cus_1', email: 'x@example.com', metadata: { source: 'launchbloom' } } },
  });
  assert.equal(r.status, 500);
});

// ── M1 ──────────────────────────────────────────────────────────────────────

test('M1: an unreadable ledger throws instead of counting zero', async () => {
  resetDb();
  db.fail.usage_events = true;
  await assert.rejects(() => usage.countUserActions('user-1', null, null), { code: 'USAGE_UNAVAILABLE' });
  await assert.rejects(() => usage.countActions('ws-1', null, null), { code: 'USAGE_UNAVAILABLE' });
  await assert.rejects(
    () => usage.reserveAction({ userId: 'user-1', workspaceId: 'ws-1', feature: 'positioning' }),
    { code: 'USAGE_UNAVAILABLE' },
  );
});

test('M1: the gate refuses to run a generation it cannot meter', async () => {
  resetDb();
  db.customers.set('cus_1', { id: 'c1' });
  db.workspaces.push({ id: 'ws-1', user_id: 'user-1', archived: false, created_at: '2026-01-01T00:00:00Z' });
  db.fail.usage_events = true;
  const req = { headers: { cookie: 'sb_access=tok' }, get: () => undefined, method: 'POST', body: {}, query: {}, path: '/generate-positioning' };
  const res = mockRes();
  res.setHeader = () => {};
  res.getHeader = () => undefined;
  res.on = () => {};
  let ran = false;
  await new Promise((resolve) => {
    const done = res.json.bind(res);
    res.json = (b) => { done(b); resolve(); return res; };
    planGate('positioning')(req, res, () => { ran = true; resolve(); });
  });
  assert.equal(ran, false, 'the route must not run');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'USAGE_UNAVAILABLE');
  assert.equal(res.body.retryable, true);
});

// ── M2 ──────────────────────────────────────────────────────────────────────

test('M2: a reservation stops counting once it is too old to be in flight', async () => {
  resetDb();
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  db.usage.push(
    { id: 'a', user_id: 'user-1', status: 'succeeded', created_at: ago(40 * 24 * 3600 * 1000) },
    { id: 'b', user_id: 'user-1', status: 'succeeded', created_at: ago(60 * 1000) },
    { id: 'c', user_id: 'user-1', status: 'reserved', created_at: ago(30 * 1000) }, // in flight
    { id: 'd', user_id: 'user-1', status: 'reserved', created_at: ago(usage.RESERVATION_TTL_MS + 60 * 1000) }, // abandoned
    { id: 'e', user_id: 'user-1', status: 'released', created_at: ago(30 * 1000) },
    { id: 'f', user_id: 'user-1', status: 'failed', created_at: ago(30 * 1000) },
    { id: 'g', user_id: 'someone-else', status: 'succeeded', created_at: ago(30 * 1000) },
  );
  // Lifetime (trial/free): both successes + the in-flight reservation.
  assert.equal(await usage.countUserActions('user-1', null, null), 3);
  // Monthly window that started a day ago: the old success drops out.
  assert.equal(await usage.countUserActions('user-1', ago(24 * 3600 * 1000), null), 2);
  // A window that started 10 seconds ago contains nothing of the above.
  assert.equal(await usage.countUserActions('user-1', ago(10 * 1000), null), 0);
});

test('M2: the reservation lifetime outlasts a request and frees itself the same session', () => {
  assert.ok(usage.RESERVATION_TTL_MS >= 5 * 60 * 1000, 'longer than the platform request limit (300 s)');
  assert.ok(usage.RESERVATION_TTL_MS <= 15 * 60 * 1000);
});

// ── D1 ──────────────────────────────────────────────────────────────────────

test('D1: a failed workspace read creates nothing', async () => {
  resetDb();
  db.fail.workspaces = true;
  await assert.rejects(() => ensureWorkspace('a@example.com', 'user-1'), { code: 'WORKSPACE_LOOKUP_FAILED', status: 503 });
  assert.equal(db.log.filter((l) => l.table === 'workspaces' && l.op === 'insert').length, 0);
});

test('D1: an existing workspace is returned, oldest active first', async () => {
  resetDb();
  db.workspaces.push({ id: 'old-archived', user_id: 'user-1', archived: true, created_at: '2026-01-01T00:00:00Z' });
  db.workspaces.push({ id: 'active', user_id: 'user-1', archived: false, created_at: '2026-02-01T00:00:00Z' });
  const ws = await ensureWorkspace('a@example.com', 'user-1');
  assert.equal(ws.id, 'active');
  assert.equal(db.log.length, 0, 'nothing written');
});

test('D1: parallel first requests end with exactly one workspace', async () => {
  resetDb();
  const results = await Promise.all(Array.from({ length: 6 }, () => ensureWorkspace('a@example.com', 'user-1')));
  assert.equal(db.workspaces.length, 1, 'duplicates were removed');
  assert.deepEqual([...new Set(results.map((w) => w.id))], [db.workspaces[0].id], 'every caller got the same one');
});

// ── D2 ──────────────────────────────────────────────────────────────────────

test('D2: every table a migration creates has row-level security enabled', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f));
  const created = new Set();
  const secured = new Set();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi)) created.add(m[1]);
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?([a-z_]+)\s+enable row level security/gi)) secured.add(m[1]);
    // The loop form: execute format('alter table public.%I enable row level security', t)
    // over a quoted array of table names in the same file.
    if (/execute format\('alter table public\.%I enable row level security'/i.test(sql)) {
      for (const block of sql.matchAll(/do \$\$[\s\S]*?\$\$;/g)) {
        if (!/enable row level security/i.test(block[0])) continue;
        for (const m of block[0].matchAll(/'([a-z_]+)'/g)) secured.add(m[1]);
      }
    }
  }
  const missing = [...created].filter((t) => !secured.has(t)).sort();
  assert.deepEqual(missing, [], `tables without RLS: ${missing.join(', ')}`);
});
