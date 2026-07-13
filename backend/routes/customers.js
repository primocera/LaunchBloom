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
      metadata: { ...metadata, source: 'offerflow' },
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

/** 'trial' | 'starter' | 'pro' | 'studio' | null for an email - single source of plan truth. */
async function planFor(email) {
  email = (email || '').trim().toLowerCase();
  if (!email) return null;
  try {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .single();

    if (!customer) return null;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, stripe_price_id')
      .eq('customer_id', customer.id)
      .in('status', ['active', 'trialing'])
      .limit(1)
      .single();

    // A subscription still inside its 3-day free trial gets the limited 'trial'
    // plan regardless of which price it is on; it upgrades to the real plan once
    // Stripe flips the status to 'active'.
    if (sub) {
      if (sub.status === 'trialing') return 'trial';
      return pricePlans()[sub.stripe_price_id] || 'pro';
    }

    // Succeeded one-time payment = lifetime access
    const { data: payment } = await supabase
      .from('payments')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('status', 'succeeded')
      .limit(1)
      .single();

    return payment ? 'pro' : null;
  } catch (e) {
    return null;
  }
}

async function verifyPlanHandler(req, res) {
  // Only ever answers for the signed-in account — no probing other emails.
  const plan = await planFor(req.userEmail);
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

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: returnUrl,
    });

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
module.exports.isPlanActive = isPlanActive;
module.exports.pricePlans = pricePlans;
