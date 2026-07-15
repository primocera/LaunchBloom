const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');

test('track() inserts an event row and never throws on failure', async () => {
  const inserted = [];
  const db = makeFakeSupabase();
  db.from = (table) => {
    if (table === 'analytics_events') {
      return {
        insert: (row) => { inserted.push(row); return Promise.resolve({ data: null, error: null }); },
      };
    }
    return makeFakeSupabase().from(table);
  };
  stubModule('lib/supabase.js', db);
  delete require.cache[require.resolve('../lib/analytics')];
  const { track, CLIENT_EVENTS } = require('../lib/analytics');

  await track('signup', { userId: 'u1', properties: { verified: true } });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].event, 'signup');
  assert.equal(inserted[0].user_id, 'u1');
  assert.deepEqual(inserted[0].properties, { verified: true });

  assert.ok(CLIENT_EVENTS.has('landing_pricing_viewed'));
  assert.ok(!CLIENT_EVENTS.has('signup')); // backend-only, not client-fireable
});

test('track() swallows DB errors so callers never fail because of analytics', async () => {
  const db = makeFakeSupabase();
  db.from = () => ({ insert: () => Promise.reject(new Error('db down')) });
  stubModule('lib/supabase.js', db);
  delete require.cache[require.resolve('../lib/analytics')];
  const { track } = require('../lib/analytics');

  await assert.doesNotReject(track('signup', { userId: 'u1' }));
});

test('POST /api/events only accepts allowlisted client events', async () => {
  const inserted = [];
  const db = makeFakeSupabase();
  db.from = (table) => {
    if (table === 'analytics_events') {
      return { insert: (row) => { inserted.push(row); return Promise.resolve({ data: null, error: null }); } };
    }
    return makeFakeSupabase().from(table);
  };
  stubModule('lib/supabase.js', db);
  delete require.cache[require.resolve('../lib/analytics')];
  delete require.cache[require.resolve('../routes/events')];

  const express = require('express');
  const request = require('supertest');
  const eventsRouter = require('../routes/events');
  const app = express();
  app.use(eventsRouter);

  const ok = await request(app).post('/api/events').send({ event: 'landing_pricing_viewed', properties: { plan: 'pro' } });
  assert.equal(ok.status, 204);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].event, 'landing_pricing_viewed');

  const rejected = await request(app).post('/api/events').send({ event: 'account_deleted' });
  assert.equal(rejected.status, 204); // silently dropped, not tracked
  assert.equal(inserted.length, 1);
});
