// ---------------------------------------------------------------------------
// Auth routes (audit Prompt 3): Supabase Auth, server-managed HttpOnly cookies.
//
// Flows: signup, email verification, login, logout, forgot/reset password,
// resend verification, session refresh (in requireAuth) and email-link
// callback with expired-link handling. Responses are generic where needed so
// they never reveal whether an account exists.
//
//   POST /api/auth/signup              { email, password }
//   POST /api/auth/login               { email, password }
//   POST /api/auth/logout
//   POST /api/auth/forgot-password     { email }
//   POST /api/auth/reset-password      { password }        (recovery session)
//   POST /api/auth/resend-verification { email }
//   GET  /api/auth/callback            (email links → cookies → redirect)
//   GET  /api/auth/me                  (Bearer-less; cookie session)
// ---------------------------------------------------------------------------

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../lib/auth');
const supabase = require('../lib/supabase');
const { BRAND, LEGAL_VERSION } = require('../lib/brand');
const { setSessionCookies, clearSessionCookies, readAccessToken } = require('../lib/session');
const { planFor } = require('./customers');
const { limitsFor, usageFor } = require('../lib/plan-limits');
const { ensureWorkspace } = require('./workspaces');
const { track } = require('../lib/analytics');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts - try again in a few minutes.' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const json = express.json({ limit: '2kb' });

/** Absolute app base URL for email-link redirects (never trust request Origin). */
function appUrl() {
  return (process.env.PUBLIC_URL || BRAND.siteUrl || '').replace(/\/$/, '');
}
function callbackUrl() {
  return `${appUrl()}/api/auth/callback`;
}

async function accountStatus(email, userId) {
  const plan = (await planFor(email)) || 'free';
  const limits = limitsFor(plan);
  const ws = await ensureWorkspace(email, userId);
  const usage = await usageFor(ws.id, plan, email, userId);
  return {
    email,
    plan,
    plan_label: limits.label,
    usage,
    limits: {
      ai_actions: limits.ai_actions === Infinity ? null : limits.ai_actions,
      launch_kits: limits.launch_kits === Infinity ? null : limits.launch_kits,
      content_plan_days: limits.content_plan_days,
      can_export: limits.can_export,
      monthly: limits.monthly,
    },
  };
}

function readCredentials(req, res) {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return null;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return null;
  }
  return { email, password };
}

// ── signup ───────────────────────────────────────────────────────────────
router.post('/api/auth/signup', loginLimiter, json, async (req, res, next) => {
  try {
    const creds = readCredentials(req, res);
    if (!creds) return;

    // Consent is required and version-logged (Prompt 14).
    if ((req.body || {}).acceptTerms !== true) {
      return res.status(400).json({ error: 'Please accept the Terms and Privacy Policy to continue.' });
    }

    const client = supabase.authClient();
    const { data, error } = await client.auth.signUp({
      email: creds.email,
      password: creds.password,
      options: { emailRedirectTo: callbackUrl() },
    });

    // Do NOT leak whether the email already exists. Supabase already returns an
    // obfuscated user for existing accounts; treat any non-rate-limit error as
    // a generic success so signup is not an account-enumeration oracle.
    if (error && !/rate limit/i.test(error.message || '')) {
      return res.status(200).json({ ok: true, requiresVerification: true });
    }
    if (error) {
      return res.status(429).json({ error: 'Too many attempts - try again in a few minutes.' });
    }

    // Log consent (best-effort; never blocks signup).
    if (data && data.user) {
      supabase
        .from('legal_consents')
        .insert({
          user_id: data.user.id,
          email: creds.email,
          terms_version: LEGAL_VERSION,
          ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
        })
        .then(() => {}, () => {});
    }

    // Email confirmation disabled → Supabase returns a session; log the user in.
    if (data && data.session) {
      setSessionCookies(res, data.session);
      const status = await accountStatus(creds.email, data.user && data.user.id);
      track('signup', { userId: data.user && data.user.id, properties: { verified: true } });
      return res.status(201).json(Object.assign({ ok: true, requiresVerification: false }, status));
    }

    track('signup', { userId: data && data.user && data.user.id, properties: { verified: false } });
    return res.status(201).json({ ok: true, requiresVerification: true });
  } catch (err) {
    next(err);
  }
});

// ── login ────────────────────────────────────────────────────────────────
router.post('/api/auth/login', loginLimiter, json, async (req, res, next) => {
  try {
    const creds = readCredentials(req, res);
    if (!creds) return;

    const client = supabase.authClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });

    if (error) {
      if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) {
        return res.status(403).json({
          error: 'Please verify your email first. Check your inbox for the link.',
          code: 'EMAIL_NOT_CONFIRMED',
        });
      }
      // Generic: do not distinguish "no account" from "wrong password".
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    setSessionCookies(res, data.session);
    const status = await accountStatus(creds.email, data.user && data.user.id);
    res.json(Object.assign({ ok: true }, status));
  } catch (err) {
    next(err);
  }
});

// ── logout (revokes the session server-side) ───────────────────────────────
router.post('/api/auth/logout', json, async (req, res) => {
  const token = readAccessToken(req);
  if (token) {
    try {
      await supabase.adminClient().auth.admin.signOut(token, 'global');
    } catch (e) {
      /* best-effort revocation; cookie is cleared regardless */
    }
  }
  clearSessionCookies(res);
  res.json({ ok: true });
});

// ── forgot password (always generic) ───────────────────────────────────────
router.post('/api/auth/forgot-password', loginLimiter, json, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      await supabase.authClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${callbackUrl()}?flow=recovery`,
      });
    } catch (e) {
      /* swallow — never reveal whether the account exists */
    }
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

// ── reset password (recovery session set by /callback) ─────────────────────
router.post('/api/auth/reset-password', auth.requireAuth, json, async (req, res, next) => {
  try {
    const password = String((req.body || {}).password || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    // service_role admin update — no need for the user's own token.
    const { error } = await supabase.adminClient().auth.admin.updateUserById(req.userId, { password });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── resend verification (always generic) ───────────────────────────────────
router.post('/api/auth/resend-verification', loginLimiter, json, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      await supabase.authClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: callbackUrl() },
      });
    } catch (e) {
      /* swallow */
    }
  }
  res.json({ ok: true });
});

// ── email-link callback (verification + recovery) ──────────────────────────
// Supabase email templates should use the token_hash form:
//   {{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type={{ .Type }}
// We also accept a PKCE ?code= as a best-effort fallback.
router.get('/api/auth/callback', async (req, res) => {
  const { token_hash: tokenHash, type, code, flow } = req.query || {};
  const client = supabase.authClient();
  const loginErr = `${appUrl()}/app/login?error=expired_link`;

  try {
    let session = null;

    if (tokenHash && type) {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) return res.redirect(loginErr);
      session = data.session;
    } else if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) return res.redirect(loginErr);
      session = data.session;
    } else {
      return res.redirect(loginErr);
    }

    if (!session) return res.redirect(loginErr);
    setSessionCookies(res, session);

    const isRecovery = flow === 'recovery' || type === 'recovery';
    if (!isRecovery && type === 'signup') {
      track('verified', { userId: session.user && session.user.id });
    }
    return res.redirect(isRecovery ? `${appUrl()}/app/reset-password` : `${appUrl()}/app`);
  } catch (e) {
    return res.redirect(loginErr);
  }
});

// ── current account ────────────────────────────────────────────────────────
router.get('/api/auth/me', auth.requireAuth, async (req, res, next) => {
  try {
    const status = await accountStatus(req.userEmail, req.userId);
    status.email_verified = !!(req.authUser && req.authUser.email_confirmed_at);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
