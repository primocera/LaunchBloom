const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');

function buildApp(userEmail) {
  stubModule('lib/supabase.js', makeFakeSupabase());
  stubModule('lib/auth.js', {
    requireAuth: (req, _res, next) => { req.userEmail = userEmail; req.userId = 'u1'; next(); },
    resolveUser: async () => null,
  });
  delete require.cache[require.resolve('../routes/admin')];
  const express = require('express');
  const app = express();
  app.use(require('../routes/admin'));
  return app;
}

test('admin routes reject non-allowlisted users with 403', async () => {
  process.env.ADMIN_EMAILS = 'boss@launchbloom.app';
  const request = require('supertest');
  const res = await request(buildApp('random@user.com')).get('/api/admin/health');
  assert.equal(res.status, 403);
});

test('admin routes allow allowlisted admins', async () => {
  process.env.ADMIN_EMAILS = 'boss@launchbloom.app';
  const request = require('supertest');
  const res = await request(buildApp('Boss@LaunchBloom.app')).get('/api/admin/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.window, '24h');
});

test('feature flags: default-on, env enable and disable', () => {
  const { enabled } = require('../lib/flags');
  delete process.env.FEATURE_FLAGS;
  assert.equal(enabled('beta_feedback'), true);
  assert.equal(enabled('unknown_flag'), false);
  process.env.FEATURE_FLAGS = 'unknown_flag,-beta_feedback';
  assert.equal(enabled('unknown_flag'), true);
  assert.equal(enabled('beta_feedback'), false);
  delete process.env.FEATURE_FLAGS;
});
