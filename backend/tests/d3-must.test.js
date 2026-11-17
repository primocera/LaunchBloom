// ---------------------------------------------------------------------------
// Audit D3 (2026-11-15): a Supabase read whose answer drives a decision fails
// closed on an error instead of reading the outage as "no row".
//
//   - must(): data for a result or a verified no-row, 503 READ_UNAVAILABLE
//     for any other error
//   - the data-rights export fails (503) instead of exporting a partial set
//   - no route or lib file gains MORE data-only reads than it has today
//     (a ratchet: convert, never add)
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { stubModule, makeFakeSupabase } = require('./helpers');
const { must } = require('../lib/must');

test('D3: must() returns data, null for a verified no-row, and throws on an outage', () => {
  assert.deepEqual(must({ data: { id: 1 }, error: null }), { id: 1 });
  assert.equal(must({ data: null, error: { code: 'PGRST116', message: 'no rows' } }), null);
  assert.equal(must({ data: undefined, error: null }), null);
  assert.throws(() => must({ data: null, error: { code: '08006', message: 'connection failure' } }, 'workspace list'),
    (e) => e.status === 503 && e.code === 'READ_UNAVAILABLE' && /workspace list/.test(e.message));
});

test('D3: an unreadable workspace list fails the export instead of shrinking it', async () => {
  const fake = makeFakeSupabase({
    workspaces: { data: null, error: { code: '08006', message: 'connection failure' } },
  });
  fake.authClient = () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'me@app.com' } }, error: null }),
      refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no' } }),
    },
  });
  stubModule('lib/supabase.js', fake);
  stubModule('lib/stripe.js', { subscriptions: { list: async () => ({ data: [] }) } });
  let collected = 0;
  stubModule('lib/workspace-data.js', {
    collectWorkspaceData: async () => { collected++; return {}; },
    deleteWorkspaceData: async () => ({}),
  });

  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use(require('../routes/account'));
  const r = await request(app).get('/api/account/export').set('Cookie', 'sb_access=tok');

  assert.equal(r.status, 503);
  assert.equal(collected, 0, 'nothing is exported from a guessed workspace list');
});

// Data-only reads per file on 2026-11-17, after converting the decision-making
// ones. Lower a number when you convert a read; never raise one - use must()
// (or check `error`) in new code instead.
const BASELINE = {
  'backend/routes/account.js': 4,
  'backend/routes/admin.js': 10,
  'backend/routes/ai.js': 5,
  'backend/routes/assets.js': 8,
  'backend/routes/auth.js': 1,
  'backend/routes/campaigns.js': 25,
  'backend/routes/e2e-seed.js': 1,
  'backend/routes/evidence.js': 4,
  'backend/routes/feedback.js': 1,
  'backend/routes/library.js': 5,
  'backend/routes/payments.js': 2,
  'backend/routes/workspaces.js': 8,
  'backend/lib/auth.js': 1,
  'backend/lib/brand-profile.js': 1,
  'backend/lib/deliverables-track.js': 1,
  'backend/lib/idempotency.js': 1,
  'backend/lib/spend-guard.js': 1,
};

test('D3: no file gains a Supabase read that ignores its error', () => {
  const root = path.join(__dirname, '..', '..');
  const re = /const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+supabase\b/g;
  const grew = [];
  for (const dir of ['backend/routes', 'backend/lib']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!f.endsWith('.js')) continue;
      const rel = `${dir}/${f}`;
      const n = (fs.readFileSync(path.join(root, rel), 'utf8').match(re) || []).length;
      if (n > (BASELINE[rel] || 0)) grew.push(`${rel}: ${n} (baseline ${BASELINE[rel] || 0})`);
    }
  }
  assert.deepEqual(grew, [], 'use must() from lib/must.js, or check `error`, for new reads');
});
