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
  if (missing.length && process.env.NODE_ENV === 'production') {
    console.error('[plans] missing Stripe price env vars:', missing.join(', '));
    return res.status(500).json({ error: 'Pricing is not configured.', code: 'CONFIG' });
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(publicCatalog());
}

router.get('/api/plans', plansHandler);

module.exports = router;
module.exports.plansHandler = plansHandler;
