// ---------------------------------------------------------------------------
// SC-95-01 — durable Stripe-customer ownership matrix.
//
// v15 closed the SEARCH and CREATE paths (recoverScalvyaCustomer matches only on
// exact metadata). This suite closes the two remaining acceptance paths that
// adopted a customer WITHOUT proving ownership:
//   1. the durable customers.stripe_customer_id DB link, returned on !deleted;
//   2. the concurrent link-race winner, adopted on !deleted.
// Both now pass through isOwnedScalvyaCustomer (not deleted + metadata.source ==
// launchbloom + metadata.app_user_id == this exact user). A live-but-foreign,
// wrong-user or metadata-free object fails closed for reconciliation — it is
// never adopted, overwritten, or wrapped in a second customer, even when the
// email and user id look identical to a Mellowa customer on the shared account.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://app.example.com';

const { stubModule } = require('./helpers');

const NO_ROW = { code: 'PGRST116', message: 'no rows' };
const USER = 'user-uuid-1';
const OTHER_USER = 'user-uuid-2';
const EMAIL = 'buyer@example.com';
const SOURCE = 'launchbloom';

// --- stateful Stripe fake (extends the idempotent-customer fake with a
//     retrieve-failure injector so a transient outage is distinguishable from a
//     resource_missing stale link) ------------------------------------------
const stripe = {
  _created: [],
  _byKey: new Map(),
  failRetrieve: new Set(), // ids whose retrieve throws a NON-resource_missing error
  hideFromSearch: new Set(), // ids the metadata search cannot see (models a customer
  // that only appears at read-back time — the genuine concurrent-race shape)
  actualCreations: 0,
  reset() { this._created = []; this._byKey = new Map(); this.failRetrieve = new Set(); this.hideFromSearch = new Set(); this.actualCreations = 0; },
  seed(id, metadata, { deleted = false } = {}) {
    const c = { id, deleted, email: EMAIL, metadata: metadata || {} };
    this._created.push(c);
    return c;
  },
  customers: {
    create: async (params, opts) => {
      const key = opts && opts.idempotencyKey;
      if (key && stripe._byKey.has(key)) return stripe._byKey.get(key);
      stripe.actualCreations += 1;
      const c = { id: `cus_${stripe._created.length + 1}`, deleted: false, email: params.email, metadata: params.metadata || {} };
      stripe._created.push(c);
      if (key) stripe._byKey.set(key, c);
      return c;
    },
    retrieve: async (id) => {
      if (stripe.failRetrieve.has(id)) { const e = new Error('stripe unreachable'); e.type = 'StripeConnectionError'; throw e; }
      const c = stripe._created.find((x) => x.id === id);
      if (!c) { const e = new Error('No such customer'); e.code = 'resource_missing'; throw e; }
      return c;
    },
    search: async ({ query }) => {
      const uid = (query.match(/app_user_id'\]:'([^']+)'/) || [])[1];
      const src = (query.match(/source'\]:'([^']+)'/) || [])[1];
      const data = stripe._created.filter(
        (c) => !stripe.hideFromSearch.has(c.id)
          && !c.deleted && c.metadata && c.metadata.app_user_id === uid && c.metadata.source === src,
      );
      return { data };
    },
  },
};

// --- stateful Supabase fake (same shape as billing-idempotent-customer) ----
const db = {
  rows: new Map(),
  readError: null,
  upsertError: null,
  raceTo: null,
  reset() { this.rows = new Map(); this.readError = null; this.upsertError = null; this.raceTo = null; },
};

stubModule('lib/supabase.js', {
  from(table) {
    let op = 'select';
    let email = null;
    let vals = null;
    const b = {
      select() { op = 'select'; return b; },
      upsert(v) { op = 'upsert'; vals = v; return b; },
      eq(col, val) { if (col === 'email') email = val; return b; },
      single() {
        if (table !== 'customers') return Promise.resolve({ data: null, error: null });
        if (db.readError) return Promise.resolve({ data: null, error: db.readError });
        const row = db.rows.get(email);
        if (!row) return Promise.resolve({ data: null, error: NO_ROW });
        return Promise.resolve({ data: row, error: null });
      },
      then(onOk, onErr) {
        if (op === 'upsert' && table === 'customers') {
          if (db.upsertError) return Promise.resolve({ error: db.upsertError }).then(onOk, onErr);
          db.rows.set(vals.email, { id: `row-${vals.email}`, stripe_customer_id: vals.stripe_customer_id, metadata: vals.metadata });
          if (db.raceTo) db.rows.set(vals.email, { id: `row-${vals.email}`, stripe_customer_id: db.raceTo, metadata: vals.metadata });
          return Promise.resolve({ error: null }).then(onOk, onErr);
        }
        return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
      },
    };
    return b;
  },
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
});

stubModule('lib/stripe.js', stripe);

const payments = require('../routes/payments');
const { ensureStripeCustomer, isOwnedScalvyaCustomer, CustomerReconciliationRequiredError } = payments;
const { isEntitlementUnavailable } = require('../lib/subscription-state');

function reset() { stripe.reset(); db.reset(); }
function linkTo(id) { db.rows.set(EMAIL, { id: 'row-1', stripe_customer_id: id, metadata: { app_user_id: USER } }); }

// --- the pure predicate ----------------------------------------------------

test('predicate: only not-deleted + exact source + exact user is owned', () => {
  assert.equal(isOwnedScalvyaCustomer({ metadata: { source: SOURCE, app_user_id: USER } }, USER), true);
  assert.equal(isOwnedScalvyaCustomer({ metadata: { source: 'mellowa', app_user_id: USER } }, USER), false, 'foreign source');
  assert.equal(isOwnedScalvyaCustomer({ metadata: { source: SOURCE, app_user_id: OTHER_USER } }, USER), false, 'wrong user');
  assert.equal(isOwnedScalvyaCustomer({ metadata: {} }, USER), false, 'missing metadata');
  assert.equal(isOwnedScalvyaCustomer({ deleted: true, metadata: { source: SOURCE, app_user_id: USER } }, USER), false, 'deleted');
  assert.equal(isOwnedScalvyaCustomer(null, USER), false, 'no object');
});

// --- durable DB link: seven classes ---------------------------------------
// A mismatch must NEVER create a Customer and NEVER overwrite the link.

test('durable link — owned → reused exactly once, zero creates', async () => {
  reset();
  const owned = stripe.seed('cus_owned', { app_user_id: USER, source: SOURCE });
  linkTo(owned.id);
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, 'cus_owned');
  assert.equal(stripe.actualCreations, 0);
});

for (const [label, meta] of [
  ['foreign source (Mellowa)', { app_user_id: USER, source: 'mellowa' }],
  ['correct source, wrong user', { app_user_id: OTHER_USER, source: SOURCE }],
  ['missing metadata', {}],
]) {
  test(`durable link — ${label} → reconciliation-required, zero creates, link untouched`, async () => {
    reset();
    const foreign = stripe.seed('cus_foreign', meta);
    linkTo(foreign.id);
    await assert.rejects(
      () => ensureStripeCustomer(EMAIL, USER),
      (e) => e instanceof CustomerReconciliationRequiredError && e.reason === 'durable_link_ownership_mismatch',
    );
    assert.equal(stripe.actualCreations, 0, 'never create around a foreign link');
    assert.equal(db.rows.get(EMAIL).stripe_customer_id, 'cus_foreign', 'the link is not overwritten');
  });
}

test('durable link — deleted, no live orphan → fresh owned customer (not the deleted id)', async () => {
  reset();
  stripe.seed('cus_dead', { app_user_id: USER, source: SOURCE }, { deleted: true });
  linkTo('cus_dead');
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.notEqual(id, 'cus_dead');
  assert.equal(stripe.actualCreations, 1);
  assert.equal(isOwnedScalvyaCustomer(stripe._created.find((c) => c.id === id), USER), true);
});

test('durable link — deleted, live owned orphan exists → orphan reused, zero creates', async () => {
  reset();
  stripe.seed('cus_dead', { app_user_id: USER, source: SOURCE }, { deleted: true });
  const orphan = stripe.seed('cus_orphan', { app_user_id: USER, source: SOURCE });
  linkTo('cus_dead');
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, orphan.id);
  assert.equal(stripe.actualCreations, 0);
});

test('durable link — retrieve failure (transient) → rethrows, fails closed, zero creates', async () => {
  reset();
  const owned = stripe.seed('cus_owned', { app_user_id: USER, source: SOURCE });
  linkTo(owned.id);
  stripe.failRetrieve.add(owned.id);
  await assert.rejects(() => ensureStripeCustomer(EMAIL, USER), (e) => e.type === 'StripeConnectionError');
  assert.equal(stripe.actualCreations, 0, 'a read outage must not mint a customer');
});

test('durable link — resource_missing → safe recovery of live owned orphan, zero creates', async () => {
  reset();
  linkTo('cus_gone'); // never seeded → retrieve throws resource_missing
  const orphan = stripe.seed('cus_orphan', { app_user_id: USER, source: SOURCE });
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, orphan.id);
  assert.equal(stripe.actualCreations, 0);
});

// --- concurrent link-race winner: seven classes + an owned winner ----------

test('race winner — owned → adopted (the durable persisted winner)', async () => {
  reset();
  // Hidden from recovery search so it surfaces only at read-back: the genuine
  // race shape (we create our own, a concurrent writer persists cus_winner).
  const winner = stripe.seed('cus_winner', { app_user_id: USER, source: SOURCE });
  stripe.hideFromSearch.add(winner.id);
  db.raceTo = winner.id;
  const id = await ensureStripeCustomer(EMAIL, USER);
  assert.equal(id, winner.id, 'the owned persisted winner is adopted via the race branch');
  assert.equal(stripe.actualCreations, 1, 'we created our own before the concurrent winner landed');
});

for (const [label, seed] of [
  ['foreign source', () => stripe.seed('cus_race', { app_user_id: USER, source: 'mellowa' })],
  ['wrong user', () => stripe.seed('cus_race', { app_user_id: OTHER_USER, source: SOURCE })],
  ['missing metadata', () => stripe.seed('cus_race', {})],
  ['deleted', () => stripe.seed('cus_race', { app_user_id: USER, source: SOURCE }, { deleted: true })],
]) {
  test(`race winner — ${label} → reconciliation-required, foreign winner never adopted`, async () => {
    reset();
    const w = seed();
    db.raceTo = w.id;
    await assert.rejects(
      () => ensureStripeCustomer(EMAIL, USER),
      (e) => e instanceof CustomerReconciliationRequiredError && e.reason === 'link_race_ownership_unproven',
    );
  });
}

test('race winner — unretrievable → reconciliation-required (fail closed, not adopted)', async () => {
  reset();
  const w = stripe.seed('cus_race', { app_user_id: USER, source: SOURCE });
  stripe.hideFromSearch.add(w.id); // recovery can't grab it; only the race read-back sees it
  db.raceTo = w.id;
  stripe.failRetrieve.add(w.id);
  await assert.rejects(
    () => ensureStripeCustomer(EMAIL, USER),
    (e) => e instanceof CustomerReconciliationRequiredError && e.reason === 'link_race_ownership_unproven',
  );
});

// --- created-response defense in depth -------------------------------------

test('created customer response missing our stamp → fails closed (unavailable), no adoption', async () => {
  reset();
  // Force create() to return an unstamped object (a misconfigured fake / foreign
  // idempotent replay). The created-response predicate must reject it.
  const orig = stripe.customers.create;
  stripe.customers.create = async () => ({ id: 'cus_unstamped', deleted: false, metadata: {} });
  try {
    await assert.rejects(() => ensureStripeCustomer(EMAIL, USER), (e) => isEntitlementUnavailable(e));
  } finally {
    stripe.customers.create = orig;
  }
});
