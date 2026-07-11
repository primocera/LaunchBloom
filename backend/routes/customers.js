// ---------------------------------------------------------------------------
// Customers + plan resolution. Inherited from ConversionForge; the only
// OfferFlow change is that price→plan mapping comes from env vars
// (STRIPE_PRICE_STARTER / _PRO / _BUSINESS) instead of hardcoded price ids.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');

/** Stripe price id → OfferFlow plan name, built from env at startup. */
function pricePlans() {
  const map = {};
  if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = 'starter';
  if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = 'pro';
  if (process.env.STRIPE_PRICE_BUSINESS) map[process.env.STRIPE_PRICE_BUSINESS] = 'business';
  return map;
}

/**
 * POST /api/customers
 * Creates or retrieves a customer record in Supabase and Stripe.
 * Body: { email, name, metadata }
 */
router.post('/', async (req, res) => {
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

/** 'starter' | 'pro' | 'business' | null for an email - single source of plan truth. */
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

    if (sub) return pricePlans()[sub.stripe_price_id] || 'pro';

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
  const plan = await planFor(req.query.email);
  res.json({ active: !!plan, plan });
}

router.get('/verify-plan', verifyPlanHandler);

/** GET /api/customers/:id */
router.get('/:id', async (req, res) => {
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(sanitizeCustomer(customer));
  } catch (err) {
    console.error('get-customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/customers/:id/portal — Stripe Billing Portal session. Query: { returnUrl } */
router.get('/:id/portal', async (req, res) => {
  try {
    const { returnUrl } = req.query;
    if (!returnUrl) {
      return res.status(400).json({ error: 'returnUrl query parameter is required' });
    }

    const { data: customer, error } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('id', req.params.id)
      .single();

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
