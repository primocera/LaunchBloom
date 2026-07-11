const { createClient } = require('@supabase/supabase-js');

// Lazy init (same reasoning as lib/stripe.js): a missing Supabase env var
// should surface as a clean per-request error, not crash the whole serverless
// function at cold-start so that even /health returns 500.
let client = null;

function get() {
  if (client) return client;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(
      new Error('Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).'),
      { status: 503 }
    );
  }
  // Service role client bypasses RLS - keep server-side only
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

module.exports = new Proxy(
  {},
  {
    get(_t, prop) {
      const value = get()[prop];
      return typeof value === 'function' ? value.bind(get()) : value;
    },
  }
);
