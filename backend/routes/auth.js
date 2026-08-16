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
const { signupDecision, capIsActive, MESSAGES: COHORT_MESSAGES } = require('../lib/cohort-control');

const router = express.Router();

// Local E2E signs in many seeded users from one IP — don't throttle tests
// (matches the general/payment/AI limiters in server.js). Production stays at 20.
const isTestEnv = process.env.NODE_ENV === 'test';
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 100000 : 20,
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
    // LB-V19 (LB-02): expose the STABLE Supabase user UUID so the client can
    // scope device-local drafts by identity — never by the mutable email or the
    // workspace id. This comes from the validated server session, not a client
    // claim (login/signup pass data.user.id; /me passes req.userId).
    id: userId || null,
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

    // v10 SC-07 / v12 SC-V12-07: cohort control, enforced server-side and
    // FAIL-CLOSED. An emergency stop (SIGNUP_PAUSED), a misconfigured cap, or a
    // count we cannot verify all refuse signups rather than silently opening
    // them. Unset or 0 = uncapped normal operation. See lib/cohort-control.js.
    let cohortCount = null;
    if (capIsActive(process.env)) {
      const { count, error: capErr } = await supabase
        .from('workspaces').select('id', { count: 'exact', head: true });
      // null on error → signupDecision fails closed (cannot verify the cap).
      cohortCount = capErr ? null : (count || 0);
    }
    const decision = signupDecision(process.env, cohortCount);
    if (!decision.allow) {
      return res.status(403).json({ error: COHORT_MESSAGES[decision.code], code: decision.code });
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

    // Log consent (best-effort; never blocks signup). Marketing consent is
    // optional and versioned separately from required Terms/Privacy (v5 P15).
    if (data && data.user) {
      const marketingOptIn = (req.body || {}).marketingOptIn === true;
      supabase
        .from('legal_consents')
        .insert({
          user_id: data.user.id,
          email: creds.email,
          terms_version: LEGAL_VERSION,
          marketing_opt_in: marketingOptIn,
          marketing_version: marketingOptIn ? LEGAL_VERSION : null,
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
    } catch {
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
    } catch {
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
    } catch {
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

    // 2026-07-28: every branch below used to require `type === 'signup'`, which
    // only exists on the token_hash form of the link. Supabase's default
    // template sends `{{ .ConfirmationURL }}` → `?code=…` with NO `type`, so on
    // a real deployment a confirmed signup fired NOTHING: no welcome email
    // (email_events had not one `welcome` row in production history), no
    // `verified` analytics event — which silently zeroes that row of the beta
    // funnel — and the new account landed on /app instead of Brand Profile
    // onboarding. One missing query parameter, three broken outcomes.
    //
    // A first verification is a signup whichever link form carried it, so it is
    // now derived from the account rather than from the URL. The welcome email
    // is deduped on `welcome:<user id>`, so treating an ambiguous callback as a
    // signup can never send twice.
    const user = session.user || null;
    const createdAt = user && user.created_at ? Date.parse(user.created_at) : NaN;
    const isFreshAccount = Number.isFinite(createdAt) && Date.now() - createdAt < 24 * 3600 * 1000;
    const isSignup = type === 'signup' || (!type && isFreshAccount);

    if (!isRecovery && isSignup) {
      track('verified', { userId: user && user.id });
      // Idempotent welcome email (v5 Prompt 14) — never blocks the redirect.
      if (user && user.email) {
        const { sendLifecycleEmail } = require('../lib/lifecycle-email');
        sendLifecycleEmail('welcome', user.id, user.email).catch(() => {});
      }
    }
    // New signups land on Brand Profile onboarding (v5 Prompt 2) — account and
    // profile first; the Stripe trial starts only at the first generation.
    if (isRecovery) return res.redirect(`${appUrl()}/app/reset-password`);
    if (isSignup) return res.redirect(`${appUrl()}/app/brand?welcome=1`);
    return res.redirect(`${appUrl()}/app`);
  } catch {
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
