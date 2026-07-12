// ---------------------------------------------------------------------------
// Sessions + credits. (Same design as ConversionForge's lib/auth.js.)
//
// Login (POST /api/auth/login {email}) mints a signed session token:
//   base64url(email|exp).hmac - stateless, 30 days, no DB lookups.
// Credits: free accounts get FREE_CREDITS lifetime credits (tracked
// server-side in the storage bucket); active subscribers are unlimited.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const supabase = require('./supabase');

const BUCKET = 'offerflow-data';
const CREDITS_KEY = 'credits.json';

const FREE_CREDITS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET must be set for auth');
  return s;
}

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

// ── passwords (Prompt 8: email/password auth) ───────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const check = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), check);
  } catch (e) {
    return false;
  }
}

// ── sessions ────────────────────────────────────────────────────────────────

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

function mintSession(email) {
  const payload = email + '|' + (Date.now() + SESSION_TTL_MS);
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return b64url(payload) + '.' + sig;
}

/** Returns the email for a valid unexpired token, else null. */
function sessionEmail(token) {
  try {
    const [p, sig] = String(token).split('.');
    if (!p || !sig) return null;
    const payload = Buffer.from(p, 'base64url').toString('utf8');
    const expect = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const [email, exp] = payload.split('|');
    if (!email || Number(exp) < Date.now()) return null;
    return email.toLowerCase();
  } catch (e) {
    return null;
  }
}

/** Express middleware: attaches req.userEmail or 401s. */
function requireAuth(req, res, next) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const email = sessionEmail(token);
  if (!email) return res.status(401).json({ error: 'Sign in required.', code: 'AUTH' });
  req.userEmail = email;
  next();
}

// ── credits ─────────────────────────────────────────────────────────────────

async function creditsUsed(email) {
  const all = await readJson(CREDITS_KEY, {});
  return all[email] || 0;
}

/**
 * Charge `cost` credits. Returns {ok, used, limit} - ok=false when there
 * aren't enough left. Callers must check the plan first; paid users should
 * never be charged.
 */
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
  mintSession,
  sessionEmail,
  requireAuth,
  creditsUsed,
  chargeCredit,
  hashPassword,
  verifyPassword,
};
