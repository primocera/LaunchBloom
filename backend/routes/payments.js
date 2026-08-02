// ---------------------------------------------------------------------------
// Stripe payments. Inherited from ConversionForge; trimmed to the endpoints
// OfferFlow actually uses (hosted Checkout + cancel + status).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { resolveEntitlement } = require('./customers');
const { planUnavailableBody } = require('../lib/subscription-state');
const { requireAuth } = require('../lib/auth');
const { track } = require('../lib/analytics');
const { selectCatalog, selectionTelemetry } = require('../lib/plan-catalog');

/**
 * v13 SC-P0-03: the ONE public checkout failure message. Stripe's own text never
 * reaches a customer — it leaks price ids, currency internals and reads like a
 * card decline when it is a configuration problem on our side.
 */
const CHECKOUT_UNAVAILABLE =
  'Checkout is temporarily unavailable for this price. You have not been charged. ' +
  'Please try again in a few minutes, or contact support if it keeps happening.';

function checkoutUnavailable(res, { status = 503, retryable = true, reason = null } = {}) {
  if (reason) console.error(`[checkout] unavailable (${reason})`);
  return res.status(status).json({
    error: CHECKOUT_UNAVAILABLE,
    code: 'CHECKOUT_UNAVAILABLE',
    retryable,
  });
}

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

  if (existing && existing.stripe_customer_id) {
    // Shared-Stripe fallout: the stored id can point at a customer that only
    // exists in test mode or on another account ("No such customer" in live).
    // Verify it against the current key; recreate on resource_missing.
    try {
      const c = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!c.deleted) return existing.stripe_customer_id;
    } catch (err) {
      if (err.code !== 'resource_missing') throw err;
      console.warn(`[ensureStripeCustomer] stale stripe_customer_id ${existing.stripe_customer_id} for ${email} — recreating`);
    }
  }

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

