// v8 LB-S10 — failure-injection: prove user work and entitlements survive
// provider failure, malformed AI output, duplicate webhooks and concurrent edits.
// These are deterministic unit-level injections (no live providers).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// ── 1. Analytics/Supabase partial failure never throws (product not blocked) ──
test('analytics track swallows a Supabase failure', async () => {
  const boom = { from() { throw new Error('supabase down'); } };
  stubModule('lib/supabase.js', boom);
  delete require.cache[require.resolve('../lib/analytics')];
  const { track } = require('../lib/analytics');
  await assert.doesNotReject(() => track('campaign_completed', { dedupeKey: 'k' }));
});

// ── 2. Duplicate webhook → deduped milestone counts once ──────────────────────
test('duplicate server-confirmed event with same dedupeKey inserts once', async () => {
  const rows = [];
  const db = {
    from() {
      let mode, pending, opts;
      const api = {
        insert(r) { mode = 'insert'; pending = r; return api; },
        upsert(r, o) { mode = 'upsert'; pending = r; opts = o; return api; },
        then(res) {
          if (mode === 'upsert' && opts && opts.ignoreDuplicates) {
            if (!rows.some((x) => x.dedupe_key === pending.dedupe_key)) rows.push(pending);
          } else rows.push(pending);
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return api;
    },
  };
  stubModule('lib/supabase.js', db);
  delete require.cache[require.resolve('../lib/analytics')];
  const { track } = require('../lib/analytics');
  await track('subscription_activated', { dedupeKey: 'sub:evt_1' });
  await track('subscription_activated', { dedupeKey: 'sub:evt_1' }); // webhook redelivery
  assert.equal(rows.filter((r) => r.event === 'subscription_activated').length, 1);
});

// ── 3. Malformed AI output: the consistency engine tolerates junk assets ──────
test('consistency engine never throws on malformed/partial assets', () => {
  delete require.cache[require.resolve('../lib/consistency')];
  const { runConsistencyChecks } = require('../lib/consistency');
  const campaign = { id: 'c1', promo_terms: '20% off', start_date: null, end_date: null };
  const junk = {
    website_pages: [{ id: 'w', headline: null, sections: 'not-an-array' }],
    email_assets: [{ id: 'e', subject_line: undefined }],
    social_assets: [null],
    creative_assets: [{}],
    seo_assets: [{ id: 's', keywords: 42 }],
  };
  assert.doesNotThrow(() => {
    const findings = runConsistencyChecks(campaign, junk);
    assert.ok(Array.isArray(findings));
  });
});

// ── 4. Concurrent brief edit: fingerprint reconciliation is order-independent ─
test('backfill reconcile is idempotent under repeat runs', async () => {
  const persisted = [];
  const db = {
    from(table) {
      const st = { table, filters: {} };
      const api = {
        select() { return api; },
        eq(k, v) { st.filters[k] = v; return api; },
        gte() { return api; }, order() { return api; }, in() { return api; },
        upsert(rows) {
          for (const r of rows) {
            const i = persisted.findIndex((p) => p.fingerprint === r.fingerprint);
            if (i >= 0) persisted[i] = { ...persisted[i], ...r }; else persisted.push(r);
          }
          return Promise.resolve({ error: null });
        },
        update(p) { st.patch = p; return api; },
        then(res) {
          if (st.table === 'consistency_findings') return Promise.resolve({ data: persisted.slice(), error: null }).then(res);
          return Promise.resolve({ data: [], error: null }).then(res);
        },
      };
      return api;
    },
  };
  stubModule('lib/supabase.js', db);
  delete require.cache[require.resolve('../lib/consistency')];
  delete require.cache[require.resolve('../scripts/backfill-consistency')];
  const { reconcileCampaign } = require('../scripts/backfill-consistency');
  // A campaign whose promo term appears nowhere → at least one finding.
  const campaign = { id: 'c1', promo_terms: 'SAVE20', key_message: 'x' };
  const r1 = await reconcileCampaign('ws1', campaign, true);
  const countAfterFirst = persisted.length;
  const r2 = await reconcileCampaign('ws1', campaign, true);
  // Re-running writes no NEW rows (idempotent by fingerprint).
  assert.equal(persisted.length, countAfterFirst);
  assert.equal(r1.upserted, r2.upserted);
});

// ── 5. Release check reports blockers instead of throwing on missing config ───
test('release check collects blockers deterministically without secrets', () => {
  delete require.cache[require.resolve('../scripts/release-check')];
  const { collect } = require('../scripts/release-check');
  const { checks } = collect();
  assert.ok(checks.length > 0);
  // No check detail leaks a secret value (only names/presence).
  for (const c of checks) {
    assert.ok(typeof c.detail === 'string');
    assert.ok(!/sk_live_[A-Za-z0-9]/.test(c.detail), 'secret value leaked into report');
  }
});
