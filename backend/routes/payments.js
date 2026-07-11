// ---------------------------------------------------------------------------
// Stripe payments. Inherited from ConversionForge; trimmed to the endpoints
// OfferFlow actually uses (hosted Checkout + cancel + status).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { pricePlans } = require('./customers');

/**
 * POST /api/payments/create-checkout-session
 * Creates a Stripe Checkout Session in subscription mode and returns the
 * hosted Checkout URL for the browser to redirect to.
 *
 * Body: { priceId, email }
 */
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, email } = req.body || {};

    if (!priceId || typeof priceId !== 'string') {
      return res.status(400).json({ error: 'priceId is required and must be a string' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required and must be a string' });
    }

    const baseUrl =
      process.env.PUBLIC_URL ||
      req.headers.origin ||
      `${req.protocol}://${req.get('host')}`;

    const plan = pricePlans()[priceId] || 'pro';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${baseUrl}/?payment=success&plan=${plan}`,
      cancel_url: `${baseUrl}/?payment=cancelled`,
    });

    if (!session || !session.url) {
      return res.status(502).json({ error: 'Stripe did not return a checkout URL' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error', err.type, err.code, err.message);
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
router.post('/cancel-subscription', async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId is required' });
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
router.get('/subscription/:subscriptionId', async (req, res) => {
  try {
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
