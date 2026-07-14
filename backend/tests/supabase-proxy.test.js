const test = require('node:test');
const assert = require('node:assert/strict');

// Regression: the lib/supabase Proxy get-trap must expose authClient/adminClient
// (they were shadowed by the trap and returned undefined at runtime, crashing
// login with "supabase.authClient is not a function"). Uses the REAL module.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';

const supabase = require('../lib/supabase');

test('supabase.authClient is callable and returns an auth client', () => {
  assert.equal(typeof supabase.authClient, 'function');
  const client = supabase.authClient();
  assert.ok(client && client.auth, 'authClient() must return a client with .auth');
});

test('supabase.adminClient is callable', () => {
  assert.equal(typeof supabase.adminClient, 'function');
  assert.ok(supabase.adminClient());
});
