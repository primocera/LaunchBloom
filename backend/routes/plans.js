// ---------------------------------------------------------------------------
// GET /api/plans — public, read-only commercial catalog (v5 Prompt 1).
// The frontend renders pricing from this so customer-facing numbers can never
// drift from backend enforcement. In production a missing Stripe price env is
// a configuration error, not a silent gap.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const { publicCatalog, missingStripeEnv } = require('../lib/plan-catalog');

function plansHandler(_req, res) {
  const missing = missingStripeEnv();
  if (missing.length) {
    // Optional by default so the app runs before Stripe prices / a real domain
    // exist. Set ENFORCE_LAUNCH_CONFIG=1 for the real launch to hard-fail instead.
    console.warn('[plans] missing Stripe price env vars:', missing.join(', '));
    if (process.env.ENFORCE_LAUNCH_CONFIG === '1') {
      return res.status(500).json({ error: 'Pricing is not configured.', code: 'CONFIG' });
    }
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(publicCatalog());
}

router.get('/api/plans', plansHandler);

// v5 Prompt 15: public legal configuration so the legal pages always show the
// deployed entity values (env-backed) instead of anything hardcoded.
const { BRAND, LEGAL_VERSION, legalPlaceholders } = require('../lib/brand');

function legalHandler(_req, res) {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    legal_name: BRAND.legalName,
    legal_address: BRAND.legalAddress,
    support_email: BRAND.supportEmail,
    privacy_email: BRAND.privacyEmail,
    governing_law: BRAND.governingLaw,
    version: LEGAL_VERSION,
    configured: legalPlaceholders().length === 0,
  });
}

router.get('/api/legal', legalHandler);

module.exports = router;
module.exports.plansHandler = plansHandler;
module.exports.legalHandler = legalHandler;
