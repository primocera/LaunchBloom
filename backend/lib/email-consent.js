// ---------------------------------------------------------------------------
// v10 SC-06 — email categories, unsubscribe tokens and the suppression list.
//
// Two categories, and the difference is not cosmetic:
//
//   transactional  Billing, security and account records. A customer who paid
//                  is entitled to these; they carry no unsubscribe link and are
//                  never gated by a suppression entry. Suppressing them would
//                  mean silently withholding a receipt or a charge notice.
//   marketing      Optional. Always suppressible, always carries a one-click
//                  unsubscribe, and is checked against the suppression list
//                  before every send.
//
// Getting this backwards in either direction is a real failure: gating
// transactional email hides money events from customers; failing to gate
// marketing email ignores a withdrawal of consent.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const supabase = require('./supabase');
const { BRAND } = require('./brand');

/**
 * Every template must be classified. An unclassified type is treated as
 * marketing (the safer default: suppressible), and callers are warned, so a
 * new template can never quietly bypass consent.
 */
const CATEGORY = {
  // Transactional — money, access and account records.
  trial_started: 'transactional',
  trial_ending: 'transactional',
  payment_succeeded: 'transactional',
  payment_failed: 'transactional',
  payment_recovered: 'transactional',
  cancellation_scheduled: 'transactional',
  cancellation_completed: 'transactional',
  plan_changed: 'transactional',
  deletion_completed: 'transactional',
  // Marketing / optional — helpful, but nobody is owed them.
  welcome: 'marketing',
  activation_nudge: 'marketing',
};

function categoryOf(type) {
  const known = CATEGORY[type];
  if (known) return known;
  console.warn(`[email-consent] "${type}" is not classified — defaulting to marketing (suppressible).`);
  return 'marketing';
}

const isTransactional = (type) => categoryOf(type) === 'transactional';

// ── unsubscribe tokens ─────────────────────────────────────────────────────
// Stateless and signed: the link works from an email client with no session,
// but cannot be guessed, and cannot be pointed at somebody else's address.

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is required to sign unsubscribe links.');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** token = base64url(email).signature — signature covers the email itself. */
function unsubscribeToken(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return null;
  const payload = b64url(addr);
  const sig = crypto.createHmac('sha256', secret()).update(`unsub:${addr}`).digest('base64url').slice(0, 32);
  return `${payload}.${sig}`;
}

/** Returns the verified email address, or null. Constant-time comparison. */
function verifyUnsubscribeToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  let addr;
  try {
    addr = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!addr || !addr.includes('@')) return null;

  const expected = crypto.createHmac('sha256', secret()).update(`unsub:${addr}`).digest('base64url').slice(0, 32);
  const given = raw.slice(dot + 1);
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return addr;
}

function unsubscribeUrl(email) {
  const token = unsubscribeToken(email);
  if (!token) return null;
  const base = (process.env.PUBLIC_URL || BRAND.siteUrl || '').replace(/\/$/, '');
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

// ── suppression list ───────────────────────────────────────────────────────

/**
 * True when this address has withdrawn consent. Fails OPEN for transactional
 * mail (callers do not consult it) and fails CLOSED for marketing: if the
 * suppression table cannot be read we do not send, because sending to someone
 * who unsubscribed is worse than a missed nudge.
 */
async function isSuppressed(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return true;
  try {
    const { data, error } = await supabase
      .from('email_suppressions').select('email').eq('email', addr).single();
    if (error && error.code === 'PGRST116') return false; // no row: not suppressed
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error('[email-consent] suppression lookup failed, refusing to send marketing:', err.message);
    return true;
  }
}

/** Idempotent: unsubscribing twice is not an error. */
async function suppress(email, { reason = 'unsubscribed', sourceTemplate = null } = {}) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return false;
  const { error } = await supabase
    .from('email_suppressions')
    .upsert({ email: addr, reason, source_template: sourceTemplate }, { onConflict: 'email' });
  if (error) {
    console.error('[email-consent] could not record suppression:', error.message);
    return false;
  }
  return true;
}

/** Re-subscribe (owner/support action, or the user opting back in). */
async function unsuppress(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return false;
  const { error } = await supabase.from('email_suppressions').delete().eq('email', addr);
  return !error;
}

module.exports = {
  CATEGORY, categoryOf, isTransactional,
  unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl,
  isSuppressed, suppress, unsuppress,
};
