// Library → Recent generations (GET /api/usage/recent). The service-role
// client bypasses RLS, so the route is the security boundary: it must only
// ever return the authenticated user's own usage rows.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule } = require('./helpers');

const ROWS = [
  { id: 'e1', user_id: 'user-1', feature: 'asset_generations', action: 'generate-email-flow', status: 'failed', created_at: '2026-10-19T21:50:00Z' },
  { id: 'e2', user_id: 'user-2', feature: 'asset_generations', action: 'generate-website-kit', status: 'succeeded', created_at: '2026-10-19T21:40:00Z' },
  { id: 'e3', user_id: 'user-1', feature: 'asset_generations', action: 'generate-website-kit', status: 'succeeded', created_at: '2026-10-19T21:10:00Z' },
];

const seen = { filters: null, cols: null };

stubModule('lib/supabase.js', {
  from(table) {
    const st = { filters: {} };
    const api = {
      select(cols) { seen.cols = cols; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      order() { return api; },
      limit() { return api; },
      then(res, rej) {
        seen.filters = st.filters;
        const data = table === 'usage_events'
          ? ROWS.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v))
          : [];
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return api;
  },
  storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  authClient: () => ({ auth: {
    getUser: async () => ({ data: { user: { id: 'user-1', email: 'me@app.com' } }, error: null }),
    refreshSession: async () => ({ data: { session: null, user: null }, error: {} }),
  } }),
});

const express = require('express');
const request = require('supertest');
const libraryRouter = require('../routes/library');

const app = express();
app.use(libraryRouter);

test('recent generations returns only the caller\'s own runs, failed ones included', async () => {
  const r = await request(app).get('/api/usage/recent').set('Cookie', 'sb_access=tok');
  assert.equal(r.status, 200);
  assert.deepEqual(seen.filters, { user_id: 'user-1' });
  assert.deepEqual(r.body.items.map((i) => i.id), ['e1', 'e3']);
  assert.ok(r.body.items.some((i) => i.status === 'failed'));
  // Only display fields leave the server - no tokens, cost or ids of others.
  assert.ok(!/user_id|estimated_cost|input_tokens/.test(seen.cols));
});

test('recent generations requires a signed-in user', async () => {
  const r = await request(app).get('/api/usage/recent');
  assert.equal(r.status, 401);
});
