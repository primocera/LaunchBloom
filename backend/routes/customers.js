// ---------------------------------------------------------------------------
// Customers + plan resolution. Inherited from ConversionForge; the only
// OfferFlow change is that price→plan mapping comes from env vars
// (STRIPE_PRICE_STARTER / _PRO / _BUSINESS) instead of hardcoded price ids.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const {
  resolveCanonicalEntitlement,
  ENTITLING_STATUSES,
  EntitlementUnavailableError,
  isEntitlementUnavailable,
  planUnavailableBody,
} = require('../lib/subscription-state');

/**
 * Stripe price id → OfferFlow plan name, built from env at startup.
 * Maps the new monthly/yearly price vars (starter | pro | studio) and keeps the
 * legacy single-price vars working. Old "business" prices resolve to 'studio'.
 */
function pricePlans() {
  const map = {};
  const add = (envVar, plan) => {
    if (process.env[envVar]) map[process.env[envVar]] = plan;
  };
  // New monthly/yearly prices
  add('STRIPE_PRICE_STARTER_MONTHLY', 'starter');
  add('STRIPE_PRICE_STARTER_YEARLY', 'starter');
  add('STRIPE_PRICE_PRO_MONTHLY', 'pro');
  add('STRIPE_PRICE_PRO_YEARLY', 'pro');
  add('STRIPE_PRICE_STUDIO_MONTHLY', 'studio');
  add('STRIPE_PRICE_STUDIO_YEARLY', 'studio');
  // Legacy single-price vars (business → studio alias for old data)
  add('STRIPE_PRICE_STARTER', 'starter');
  add('STRIPE_PRICE_PRO', 'pro');
  add('STRIPE_PRICE_BUSINESS', 'studio');
  return map;
}

/**
 * SV-21-01 (v21): resolve the caller's local `customers` row by CANONICAL
 * identity. This is the single place the runtime decides which column IS the
 * owner key, so payments, the billing portal, cancellation, account deletion and
 * the billing display can never drift to different keys.
 *
 *   - Enforcement ON (owner has applied migration 038, backfilled app_user_id and
 *     applied the additive uniqueness in 039): the stable Supabase user UUID
 *     column `app_user_id` is the owner key. Email is mutable display data and is
 *     never the identity, so an email change can neither orphan nor switch billing
 *     identity. Multiple rows for one app_user_id FAIL CLOSED (reconciliation
 *     required) — never an arbitrary winner.
 *   - Enforcement OFF (capped beta / pre-038 schema): the historical email key is
 *     used, so behaviour and the applied schema are unchanged.
 *
 * A real read error throws EntitlementUnavailableError (fail closed — never read
 * as "no customer"); a verified no-row returns null.
 */
async function findCustomerRow(identity, columns = 'id, stripe_customer_id') {
  const { ownershipEnforced } = require('../lib/stripe-ownership');
  const userId = identity && identity.userId;
  const email = ((identity && identity.email) || '').trim().toLowerCase();

  if (ownershipEnforced() && userId) {
    const { data, error } = await supabase
      .from('customers')
      .select(columns)
      .eq('app_user_id', userId);
    if (error) throw new EntitlementUnavailableError(error);
    const rows = data || [];
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      const e = new Error('customer reconciliation required');
      e.code = 'CUSTOMER_RECONCILIATION_REQUIRED';
      e.candidateCount = rows.length;
      e.reason = 'multiple_rows_for_app_user_id';
      throw e;
    }
    return rows[0];
  }

  if (!email) return null;
  const { data, error } = await supabase
    .from('customers')
    .select(columns)
    .eq('email', email)
    .single();
  if (readFailed(error)) throw new EntitlementUnavailableError(error);
  return data || null;
}

// v13 SC-P0-05 — REMOVED: POST /api/customers.
// It took the billing email from the request body, so any signed-in user could
// mint a Stripe customer for someone else's address and forward arbitrary
// metadata to Stripe. It had no caller (frontend, api/, scripts, tests or
// docs); the only supported way a customer row is created is payments.js
// checkout, which derives the email from the session. Do not reintroduce a
// route that accepts a client-supplied billing identity.
//
// v13 SC-P0-05 — REMOVED: GET /api/customers/:id/portal?returnUrl=.
// It opened a Stripe Billing Portal session with a client-controlled
// return_url (an open redirect off a trusted billing domain) and was
// superseded by the canonical POST /api/account/billing-portal, which derives
// both the customer and the return URL server-side.

// PostgREST returns this code from .single() when the filter matched no row.
// That is a VERIFIED "no such record", not a failure — everything else is.
const NO_ROWS = 'PGRST116';

function readFailed(error) {
  return !!error && error.code !== NO_ROWS;
}

