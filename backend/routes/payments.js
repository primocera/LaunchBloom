// ---------------------------------------------------------------------------
// Stripe payments. Inherited from ConversionForge; trimmed to the endpoints
// OfferFlow actually uses (hosted Checkout + cancel + status).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { pricePlans, planFor } = require('./customers');
const { requireAuth } = require('../lib/auth');
const { track } = require('../lib/analytics');

const VALID_PLANS = ['starter', 'pro', 'studio'];
const VALID_INTERVALS = ['monthly', 'yearly'];

/**
 * Resolve the redirect base URL for Checkout. Uses server-configured PUBLIC_URL
 * only — never the client-controllable Origin/Host (audit Prompt 4). Falls back
 * to localhost in non-production so local dev still works.
 */
function resolveBaseUrl() {
  const configured = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    try {
      // eslint-disable-next-line no-new
      new URL(configured);
      return configured;
    } catch {
      throw Object.assign(new Error('PUBLIC_URL is misconfigured.'), { status: 500 });
    }
  }
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw Object.assign(new Error('Checkout is not configured (PUBLIC_URL missing).'), { status: 500 });
}

/**
 * Return the single Stripe customer id for this app user, creating exactly one
 * if none exists. The customer carries app_user_id in metadata so Stripe and
 * the app stay linked even if the email later changes.
 */
async function ensureStripeCustomer(email, userId) {
  const { data: existing } = await supabase
    .from('customers')
    .select('id, stripe_customer_id')
    .eq('email', email)
    .single();

  if (existing && existing.stripe_customer_id) return existing.stripe_customer_id;

  const stripeCustomer = await stripe.customers.create({
    email,
    metadata: { app_user_id: userId || '', source: 'launchbloom' },
  });

  await supabase
    .from('customers')
    .upsert(
      { email, stripe_customer_id: stripeCustomer.id, metadata: { app_user_id: userId || '' } },
      { onConflict: 'email' }
    );

  return stripeCustomer.id;
}

/** 404s unless the subscription's customer email matches the session email. */
async function ownsSubscription(subscriptionId, userEmail) {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('customer_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  if (!sub?.customer_id) return false;

  const { data: customer } = await supabase
    .from('customers')
    .select('email')
    .eq('id', sub.customer_id)
    .single();
  return customer?.email?.toLowerCase() === userEmail.toLowerCase();
}

/**
 * Resolves a Stripe price id from { plan, interval }.
 *
 * Preferred env vars (create these in Stripe → Products, one price per cell):
 *   STRIPE_PRICE_STARTER_MONTHLY   STRIPE_PRICE_STARTER_YEARLY
 *   STRIPE_PRICE_PRO_MONTHLY       STRIPE_PRICE_PRO_YEARLY
 *   STRIPE_PRICE_STUDIO_MONTHLY    STRIPE_PRICE_STUDIO_YEARLY
 *
 * Backward compatibility: if the interval-specific var is missing, fall back to
 * the old single-price vars (STRIPE_PRICE_STARTER / _PRO / _BUSINESS). "business"
 * is treated as an alias of "studio".
 */
const PLAN_ALIASES = { business: 'studio' };
const LEGACY_PLAN_ENV = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  studio: 'STRIPE_PRICE_BUSINESS',
};

