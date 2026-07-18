// Playbook v6 Prompt 11 — generation idempotency: a repeated Idempotency-Key
// runs the handler once, replays the stored result, 409s while in flight and
// allows retry after failure or orphaned runs.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

stubModule('lib/auth.js', {
  requireAuth: (req, _res, next) => { req.userId = 'u1'; req.userEmail = 'a@b.com'; next(); },
});

// In-memory generation_jobs with a real unique constraint.
const jobs = new Map(); // `${user}:${key}` -> row
function fakeSupabase() {
  return {
    from: (table) => {
      assert.equal(table, 'generation_jobs');
      let op = null, payload = null, filters = {};
      const b = {
        insert(p) { op = 'insert'; payload = p; return b; },
        update(p) { op = 'update'; payload = p; return b; },
        select() { op = op || 'select'; return b; },
        eq(col, val) { filters[col] = val; return b; },
        single() {
          const row = jobs.get(`${filters.user_id}:${filters.idempotency_key}`) || null;
          return Promise.resolve({ data: row, error: null });
        },
        then(ok, err) {
          let result = { data: null, error: null };
          const k = `${(payload && payload.user_id) || filters.user_id}:${(payload && payload.idempotency_key) || filters.idempotency_key}`;
          if (op === 'insert') {
            if (jobs.has(k)) result = { data: null, error: { code: '23505', message: 'duplicate' } };
            else jobs.set(k, { ...payload, created_at: new Date().toISOString() });
          } else if (op === 'update') {
            if (jobs.has(k)) Object.assign(jobs.get(k), payload);
          }
          return Promise.resolve(result).then(ok, err);
        },
      };
      return b;
    },
  };
}
stubModule('lib/supabase.js', fakeSupabase());

const express = require('express');
const request = require('supertest');
const { idempotent } = require('../lib/idempotency');

let handlerRuns = 0;
let handlerBehavior = 'ok';
const app = express();
app.post('/gen', idempotent('gen'), (req, res) => {
  handlerRuns++;
  if (handlerBehavior === 'fail') return res.status(502).json({ error: 'provider down' });
  if (handlerBehavior === 'hang') {
    // Slow generation: responds after a delay so the test can observe the
    // in-flight state without keeping the process alive forever.
    return setTimeout(() => res.json({ items: [], slow: true }), 300);
  }
  res.json({ items: [{ id: 'a1' }], run: handlerRuns });
});

test('no header → passthrough, handler always runs', async () => {
  jobs.clear(); handlerRuns = 0; handlerBehavior = 'ok';
  await request(app).post('/gen');
  await request(app).post('/gen');
  assert.equal(handlerRuns, 2);
});

test('repeated key runs the handler once and replays the stored result', async () => {
  jobs.clear(); handlerRuns = 0; handlerBehavior = 'ok';
  const first = await request(app).post('/gen').set('Idempotency-Key', 'k1');
  assert.equal(first.status, 200);
  // allow the async result-store update to settle
  await new Promise((r) => setTimeout(r, 20));
  const second = await request(app).post('/gen').set('Idempotency-Key', 'k1');
  assert.equal(second.status, 200);
  assert.equal(second.headers['idempotency-replayed'], 'true');
  assert.deepEqual(second.body, first.body);
  assert.equal(handlerRuns, 1, 'handler must not re-run');
});

test('an in-flight key returns 409 IN_PROGRESS', async () => {
  jobs.clear(); handlerRuns = 0; handlerBehavior = 'hang';
  const slow = request(app).post('/gen').set('Idempotency-Key', 'k2').then((r) => r);
  await new Promise((r) => setTimeout(r, 50)); // let the claim land, response still pending
  const dup = await request(app).post('/gen').set('Idempotency-Key', 'k2');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'IN_PROGRESS');
  assert.equal(handlerRuns, 1);
  await slow; // let the slow response finish so the process can exit
});

test('a failed run is retryable with the same key and error bodies are not replayed', async () => {
  jobs.clear(); handlerRuns = 0; handlerBehavior = 'fail';
  const f = await request(app).post('/gen').set('Idempotency-Key', 'k3');
  assert.equal(f.status, 502);
  await new Promise((r) => setTimeout(r, 20));
  handlerBehavior = 'ok';
  const retry = await request(app).post('/gen').set('Idempotency-Key', 'k3');
  assert.equal(retry.status, 200);
  assert.equal(retry.body.items[0].id, 'a1');
  assert.equal(handlerRuns, 2, 'failure must allow a real retry');
});

test('an orphaned in-flight row (old timestamp) is taken over', async () => {
  jobs.clear(); handlerRuns = 0; handlerBehavior = 'ok';
  jobs.set('u1:k4', {
    user_id: 'u1', idempotency_key: 'k4', route: 'gen', status: 'in_flight',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const r = await request(app).post('/gen').set('Idempotency-Key', 'k4');
  assert.equal(r.status, 200);
  assert.equal(handlerRuns, 1);
});
