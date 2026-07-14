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

// Anon-key client for Supabase Auth (GoTrue) operations. Separate from the
// service_role client above: it only ever performs auth calls (signUp,
// signInWithPassword, getUser, refreshSession, verifyOtp, resetPasswordForEmail).
// We manage tokens ourselves via HttpOnly cookies, so session persistence and
// auto-refresh are disabled.
let authClientInstance = null;
function authClient() {
  if (authClientInstance) return authClientInstance;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw Object.assign(
      new Error('Auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing).'),
      { status: 503 }
    );
  }
  authClientInstance = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: 'pkce' },
  });
  return authClientInstance;
}

// service_role admin client for privileged auth admin calls (e.g. global
// sign-out / user deletion). Bypasses RLS — server-side only.
let adminClientInstance = null;
function adminClient() {
  if (adminClientInstance) return adminClientInstance;
  adminClientInstance = get(); // same service_role client
  return adminClientInstance;
}

const proxy = new Proxy(
  {},
  {
    get(_t, prop) {
      const value = get()[prop];
      return typeof value === 'function' ? value.bind(get()) : value;
    },
  }
);

proxy.authClient = authClient;
proxy.adminClient = adminClient;

module.exports = proxy;
