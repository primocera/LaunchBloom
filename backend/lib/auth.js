// ---------------------------------------------------------------------------
// Authentication (audit Prompt 3): Supabase Auth with server-managed HttpOnly
// cookies. The old stateless HMAC token in localStorage is gone. Each request
// is authenticated from the sb_access cookie (validated against Supabase Auth);
// an expired access token is silently refreshed with the sb_refresh cookie.
//
// The credit helpers (creditsUsed / chargeCredit) are the inherited
// ConversionForge credit system used by lib/gate.js and are kept unchanged.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const {
  readAccessToken,
  readRefreshToken,
  setSessionCookies,
  clearSessionCookies,
} = require('./session');

const BUCKET = 'offerflow-data';
const CREDITS_KEY = 'credits.json';

const FREE_CREDITS = 10;

// ── bucket JSON helpers ─────────────────────────────────────────────────────

async function readJson(key, fallback) {
  try {
    const { data } = await supabase.storage.from(BUCKET).download(key);
    if (!data) return fallback;
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  } catch (e) {
    return fallback;
  }
}

async function writeJson(key, value) {
  const { error } = await supabase.storage.from(BUCKET).upload(key, Buffer.from(JSON.stringify(value), 'utf8'), {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw error;
}

// ── session resolution ──────────────────────────────────────────────────────

/**
 * Resolve the Supabase user for a request from its cookies. Validates the
 * access token; if it is missing/expired, tries a refresh and, on success,
 * writes fresh cookies to `res`. Returns the Supabase user or null.
 */
async function resolveUser(req, res) {
  const client = supabase.authClient();

  const access = readAccessToken(req);
  if (access) {
    const { data, error } = await client.auth.getUser(access);
    if (!error && data && data.user) return data.user;
  }

  const refresh = readRefreshToken(req);
  if (refresh) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
    if (!error && data && data.session && data.user) {
      setSessionCookies(res, data.session);
      return data.user;
    }
  }

  return null;
}

/**
 * Express middleware: attaches req.userId (stable UUID) + req.userEmail, or
 * 401s and clears stale cookies. Async under the hood but keeps the classic
 * (req, res, next) signature.
 */
function requireAuth(req, res, next) {
  resolveUser(req, res)
    .then((user) => {
      if (!user) {
        clearSessionCookies(res);
        return res.status(401).json({ error: 'Sign in required.', code: 'AUTH' });
      }
      req.userId = user.id;
      req.userEmail = (user.email || '').toLowerCase();
      req.authUser = user;
      next();
    })
    .catch(next);
}

// ── credits (inherited ConversionForge system, used by lib/gate.js) ──────────

async function creditsUsed(email) {
  const all = await readJson(CREDITS_KEY, {});
  return all[email] || 0;
}

async function chargeCredit(email, cost = 1) {
  const all = await readJson(CREDITS_KEY, {});
  const used = all[email] || 0;
  if (used + cost > FREE_CREDITS) return { ok: false, used, limit: FREE_CREDITS };
  all[email] = used + cost;
  await writeJson(CREDITS_KEY, all);
  return { ok: true, used: used + cost, limit: FREE_CREDITS };
}

module.exports = {
  FREE_CREDITS,
  requireAuth,
  resolveUser,
  creditsUsed,
  chargeCredit,
};