// v13 SC-P0-03: price resolution lives in the catalog (plan-catalog.js
// stripePriceId / selectCatalog) so display and checkout resolve prices through
// the same table — there is no second price-resolution path in this file.
// Env vars (one price per cell, plus the legacy single-price fallbacks):
//   STRIPE_PRICE_STARTER_MONTHLY   STRIPE_PRICE_STARTER_YEARLY
//   STRIPE_PRICE_PRO_MONTHLY       STRIPE_PRICE_PRO_YEARLY
//   STRIPE_PRICE_STUDIO_MONTHLY    STRIPE_PRICE_STUDIO_YEARLY

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

    // Authoritative server-side selection: region -> currency -> price id. The
    // request body contributes only { plan, interval }; any client-supplied
    // price id or currency is ignored entirely.
    const selection = selectCatalog(req, { plan: planName, interval });
    const priceId = selection.price_id;
    if (!selection.available || !priceId) {
      console.error(`[checkout] no price configured for ${planName}/${interval} (${selection.price_key || 'unknown key'})`);
      return checkoutUnavailable(res, { retryable: false, reason: 'price_not_configured' });
    }

    // v13 SC-P0-04: never take real money on an incomplete launch config.
    // Request-time defense in depth behind the startup check and the
    // requireLaunchReady middleware — enforced automatically in production,
    // warn-only in dev/preview so test-mode Stripe still works.
    {
      const { launchConfigProblems, launchConfigEnforced } = require('../lib/launch-config');
      const problems = launchConfigProblems();
      if (problems.length) {
        // Variable names + categories only — never a configured value.
        console.warn('[checkout] launch config incomplete:', problems.join('; '));
        if (launchConfigEnforced()) {
          return res.status(503).json({
            error: 'Checkout is temporarily unavailable. Your workspace and drafts are unaffected.',
            code: 'LAUNCH_CONFIG_INCOMPLETE',
            req_id: req.id,
          });
        }
      }
    }

    // Block duplicate concurrent subscriptions — send existing subscribers to
    // the billing portal to change plans instead of stacking a second one.
    // v13 SC-P0-01: FAIL CLOSED. If entitlement cannot be verified (Supabase
    // down) or an entitling subscription exists on a price we cannot map, we do
    // NOT create a Checkout Session — an unverified "no plan" is exactly how a
    // paying customer ends up with a second subscription.
    const { state, plan: currentPlan } = await resolveEntitlement(email);
    if (state === 'unavailable' || state === 'unmapped') {
      return res.status(503).json(planUnavailableBody());
    }
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

    // Currency comes from the SAME selection the pricing page rendered from
    // (GET /api/plans). We PIN the session currency only for EUR — that gives EU
    // buyers the exact catalog euro price (from the price's EUR currency_options)
    // and stops an EU card being charged USD (which fails after 3DS looking like
    // a decline). For everyone else we set NO currency, so Stripe Adaptive
    // Pricing (if the owner keeps it enabled) can present the buyer's own local
    // currency, falling back to the price's USD base. Pinning USD here would
    // suppress Adaptive for non-EU buyers.
    const currency = selection.currency;

    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      client_reference_id: userId || undefined,
      // Webhook discriminator on the shared Stripe account: the handler drops
      // checkout.session.completed events without this stamp as foreign.
      metadata: {
        scalvya: '1',
        app_user_id: userId || '',
        // v13 SC-P0-03: the catalog the buyer was quoted from, stamped on the
        // session so a display/charge mismatch is correlatable in Stripe.
        catalog_version: selection.catalog_version,
        catalog_currency: selection.currency,
        price_key: selection.price_key || '',
      },
      subscription_data: {
        metadata: { app_user_id: userId || '' },
        ...(giveTrial ? { trial_period_days: 3 } : {}),
      },
      // Return into the signed-in app so the user's prepared work is right
      // there; AppShell shows the matching success/cancel notice (v5 Prompt 2).
      success_url: `${baseUrl}/app?checkout=success&plan=${planName}&interval=${interval}`,
      cancel_url: `${baseUrl}/app?checkout=cancelled`,
    };

    // Redacted, PII-free record of what was selected, so support can correlate a
    // reported mismatch without touching customer data.
    track('checkout_catalog_selected', { userId, properties: selectionTelemetry(selection) });

    // v13 SC-P0-03: NO cross-currency retry. If Stripe rejects the pinned EUR
    // session, that means the catalog the buyer was shown does not exist in
    // Stripe — silently retrying in USD would charge a currency the buyer never
    // saw. We fail with a stable public error instead; the outer catch maps it.
    const session = await stripe.checkout.sessions.create(
      currency === 'eur' ? { ...sessionParams, currency: 'eur' } : sessionParams
    );

    if (!session || !session.url) {
      track('checkout_failed', { userId, properties: { plan: planName, interval, reason: 'no_url' } });
      return checkoutUnavailable(res, { reason: 'no_url' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error', err.type, err.code, err.message);
    track('checkout_failed', { userId: req.userId, properties: { reason: err.code || err.type || 'error' } });
    // v13 SC-P0-03: map by Stripe's TYPED error, never by parsing its message —
    // and never echo Stripe's text to the customer. A misconfigured price and an
    // auth failure are our problem, not retryable by the buyer; transport/API
    // errors are worth retrying.
    const type = (err && err.type) || '';
    if (type === 'StripeInvalidRequestError' || type === 'StripeAuthenticationError' || type === 'StripePermissionError') {
      return checkoutUnavailable(res, { retryable: false, reason: type });
    }
    if (type === 'StripeAPIError' || type === 'StripeConnectionError' || type === 'StripeRateLimitError') {
      return checkoutUnavailable(res, { retryable: true, reason: type });
    }
    return checkoutUnavailable(res, { status: 500, retryable: true, reason: type || 'error' });
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
// v7 LB-12: account/billing uses this to switch paywall copy to pay-today for
// users who already used their one trial.
module.exports.hadTrialOrActiveSubscription = hadTrialOrActiveSubscription;
