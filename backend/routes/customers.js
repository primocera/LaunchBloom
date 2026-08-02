// ---------------------------------------------------------------------------
// Customers + plan resolution. Inherited from ConversionForge; the only
// OfferFlow change is that price→plan mapping comes from env vars
// (STRIPE_PRICE_STARTER / _PRO / _BUSINESS) instead of hardcoded price ids.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
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
 * POST /api/customers
 * Creates or retrieves a customer record in Supabase and Stripe.
 * Body: { email, name, metadata }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { email, name, metadata = {} } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: existing } = await supabase
      .from('customers')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (existing) {
      return res.json(sanitizeCustomer(existing));
    }

    const stripeCustomer = await stripe.customers.create({
      email: normalizedEmail,
      name: name || undefined,
      metadata: { ...metadata, source: 'launchbloom' },
    });

    const { data: customer, error } = await supabase
      .from('customers')
      .insert({
        email: normalizedEmail,
        name: name || null,
        stripe_customer_id: stripeCustomer.id,
        metadata,
      })
      .select()
      .single();

    if (error) {
      await stripe.customers.del(stripeCustomer.id).catch(() => {});
      return res.status(500).json({ error: 'Failed to save customer' });
    }

    res.status(201).json(sanitizeCustomer(customer));
  } catch (err) {
    console.error('create-customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
    console.error('get-customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/customers/:id/portal — Stripe Billing Portal session. Query: { returnUrl } */
router.get('/:id/portal', requireAuth, async (req, res) => {
  try {
    const { returnUrl } = req.query;
    if (!returnUrl) {
      return res.status(400).json({ error: 'returnUrl query parameter is required' });
    }

    const { data: customer, error } = await supabase
      .from('customers')
      .select('stripe_customer_id, email')
      .eq('id', req.params.id)
      .single();

    if (customer && customer.email?.toLowerCase() !== req.userEmail.toLowerCase()) {
      return res.status(404).json({ error: 'Customer or Stripe account not found' });
    }
    if (error || !customer?.stripe_customer_id) {
      return res.status(404).json({ error: 'Customer or Stripe account not found' });
    }

    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: returnUrl,
      });
    } catch (err) {
      if (err.code === 'resource_missing') {
        // Stale id (test-mode/foreign customer on the shared Stripe account).
        await supabase
          .from('customers')
          .update({ stripe_customer_id: null })
          .eq('id', req.params.id);
        return res.status(404).json({ error: 'Customer or Stripe account not found' });
      }
      throw err;
    }

    res.json({ url: session.url });
  } catch (err) {
    console.error('billing-portal error:', err);
    res.status(500).json({ error: err.message });
  }
});

function sanitizeCustomer(customer) {
  // Never expose Stripe internals to clients
  const { stripe_customer_id, ...safe } = customer;
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
