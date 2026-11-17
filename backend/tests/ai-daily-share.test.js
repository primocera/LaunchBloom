// ---------------------------------------------------------------------------
// Audit A3 (2026-11-15): one account cannot spend the whole app's daily AI
// budget. The gate refuses an account's actions past its share of
// MAX_AI_CALLS_PER_DAY for the current UTC day; other accounts are unaffected.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MAX_AI_CALLS_PER_DAY = '20';
process.env.AI_USER_DAILY_SHARE = '0.25'; // 5 actions per account per day

const { stubModule, mockRes } = require('./helpers');

// usage_events ledger with real status / created_at filtering.
const events = [];
function builder(table) {
  const st = { filters: {}, gte: null, head: false, op: 'select', payload: null };
  const api = {
    select(_c, opts) { if (opts && opts.head) st.head = true; return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    eq(k, v) { st.filters[k] = v; return api; },
    gte(k, v) { st.gte = { k, v }; return api; },
    in() { return api; }, order() { return api; }, limit() { return api; }, lt() { return api; }, gt() { return api; },
    single() { return Promise.resolve(run()); },
    then(ok, err) { return Promise.resolve(run()).then(ok, err); },
  };
  function run() {
    if (table !== 'usage_events') return { data: null, error: null };
    if (st.op === 'insert') {
      const row = { id: `ue-${events.length + 1}`, created_at: new Date().toISOString(), ...st.payload };
      events.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (st.op === 'update') {
      const row = events.find((e) => e.id === st.filters.id);
      if (row) Object.assign(row, st.payload);
      return { data: null, error: null };
    }
    const rows = events.filter((e) => Object.entries(st.filters).every(([k, v]) => e[k] === v)
      && (!st.gte || e[st.gte.k] >= st.gte.v));
    return st.head ? { count: rows.length, error: null } : { data: rows, error: null };
  }
  return api;
}
stubModule('lib/supabase.js', { from: builder, rpc: async () => ({ data: null, error: null }) });
stubModule('lib/analytics.js', { track: async () => {} });
stubModule('lib/auth.js', {
  requireAuth: (req, _res, next) => { req.userId = req.headers['x-user']; req.userEmail = `${req.userId}@example.com`; next(); },
});
stubModule('routes/customers.js', { planFor: async () => 'studio', findCustomerRow: async () => null });
stubModule('routes/workspaces.js', { resolveWorkspace: async (req) => ({ id: `ws-${req.userId}` }) });

const { planGate } = require('../lib/plan-limits');
const { userDailyLimit } = require('../lib/spend-guard');

function seed(userId, n, at = new Date().toISOString()) {
  for (let i = 0; i < n; i++) events.push({ id: `seed-${userId}-${events.length}`, user_id: userId, status: 'succeeded', created_at: at });
}

function runGate(userId) {
  const req = { headers: { 'x-user': userId }, get: () => undefined, method: 'POST', body: {}, query: {}, path: '/generate-positioning' };
  const res = mockRes();
  res.setHeader = () => {};
  res.getHeader = () => undefined;
  res.on = () => {};
  return new Promise((resolve) => {
    const done = res.json.bind(res);
    res.json = (b) => { done(b); resolve({ ran: false, res }); return res; };
    planGate('positioning')(req, res, (err) => resolve({ ran: !err, err, res }));
  });
}

test('A3: the share is a quarter of the daily cap', () => {
  assert.equal(userDailyLimit(), 5);
});

test('A3: an account past its daily share is refused; another account still runs', async () => {
  events.length = 0;
  seed('busy', 5);
  const busy = await runGate('busy');
  assert.equal(busy.err, undefined);
  assert.equal(busy.ran, false);
  assert.equal(busy.res.statusCode, 429);
  assert.equal(busy.res.body.code, 'USER_DAILY_LIMIT');
  assert.ok(busy.res.body.resets_at.endsWith('T00:00:00.000Z'));

  const other = await runGate('quiet');
  assert.equal(other.err, undefined);
  assert.equal(other.ran, true, 'one account at its share does not block anyone else');
});

test('A3: actions from earlier days do not count toward today', async () => {
  events.length = 0;
  seed('busy', 50, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  seed('busy', 4);
  const r = await runGate('busy');
  assert.equal(r.err, undefined);
  assert.equal(r.ran, true);
});
