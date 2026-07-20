// v8 LB-S09 — value funnel: every milestone is canonical, deduped once per
// scope, and server-confirmed retries never double-count.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

// In-memory supabase that mimics upsert(onConflict, ignoreDuplicates) + insert.
const store = [];
const db = {
  from() {
    let pending = null;
    let mode = null;
    let opts = null;
    const api = {
      insert(row) { mode = 'insert'; pending = row; return api; },
      upsert(row, o) { mode = 'upsert'; pending = row; opts = o; return api; },
      then(res) {
        if (mode === 'upsert' && opts && opts.ignoreDuplicates) {
          const exists = store.some((r) => r.dedupe_key && r.dedupe_key === pending.dedupe_key);
          if (!exists) store.push(pending);
        } else {
          store.push(pending);
        }
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return api;
  },
};
stubModule('lib/supabase.js', db);

const { track, VALUE_FUNNEL, CANONICAL_EVENTS } = require('../lib/analytics');

test('every funnel step maps to a documented canonical event', () => {
  assert.ok(VALUE_FUNNEL.length >= 8);
  for (const s of VALUE_FUNNEL) {
    assert.ok(CANONICAL_EVENTS[s.step], `funnel step not canonical: ${s.step}`);
    assert.ok(s.question && s.question.length > 5, `step missing decision question: ${s.step}`);
    assert.ok(['workspace', 'campaign'].includes(s.scope), `bad scope: ${s.step}`);
    assert.match(s.dedupe, /\{(workspaceId|campaignId)\}/);
  }
});

test('deduped server events are counted once across retries', async () => {
  store.length = 0;
  const key = 'done:campaign-1';
  await track('campaign_completed', { workspaceId: 'ws1', dedupeKey: key });
  await track('campaign_completed', { workspaceId: 'ws1', dedupeKey: key }); // webhook redelivery
  await track('campaign_completed', { workspaceId: 'ws1', dedupeKey: key }); // job re-run
  const rows = store.filter((r) => r.event === 'campaign_completed');
  assert.equal(rows.length, 1);
});

test('volume events without a dedupe key are unconstrained', async () => {
  store.length = 0;
  await track('first_generation', { workspaceId: 'ws1' });
  await track('first_generation', { workspaceId: 'ws1' });
  assert.equal(store.filter((r) => r.event === 'first_generation').length, 2);
});

test('a failing analytics insert never throws', async () => {
  const boom = { from() { throw new Error('db down'); } };
  stubModule('lib/supabase.js', boom);
  delete require.cache[require.resolve('../lib/analytics')];
  const { track: t2 } = require('../lib/analytics');
  await assert.doesNotReject(() => t2('campaign_completed', { dedupeKey: 'x' }));
  stubModule('lib/supabase.js', db);
});