function resolvePriceId(planName, interval) {
  const plan = PLAN_ALIASES[planName] || planName;
  const intv = interval === 'yearly' ? 'YEARLY' : 'MONTHLY';
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${intv}`;
  return process.env[key] || process.env[LEGACY_PLAN_ENV[plan]] || null;
}

/**
 * True if this email already had a Stripe trial or an active subscription, so a
 * fresh checkout must NOT grant another 3-day free trial. Fails open to "no
 * prior trial" only when the customer has never existed in Supabase.
 */
async function hadTrialOrActiveSubscription(email) {
  email = (email || '').trim().toLowerCase();
  if (!email) return false;
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .single();
  if (!customer) return false;

  const { data: subs } = await supabase
    .from('subscriptions')
    .select('status, trial_end')
    .eq('customer_id', customer.id);
  if (!subs || subs.length === 0) return false;

  return subs.some(
    (s) => s.trial_end || ['active', 'trialing', 'past_due'].includes(s.status)
  );
}

/**
 * POST /api/payments/create-checkout-session  (auth required)
 * Creates a Stripe Checkout Session in subscription mode and returns the
 * hosted Checkout URL for the browser to redirect to.
 *
 * Body: { plan: starter|pro|studio, interval: monthly|yearly }. The customer
 * identity is derived from the authenticated session — any client-supplied
 * email or priceId is ignored (audit Prompt 4). New customers get a 3-day free
 * trial; returning customers do not; already-subscribed users are blocked.
 */
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const email = req.userEmail; // derived server-side; body email is ignored
    const userId = req.userId;

    const planName = String((req.body || {}).plan || '').toLowerCase();
    const interval = (req.body || {}).interval === 'yearly' ? 'yearly' : 'monthly';

    if (!VALID_PLANS.includes(planName)) {
      return res.status(400).json({ error: 'Choose a valid plan: starter, pro or studio.' });
    }
    if (!VALID_INTERVALS.includes(interval)) {
      return res.status(400).json({ error: 'Choose a valid billing interval: monthly or yearly.' });
    }

    const priceId = resolvePriceId(planName, interval);
    if (!priceId) {
      return res.status(400).json({ error: `Plan "${planName}" (${interval}) is not configured (missing STRIPE_PRICE_* env var).` });
    }

    // Block duplicate concurrent subscriptions — send existing subscribers to
    // the billing portal to change plans instead of stacking a second one.
    const currentPlan = await planFor(email);
    if (currentPlan) {
      return res.status(409).json({
        error: 'You already have an active subscription. Manage or change your plan from billing.',
        code: 'ALREADY_SUBSCRIBED',
        plan: currentPlan,
      });
    }

    const baseUrl = resolveBaseUrl();
    const customerId = await ensureStripeCustomer(email, userId);

    // 3-day free trial for first-time subscribers only (no double-trialing).
    const giveTrial = !(await hadTrialOrActiveSubscription(email));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      client_reference_id: userId || undefined,
      subscription_data: {
        metadata: { app_user_id: userId || '' },
        ...(giveTrial ? { trial_period_days: 3 } : {}),
      },
      // Return into the signed-in app so the user's prepared work is right
      // there; AppShell shows the matching success/cancel notice (v5 Prompt 2).
      success_url: `${baseUrl}/app?checkout=success&plan=${planName}&interval=${interval}`,
      cancel_url: `${baseUrl}/app?checkout=cancelled`,
    });

    if (!session || !session.url) {
      track('checkout_failed', { userId, properties: { plan: planName, interval, reason: 'no_url' } });
      return res.status(502).json({ error: 'Stripe did not return a checkout URL' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error', err.type, err.code, err.message);
    track('checkout_failed', { userId: req.userId, properties: { reason: err.code || err.type || 'error' } });
    if (err && err.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: err.message || 'Invalid request to Stripe', code: err.code || null });
    }
    if (err && err.type === 'StripeAuthenticationError') {
      return res.status(500).json({ error: 'Stripe authentication failed (check STRIPE_SECRET_KEY)' });
    }
    if (err && err.type === 'StripeAPIError') {
      return res.status(502).json({ error: 'Stripe API error, please try again' });
    }
    return res.status(500).json({ error: (err && err.message) || 'Failed to create checkout session' });
  }
});

/**
 * POST /api/payments/cancel-subscription
 * Cancels an active Stripe subscription at period end.
 * Body: { subscriptionId }
 */
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId is required' });
    }
    if (!(await ownsSubscription(subscriptionId, req.userEmail))) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await supabase
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('stripe_subscription_id', subscriptionId);

    res.json({
      subscriptionId: subscription.id,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  } catch (err) {
    console.error('cancel-subscription error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payments/subscription/:subscriptionId
 * Returns the current status of a subscription from Stripe.
 */
router.get('/subscription/:subscriptionId', requireAuth, async (req, res) => {
  try {
    if (!(await ownsSubscription(req.params.subscriptionId, req.userEmail))) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    const subscription = await stripe.subscriptions.retrieve(req.params.subscriptionId, {
      expand: ['latest_invoice', 'customer'],
    });

    res.json({
      id: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error('get-subscription error:', err);
    if (err.code === 'resource_missing') {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
