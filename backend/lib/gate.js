// ---------------------------------------------------------------------------
// Login + credits gate. (Same design as ConversionForge's creditGate in
// routes/generate.js, extracted into a lib so every AI route can use it.)
//
// Subscribers are unlimited; free accounts spend from FREE_CREDITS (lifetime).
// Credits are only charged AFTER the action succeeds (settleCredit) - a
// failed generation never costs anything.
// ---------------------------------------------------------------------------

const authLib = require('./auth');
const { isPlanActive } = require('../routes/customers');

const planCache = new Map(); // email -> { active, ts }

async function planActiveCached(email) {
  try {
    if (!email) return false;
    const hit = planCache.get(email);
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.active;
    const active = await isPlanActive(email);
    planCache.set(email, { active, ts: Date.now() });
    return active;
  } catch (e) {
    return false;
  }
}

/**
 * Middleware factory: sets req.userEmail/req.userPaid, lets subscribers
 * straight through, and rejects free accounts without enough credits left.
 */
function creditGate(cost = 1) {
  return function (req, res, next) {
    authLib.requireAuth(req, res, async () => {
      try {
        req.creditCost = cost;
        req.userPaid = await planActiveCached(req.userEmail);
        if (req.userPaid) return next();
        const used = await authLib.creditsUsed(req.userEmail);
        if (used + cost > authLib.FREE_CREDITS) {
          return res.status(402).json({
            error: 'Free credits used up. Upgrade to keep generating.',
            code: 'CREDITS',
            used,
            limit: authLib.FREE_CREDITS,
          });
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

/** Charge the gate's cost after a successful action; returns the response `credits` field. */
async function settleCredit(req) {
  if (req.userPaid) return { plan: 'paid' };
  const cost = req.creditCost || 0;
  if (!cost) {
    const used = await authLib.creditsUsed(req.userEmail);
    return { plan: 'free', used, limit: authLib.FREE_CREDITS };
  }
  const charge = await authLib.chargeCredit(req.userEmail, cost);
  return { plan: 'free', used: charge.used, limit: charge.limit };
}

module.exports = { creditGate, settleCredit };
