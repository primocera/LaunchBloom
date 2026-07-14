// ---------------------------------------------------------------------------
// Test helpers for the node:test suites. No secrets and no network: the lazy
// lib/supabase and lib/stripe proxies are replaced in require.cache BEFORE the
// module under test is required, so unit tests never touch real services.
// ---------------------------------------------------------------------------

const path = require('path');

/** Replace a backend module (path relative to backend/) with a stub object. */
function stubModule(relPath, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

/**
 * Chainable fake for the supabase-js query builder. Every method returns the
 * builder; awaiting it (or .single()) resolves to the result for that table,
 * looked up from `results` by table name (default { data: null, error: null }).
 *
 *   makeFakeSupabase({ customers: { data: { id: 1 } } })
 */
function makeFakeSupabase(results = {}) {
  function builderFor(table) {
    const result = results[table] || { data: null, error: null, count: 0 };
    const b = {};
    const chain = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit',
    ];
    for (const m of chain) b[m] = () => b;
    b.single = () => Promise.resolve(result);
    b.then = (onOk, onErr) => Promise.resolve(result).then(onOk, onErr);
    return b;
  }
  return {
    from: (table) => builderFor(table),
    storage: {
      from: () => ({
        download: async () => null,
        upload: async () => ({ error: null }),
      }),
    },
    // Default auth client: unauthenticated (no user, no refresh). Tests that
    // exercise auth flows override this after building the fake.
    authClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }),
        refreshSession: async () => ({ data: { session: null, user: null }, error: { message: 'no refresh' } }),
      },
    }),
    adminClient: () => ({
      auth: { admin: { signOut: async () => ({}), updateUserById: async () => ({ error: null }) } },
    }),
  };
}

/** Minimal express res mock recording status/json for middleware tests. */
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}

module.exports = { stubModule, makeFakeSupabase, mockRes };
