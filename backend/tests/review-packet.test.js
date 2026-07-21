const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

// Stateful stub: one campaign with one email asset and one evidence link.
function makeSupabase() {
  const flags = { user: { id: 'user-1', email: 'me@app.com' } };
  const campaign = {
    id: 'c-1', workspace_id: 'ws-user-1', name: 'Summer <Sale>', brief_approved: true,
    objective: 'Sell', audience: 'runners', offer_summary: 'Bundle',
    promo_terms: '20% off SUMMER20', key_message: 'Cool', proof: '4.8 stars',
    start_date: '2026-07-01', end_date: '2026-07-31',
  };
  const emailAsset = {
    id: 'e1', workspace_id: 'ws-user-1', campaign_id: 'c-1',
    subject_line: '30% off <script>alert(1)</script>', cta: 'Shop', status: 'edited',
    brief_snapshot: { audience: 'runners', offer_summary: 'Bundle', promo_terms: '20% off SUMMER20', key_message: 'Cool', start_date: '2026-07-01', end_date: '2026-07-31', deadline: null, snapshot_at: '2026-07-10T00:00:00Z' },
  };
  const evidence = [{ id: 'ev1', workspace_id: 'ws-user-1', type: 'review', label: 'Trustpilot', source_url: 'https://t.example', source_ref: null, checked_date: '2026-07-01', review_by_date: null, archived: false }];
  const links = [{ workspace_id: 'ws-user-1', evidence_id: 'ev1', campaign_id: 'c-1', asset_table: 'email_assets', asset_id: 'e1' }];

  function builder(table) {
    const st = { table, op: 'select', filters: {}, ins: null };
    const api = {
      select() { return api; }, insert(p) { st.op = 'insert'; st.ins = p; return api; },
      upsert(p) { st.op = 'upsert'; st.ins = p; return api; },
      update(p) { st.op = 'update'; st.ins = p; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters[k] = v; return api; }, in() { return api; }, order() { return api; },
      single() { return Promise.resolve(resolve(st, true)); },
      then(res, rej) { return Promise.resolve(resolve(st, false)).then(res, rej); },
    };
    return api;
  }
  const match = (r, f) => Object.entries(f).every(([k, v]) => r[k] === v);
  function resolve(st, single) {
    if (st.table === 'workspaces') {
      const ws = { id: 'ws-' + flags.user.id, user_id: flags.user.id, archived: false };
      return single ? { data: ws, error: null } : { data: [ws], error: null };
    }
    if (st.op === 'upsert' || st.op === 'insert' || st.op === 'update' || st.op === 'delete') return { data: null, error: null };
    const stores = {
      campaigns: [campaign], email_assets: [emailAsset], evidence, asset_evidence_links: links,
      website_pages: [], social_assets: [], creative_assets: [], seo_assets: [],
      consistency_findings: [], asset_brief_reviews: [], campaign_deliverables: [],
    };
    const store = stores[st.table] || [];
    const rows = store.filter((r) => match(r, st.filters));
    return single
      ? (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } })
      : { data: rows, error: null };
  }
  return {
    from: builder, _flags: flags,
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
    authClient: () => ({ auth: {
      getUser: async () => ({ data: { user: flags.user }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
    } }),
  };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

const express = require('express');
const request = require('supertest');
const campaignsRouter = require('../routes/campaigns');

const app = express();
app.use(campaignsRouter);
const AUTHED = ['Cookie', 'sb_access=tok'];

test('review packet is a complete, honest handoff record (markdown)', async () => {
  const r = await request(app).get('/api/campaigns/c-1/review-packet').set(...AUTHED);
  assert.equal(r.status, 200);
  const md = r.body.packet_markdown;
  assert.match(md, /NOT an approval, fact-check or/);
  assert.match(md, /## Asset index/);
  assert.match(md, /brief snapshot 2026-07-10/);
  assert.match(md, /## Unresolved items \(disclosed, not erased\)/);
  // the 30% vs 20% conflict must be disclosed, not erased
  assert.match(md, /promotion term mismatch/);
  // the edited asset shows as needing review
  assert.match(md, /needs review ·/);
  assert.match(md, /Trustpilot \(review\) — checked 2026-07-01/);
  assert.match(md, /Downstream owner checklist/);
  assert.match(md, /Scalvya does none of these/);
});

test('html packet is print-friendly, noindexed and escapes user content', async () => {
  const r = await request(app).get('/api/campaigns/c-1/review-packet?format=html').set(...AUTHED);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.text, /<meta name="robots" content="noindex">/);
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.match(r.text, /&lt;script&gt;/);
});

test('a foreign user cannot export the packet', async () => {
  db._flags.user = { id: 'attacker', email: 'evil@x.com' };
  const r = await request(app).get('/api/campaigns/c-1/review-packet').set(...AUTHED);
  assert.equal(r.status, 404);
  db._flags.user = { id: 'user-1', email: 'me@app.com' };
});
