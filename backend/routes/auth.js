// ---------------------------------------------------------------------------
// Simple email login + account status. (Inherited from ConversionForge.)
//
// POST /api/auth/login { email }  → { token, email, plan, credits_used, credits_limit }
// GET  /api/auth/me   (Bearer)    → same account status for an existing session
// ---------------------------------------------------------------------------

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../lib/auth');
const { planFor } = require('./customers');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts - try again in a few minutes.' },
});

async function accountStatus(email) {
  const plan = await planFor(email); // 'starter' | 'pro' | 'business' | null
  const used = plan ? 0 : await auth.creditsUsed(email);
  return {
    email,
    plan: plan || 'free',
    credits_used: used,
    credits_limit: plan ? null : auth.FREE_CREDITS,
  };
}

router.post('/api/auth/login', loginLimiter, express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    const status = await accountStatus(email);
    res.json(Object.assign({ ok: true, token: auth.mintSession(email) }, status));
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