/** Mask an email for logs: keeps it correlatable without printing the identity. */
function redactEmail(email) {
  const [user = '', domain = ''] = String(email).split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/**
 * v13 SC-P0-02 — one redacted, structured billing anomaly line per impossible
 * state. Access is NOT changed by this; it is an operations signal only. The
 * email is masked (correlatable, not identifying) and every other field is an
 * opaque Stripe id, so this is safe to ship to a log drain.
 */
function reportBillingAnomaly(email, anomaly) {
  console.error(JSON.stringify({
    code: 'BILLING_ANOMALY',
    level: 'error',
    source: 'resolveEntitlement',
    email: redactEmail(email),
    ...anomaly,
  }));
}

/**
 * The explicit entitlement result model (v13 SC-P0-01). Exactly one of:
 *
 *   { state: 'free',        plan: null }  verified: no entitling subscription
 *   { state: 'entitled',    plan: 'trial'|'starter'|'pro'|'studio' }
 *   { state: 'unmapped',    plan: null }  verified entitling sub, price not in env
 *   { state: 'unavailable', plan: null }  could NOT verify (db/provider failure)
 *
 * 'unavailable' must never be collapsed into 'free' by a caller. planFor()
 * throws EntitlementUnavailableError for it so a caller cannot ignore it by
 * accident; use resolveEntitlement() directly when the state matters.
 */
async function resolveEntitlement(email) {
  email = (email || '').trim().toLowerCase();
  if (!email) return { state: 'free', plan: null };
  try {
    const { data: customer, error: customerErr } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .single();

    if (readFailed(customerErr)) throw new EntitlementUnavailableError(customerErr);
    if (!customer) return { state: 'free', plan: null };

    // A customer can hold more than one entitling row — an old subscription on a
    // now-retired price sitting beside the current one, a trialing row beside a
    // paid one, or overlapping test subs. The canonical policy (v13 SC-P0-02,
    // docs/decisions/2026-08-02-canonical-entitlement.md) is HIGHEST VALID
    // ENTITLEMENT WINS, decided by a pure resolver whose answer does not depend
    // on database row order. The ORDER BY below is only a stable read; the
    // resolver re-sorts. Entitlement stays decided by the canonical state
    // machine, so planFor() and the webhook can never disagree.
    const { data: subs, error: subsErr } = await supabase
      .from('subscriptions')
      .select('status, stripe_price_id, stripe_subscription_id, stripe_event_at')
      .eq('customer_id', customer.id)
      .in('status', ENTITLING_STATUSES)
      .order('stripe_event_at', { ascending: false, nullsFirst: false });

    if (readFailed(subsErr)) throw new EntitlementUnavailableError(subsErr);

    const canonical = resolveCanonicalEntitlement(subs || [], pricePlans());
    // Anomalies are reported but never change access: an overlapping customer
    // keeps the safest valid plan while operations reconciles the duplicate.
    for (const anomaly of canonical.anomalies) reportBillingAnomaly(email, anomaly);
    if (canonical.plan) return { state: 'entitled', plan: canonical.plan };
    const unmapped = canonical.unmapped;

    // Succeeded one-time payment = lifetime access
    const { data: payment, error: paymentErr } = await supabase
      .from('payments')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('status', 'succeeded')
      .limit(1)
      .single();

    if (readFailed(paymentErr)) throw new EntitlementUnavailableError(paymentErr);
    if (payment) return { state: 'entitled', plan: 'pro' };

    return { state: unmapped ? 'unmapped' : 'free', plan: null };
  } catch (e) {
    if (isEntitlementUnavailable(e)) return { state: 'unavailable', plan: null };
    // Any other throw (network reset, proxy blow-up) is equally "we do not
    // know" — it is never evidence that the customer is on the free plan.
    console.error(JSON.stringify({
      code: 'PLAN_LOOKUP_FAILED',
      level: 'error',
      source: 'resolveEntitlement',
      email: redactEmail(email),
      message: (e && e.message) || String(e),
    }));
    return { state: 'unavailable', plan: null };
  }
}

/**
 * 'trial' | 'starter' | 'pro' | 'studio' | null — the single source of plan
 * truth. THROWS EntitlementUnavailableError when the lookup could not be
 * verified, so no caller can mistake a failure for "verified free".
 */
async function planFor(email) {
  const result = await resolveEntitlement(email);
  if (result.state === 'unavailable') throw new EntitlementUnavailableError();
  return result.plan;
}

async function verifyPlanHandler(req, res) {
  // Only ever answers for the signed-in account — no probing other emails.
  const { state, plan } = await resolveEntitlement(req.userEmail);
  if (state === 'unavailable') {
    // Do NOT report active:false — the UI must keep the access it already shows.
    return res.status(503).json({ ...planUnavailableBody(), plan: null, active: null });
  }
  res.json({ active: !!plan, plan });
}

router.get('/verify-plan', requireAuth, verifyPlanHandler);

/** GET /api/customers/:id */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !customer || customer.email?.toLowerCase() !== req.userEmail.toLowerCase()) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(sanitizeCustomer(customer));
  } catch (err) {
    // v14 SC-03: never echo the raw Supabase/internal message to the client.
    console.error('[get-customer] error', err && err.code, err && err.message);
    res.status(500).json({ error: 'Could not load this customer right now. Please try again.', code: 'CUSTOMER_LOOKUP_FAILED' });
  }
});

function sanitizeCustomer(customer) {
  // Never expose Stripe internals to clients
  const safe = { ...customer };
  delete safe.stripe_customer_id;
  return safe;
}

/** True when the email has an active/trialing subscription or a succeeded one-time payment. */
async function isPlanActive(email) {
  return !!(await planFor(email));
}

module.exports = router;
module.exports.verifyPlanHandler = verifyPlanHandler;
module.exports.planFor = planFor;
module.exports.resolveEntitlement = resolveEntitlement;
module.exports.isPlanActive = isPlanActive;
module.exports.pricePlans = pricePlans;
// v14 SC-02: the canonical read-failure semantics (PGRST116 = verified no-row,
// everything else = unavailable) and the PII-safe email redactor, exported so
// payments.js fails closed through the SAME model instead of a second one.
module.exports.readFailed = readFailed;
module.exports.NO_ROWS = NO_ROWS;
module.exports.redactEmail = redactEmail;
// SV-21-01: the ONE canonical local-customer lookup (app_user_id under
// enforcement, email before it), reused by payments, account and billing so the
// owner key can never diverge across billing entry points.
module.exports.findCustomerRow = findCustomerRow;
