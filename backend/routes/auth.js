// ---------------------------------------------------------------------------
// Prompt 8: email/password auth. Signup creates a users row (scrypt hash),
// login verifies it; both mint the stateless HMAC session token that the
// rest of the API authenticates with. Friendly error states per the spec.
//
// POST /api/auth/signup { email, password } → { token, ...account }
// POST /api/auth/login  { email, password } → { token, ...account }
// GET  /api/auth/me     (Bearer)            → account status
// ---------------------------------------------------------------------------

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../lib/auth');
const supabase = require('../lib/supabase');
const { planFor } = require('./customers');
const { limitsFor, usageFor } = require('../lib/plan-limits');
const { ensureWorkspace } = require('./workspaces');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts - try again in a few minutes.' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function accountStatus(email) {
  const plan = (await planFor(email)) || 'free'; // 'free' | 'starter' | 'pro' | 'business'
  const limits = limitsFor(plan);
  const ws = await ensureWorkspace(email);
  const usage = await usageFor(ws.id, plan);
  return {
    email,
    plan,
    plan_label: limits.label,
    usage,
    limits: {
      positioning: limits.positioning === Infinity ? null : limits.positioning,
      offer_generations: limits.offer_generations === Infinity ? null : limits.offer_generations,
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

router.post('/api/auth/signup', loginLimiter, express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const creds = readCredentials(req, res);
    if (!creds) return;

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', creds.email)
      .single();
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const { error } = await supabase
      .from('users')
      .insert({ email: creds.email, password_hash: auth.hashPassword(creds.password) });
    if (error) throw new Error('Could not create the account. Please try again.');

    const status = await accountStatus(creds.email);
    res.status(201).json(Object.assign({ ok: true, token: auth.mintSession(creds.email) }, status));
  } catch (err) {
    next(err);
  }
});

router.post('/api/auth/login', loginLimiter, express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const creds = readCredentials(req, res);
    if (!creds) return;

    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('email', creds.email)
      .single();

    if (!user) {
      return res.status(401).json({ error: "No account with this email yet. Create one first.", code: 'NO_ACCOUNT' });
    }
    if (!auth.verifyPassword(creds.password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const status = await accountStatus(creds.email);
    res.json(Object.assign({ ok: true, token: auth.mintSession(creds.email) }, status));
  } catch (err) {
    next(err);
  }
});

router.get('/api/auth/me', auth.requireAuth, async (req, res, next) => {
  try {
    res.json(await accountStatus(req.userEmail));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
