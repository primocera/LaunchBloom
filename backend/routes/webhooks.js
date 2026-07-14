// ---------------------------------------------------------------------------
// Stripe webhooks → Supabase mirror. (Inherited from ConversionForge.)
// Raw body required: server.js mounts this router BEFORE the global JSON
// parser and this route uses express.raw() for signature verification.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { BRAND, emailFrom } = require('../lib/brand');

// Resend is optional — welcome emails are skipped without a key.
let resend = null;
if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log(`Received Stripe event: ${event.type} [${event.id}]`);

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`Error handling event ${event.type}:`, err);
    // Return 200 to prevent Stripe retrying events we've already processed
    return res.json({ received: true, error: err.message });
  }

  res.json({ received: true });
});

async function handleEvent(event) {
  const data = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutSessionCompleted(data);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionUpdated(data);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(data);
      break;
    case 'invoice.paid':
      await onInvoicePaid(data);
      break;
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(data);
      break;
    case 'customer.created':
    case 'customer.updated':
      await onCustomerUpdated(data);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

async function onCheckoutSessionCompleted(session) {
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const stripeCustomerId = session.customer;

  if (!email) {
    console.warn('checkout.session.completed: no email found', { sessionId: session.id });
    return;
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .upsert(
      { email, stripe_customer_id: stripeCustomerId },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (customerError) {
    throw new Error(`Supabase upsert failed for customer on checkout: ${customerError.message}`);
  }

  if (session.mode === 'subscription' && session.subscription) {
    await supabase
      .from('subscriptions')
      .update({ customer_id: customer.id })
      .eq('stripe_subscription_id', session.subscription);

    console.log(`Checkout subscription linked: ${session.subscription} → customer ${customer.id}`);
  }

  if (resend) {
    resend.emails.send({
      from: emailFrom(),
      to: email,
      subject: `Welcome to ${BRAND.name}`,
      html: `<h1>Welcome aboard!</h1><p>Your subscription is active. Head to your dashboard and let's take your idea from offer to launch.</p>`,
    }).catch((emailErr) => {
      console.error('[checkout.session.completed] failed to send welcome email', emailErr);
    });
  }
}

async function onSubscriptionUpdated(subscription) {
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', subscription.customer)
    .single();

  const { error } = await supabase.from('subscriptions').upsert(
    {
      stripe_subscription_id: subscription.id,
      customer_id: customer?.id ?? null,
      stripe_price_id: subscription.items?.data?.[0]?.price?.id ?? null,
      status: subscription.status,
      current_period_start: subscription.current_period_start
        ? new Date(subscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      metadata: subscription.metadata,
    },
    { onConflict: 'stripe_subscription_id' }
  );

  if (error) {
    throw new Error(`Supabase upsert failed for subscription update: ${error.message}`);
  }

  console.log(`Subscription ${subscription.status}: ${subscription.id}`);
}

async function onSubscriptionDeleted(subscription) {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: false })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    throw new Error(`Supabase update failed for subscription deletion: ${error.message}`);
  }

  console.log(`Subscription canceled: ${subscription.id}`);
}

async function onInvoicePaid(invoice) {
  if (!invoice.subscription) return;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      current_period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
    })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) {
    throw new Error(`Supabase update failed for invoice.paid: ${error.message}`);
  }
}

async function onInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) {
    throw new Error(`Supabase update failed for invoice.payment_failed: ${error.message}`);
  }
}

async function onCustomerUpdated(stripeCustomer) {
  const { error } = await supabase
    .from('customers')
    .update({ email: stripeCustomer.email })
    .eq('stripe_customer_id', stripeCustomer.id);

  if (error) {
    throw new Error(`Supabase update failed for customer sync: ${error.message}`);
  }
}

module.exports = router;
