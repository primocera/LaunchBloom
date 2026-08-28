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
const { isEntitlementUnavailable } = require('./subscription-state');

const planCache = new Map(); // cacheKey -> { active, ts }

// SV-22-01: cache and resolve by the STABLE user id when we have it (email is
// mutable), so a changed email cannot serve a stale "paid" answer to the wrong
// key. Falls back to email before enforcement / when no id is present.
async function planActiveCached(identity) {
  try {
    const userId = identity && typeof identity === 'object' ? identity.userId : null;
    const email = ((identity && typeof identity === 'object' ? identity.email : identity) || '');
    const cacheKey = userId || email;
    if (!cacheKey) return false;
    const hit = planCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.active;
    const active = await isPlanActive({ userId, email });
    planCache.set(cacheKey, { active, ts: Date.now() });
    return active;
  } catch (e) {
    // v13 SC-P0-01: "could not verify" is NOT "not paid" — let it propagate so
    // the route answers 503 instead of silently metering a paying user.
    if (isEntitlementUnavailable(e)) throw e;
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
        req.userPaid = await planActiveCached({ userId: req.userId, email: req.userEmail });
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
