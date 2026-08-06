// ---------------------------------------------------------------------------
// Stripe webhooks → Supabase mirror. (Inherited from ConversionForge.)
// Raw body required: server.js mounts this router BEFORE the global JSON
// parser and this route uses express.raw() for signature verification.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { track } = require('../lib/analytics');
// v5 Prompt 14: idempotent lifecycle emails (no-ops without RESEND_API_KEY).
const { sendLifecycleEmail } = require('../lib/lifecycle-email');
// v12 SC-V12-04: structured, PII-free operational signals.
const { opsSignal } = require('../lib/ops-signal');

/**
 * Derive { planLabel, price, interval } from a Stripe subscription so lifecycle
 * emails can state the exact plan and post-trial price (Prompt 29). Returns an
 * empty object when the price can't be resolved — templates degrade gracefully.
 */
function priceInfo(subscription) {
  try {
    const item = subscription.items?.data?.[0];
    const price = item?.price;
    if (!price) return {};
    const { pricePlans } = require('./customers');
    const plan = pricePlans()[price.id];
    const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null;
    const interval = price.recurring?.interval || null;
    let display = null;
    if (price.unit_amount != null) {
      const amount = price.unit_amount / 100;
      const cur = (price.currency || 'usd').toUpperCase();
      const sym = cur === 'USD' ? '$' : '';
      display = sym ? `${sym}${amount.toFixed(2)}` : `${amount.toFixed(2)} ${cur}`;
    }
    return { planLabel, price: display, interval };
  } catch {
    return {};
  }
}

// ── foreign-event filtering (see handoff-scalvya.md Part 1) ─────────────────
// One Stripe account serves Mellowa, Frost and Scalvya, and Stripe broadcasts
// every matching event type to every endpoint on the account — so this handler
// receives other products' subscription events. Those must be ACKNOWLEDGED and
// DROPPED, never processed (they clobber customer rows and send our lifecycle
// mail for other products' trials) and never thrown on (permanently failing
// deliveries get the endpoint disabled by Stripe).

/** A subscription is ours iff our checkout stamped app_user_id metadata or its
 *  price is one of our configured STRIPE_PRICE_* prices.
 *
 *  Presence, not truthiness: payments.js writes `app_user_id: userId || ''`, so
 *  a session without a user id stamps an empty string. That is still OUR stamp
 *  — a truthiness check would discard those subscriptions as foreign and leave
 *  a paying customer with no entitlement. */
function isOurSubscription(subscription) {
  const meta = subscription?.metadata;
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'app_user_id')) return true;
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  const { pricePlans } = require('./customers');
  return !!(priceId && pricePlans()[priceId]);
}

/** An invoice is ours iff we already mirror its subscription, or its line
 *  price is one of ours (covers the event-before-row race). */
async function isOurInvoice(invoice) {
  if (!invoice.subscription) return false;
  const { data } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();
  if (data) return true;
  const priceId = invoice.lines?.data?.[0]?.price?.id;
  const { pricePlans } = require('./customers');
  return !!(priceId && pricePlans()[priceId]);
}

/** Customer email for a Stripe customer id (null when unknown). */
async function emailForStripeCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { data } = await supabase
    .from('customers')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();
  return data?.email || null;
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

  // Idempotency: claim the event. If we've already processed it, ack 200 and
  // do nothing (safe on Stripe redelivery).
  let claim;
  try {
    claim = await claimEvent(event);
  } catch (err) {
    // Transient DB failure — 5xx so Stripe retries later.
    console.error(`Could not claim event ${event.id}:`, err.message);
    return res.status(500).json({ error: 'Temporary error, please retry' });
  }
  if (claim.alreadyProcessed) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
    await markProcessed(event.id);
  } catch (err) {
    console.error(`Error handling event ${event.type} [${event.id}]:`, err);
    await markFailed(event.id, err.message).catch(() => {});
    // Structured signal for the readiness endpoint / log drain — no PII, only
    // the opaque event id and type.
    opsSignal('webhook_failed', { event_id: event.id, event_type: event.type, severity: 'error' });
    // 5xx so Stripe retries — durable processing did NOT complete.
    return res.status(500).json({ error: 'Processing failed, please retry' });
  }

  res.json({ received: true });
});

// ── idempotency ledger ──────────────────────────────────────────────────────

/**
 * Reserve an event for processing. Returns { alreadyProcessed }.
 * - unseen event → inserts a 'processing' row.
 * - seen + 'processed' → alreadyProcessed:true (ack, skip).
 * - seen + 'processing'/'failed' → bumps attempts and reprocesses.
 * Throws only on unexpected DB errors so the caller returns 5xx.
 */
async function claimEvent(event) {
  const { data: existing, error: selErr } = await supabase
    .from('stripe_events')
    .select('status, attempts')
    .eq('event_id', event.id)
    .single();

  // A genuine "no rows" is not an error we should retry on; other errors are.
  if (selErr && selErr.code && selErr.code !== 'PGRST116') {
    throw new Error(`stripe_events lookup failed: ${selErr.message}`);
  }

  if (existing) {
    if (existing.status === 'processed') return { alreadyProcessed: true };
    await supabase
      .from('stripe_events')
      .update({ status: 'processing', attempts: (existing.attempts || 1) + 1 })
      .eq('event_id', event.id);
    return { alreadyProcessed: false };
  }

  const { error: insErr } = await supabase
    .from('stripe_events')
    .insert({ event_id: event.id, type: event.type, status: 'processing' });
  if (insErr) {
    // Likely a concurrent delivery inserted first — re-check its status.
    const { data: row } = await supabase
      .from('stripe_events')
      .select('status')
      .eq('event_id', event.id)
      .single();
    if (row && row.status === 'processed') return { alreadyProcessed: true };
  }
  return { alreadyProcessed: false };
}

async function markProcessed(eventId) {
  await supabase
    .from('stripe_events')
    .update({ status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('event_id', eventId);
}

async function markFailed(eventId, message) {
  await supabase
    .from('stripe_events')
    .update({ status: 'failed', last_error: String(message || '').slice(0, 500) })
    .eq('event_id', eventId);
}

async function handleEvent(event) {
  const data = event.data.object;
  const eventAt = event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString();

  // A foreign event is acknowledged and dropped — never processed, never thrown
  // on, and it emits an INFO signal (not a failure alert), because a Mellowa or
  // Frost event landing here is expected on a shared Stripe account.
  const ignoreForeign = () => {
    opsSignal('foreign_event_ignored', {
      event_id: event.id, event_type: event.type, subscription_id: data.subscription || data.id, severity: 'info',
    });
  };

  switch (event.type) {
    case 'checkout.session.completed':
      // XAPP-95-01: require our EXACT discriminator, not merely a present
      // app_user_id key. payments.js stamps every Scalvya session with
      // metadata.scalvya === '1', so this drops nothing of ours — but this event
      // is the only one that upserts customers.stripe_customer_id, so accepting a
      // foreign session here is exactly how that column gets tainted with a
      // foreign customer id. Exact proof, not "looks like ours".
      if (data.metadata?.scalvya !== '1') {
        ignoreForeign();
        return;
      }
      await onCheckoutSessionCompleted(data);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      if (!isOurSubscription(data)) {
        ignoreForeign();
        return;
      }
      await onSubscriptionUpdated(data, eventAt, event.type, event.data.previous_attributes || {});
      break;
    case 'customer.subscription.deleted':
      if (!isOurSubscription(data)) {
        ignoreForeign();
        return;
      }
      await onSubscriptionDeleted(data, eventAt);
      break;
    case 'customer.subscription.trial_will_end':
      if (!isOurSubscription(data)) {
        ignoreForeign();
        return;
      }
      await onTrialWillEnd(data);
      break;
    case 'invoice.paid':
      if (!(await isOurInvoice(data))) {
        ignoreForeign();
        return;
      }
      await onInvoicePaid(data, eventAt);
      break;
    case 'invoice.payment_failed':
      if (!(await isOurInvoice(data))) {
        ignoreForeign();
        return;
      }
      await onInvoicePaymentFailed(data, eventAt);
      break;
    // A refund or a dispute does NOT itself change the subscription status, so
    // it must not change entitlement here — the status transition Stripe sends
    // (e.g. customer.subscription.deleted) is what does. We acknowledge it,
    // record a signal for the operator, and make no data mutation. Foreign ones
    // are dropped exactly like any other foreign event.
    case 'charge.refunded':
      if (!isOurCharge(data)) { ignoreForeign(); return; }
      opsSignal('charge_refunded', { event_id: event.id, event_type: event.type, charge_id: data.id, severity: 'info' });
      break;
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
      if (!isOurCharge(data)) { ignoreForeign(); return; }
      opsSignal('charge_dispute', {
        event_id: event.id, event_type: event.type, dispute_id: data.id, charge_id: data.charge, severity: 'warn',
      });
      break;
    case 'customer.created':
    case 'customer.updated':
      await onCustomerUpdated(data);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

/** A charge/dispute is ours iff it carries our checkout metadata stamp or is
 *  tied to a subscription we already mirror. Unknown → foreign (fail safe). */
function isOurCharge(object) {
  const meta = object?.metadata;
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'app_user_id')) return true;
  if (meta && meta.scalvya) return true;
  return false;
}

/**
 * True if this subscription row was already written by a NEWER Stripe event, so
 * an out-of-order (older) delivery must not overwrite it.
 */
async function isStaleSubscriptionEvent(subscriptionId, eventAt) {
  const { data } = await supabase
    .from('subscriptions')
    .select('stripe_event_at')
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  return !!(data && data.stripe_event_at && new Date(data.stripe_event_at) > new Date(eventAt));
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

  // v5 Prompt 14: no "subscription active" email here — entitlement is only
  // durable once the subscription events land (trial_started covers welcome).
}

async function onSubscriptionUpdated(subscription, eventAt, eventType, previous = {}) {
  // Out-of-order guard: a newer event already wrote this row.
  if (await isStaleSubscriptionEvent(subscription.id, eventAt)) {
    opsSignal('reconciliation_correction', {
      event_type: eventType, subscription_id: subscription.id,
      reason: 'stale_out_of_order_skipped', severity: 'info',
    });
    return;
  }

  const userId = (subscription.metadata && subscription.metadata.app_user_id) || null;
  if (eventType === 'customer.subscription.created') {
    track('subscription_created', { userId, properties: { status: subscription.status } });
    if (subscription.status === 'trialing') {
      track('trial_started', { userId, properties: { trial_end: subscription.trial_end || null } });
    }
  } else {
    track('subscription_updated', { userId, properties: { status: subscription.status } });
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', subscription.customer)
    .single();

  // Stripe moved current_period_start/end OFF the subscription object and ONTO
  // the subscription item in recent API versions (2025+/2026 dahlia). Read the
  // top-level field first for older versions, then fall back to the item — else
  // the renewal date is stored as null and the account page shows "renews on .".
  const item = subscription.items?.data?.[0];
  const periodStartUnix = subscription.current_period_start ?? item?.current_period_start ?? null;
  const periodEndUnix = subscription.current_period_end ?? item?.current_period_end ?? null;

  const { error } = await supabase.from('subscriptions').upsert(
    {
      stripe_subscription_id: subscription.id,
      customer_id: customer?.id ?? null,
      stripe_price_id: item?.price?.id ?? null,
      status: subscription.status,
      current_period_start: periodStartUnix
        ? new Date(periodStartUnix * 1000).toISOString()
        : null,
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      metadata: subscription.metadata,
      stripe_event_at: eventAt,
    },
    { onConflict: 'stripe_subscription_id' }
  );

  if (error) {
    throw new Error(`Supabase upsert failed for subscription update: ${error.message}`);
  }

  console.log(`Subscription ${subscription.status}: ${subscription.id}`);

  // Lifecycle emails — AFTER the durable upsert, idempotent by dedupe key,
  // and never allowed to fail billing processing (v5 Prompt 14).
  const email = await emailForStripeCustomer(subscription.customer);
  if (email) {
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
    const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;

    if (subscription.status === 'trialing') {
      await sendLifecycleEmail('trial_started', subscription.id, email, { chargeAt: trialEnd, ...priceInfo(subscription) });
    }
    if (subscription.cancel_at_period_end && previous.cancel_at_period_end === false) {
      await sendLifecycleEmail('cancellation_scheduled', `${subscription.id}:${subscription.current_period_end || ''}`, email, { periodEnd });
    }
    const prevPrice = previous.items?.data?.[0]?.price?.id;
    const newPrice = subscription.items?.data?.[0]?.price?.id;
    if (prevPrice && newPrice && prevPrice !== newPrice) {
      const { pricePlans } = require('./customers');
      const plan = pricePlans()[newPrice];
      await sendLifecycleEmail('plan_changed', `${subscription.id}:${newPrice}`, email, {
        planLabel: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null,
      });
    }
  }
}

async function onSubscriptionDeleted(subscription, eventAt) {
  if (await isStaleSubscriptionEvent(subscription.id, eventAt)) {
    opsSignal('reconciliation_correction', {
      event_type: 'customer.subscription.deleted', subscription_id: subscription.id,
      reason: 'stale_out_of_order_skipped', severity: 'info',
    });
    return;
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: false, stripe_event_at: eventAt })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    throw new Error(`Supabase update failed for subscription deletion: ${error.message}`);
  }

  track('subscription_canceled', { userId: (subscription.metadata && subscription.metadata.app_user_id) || null });
  console.log(`Subscription canceled: ${subscription.id}`);

  const email = await emailForStripeCustomer(subscription.customer);
  if (email) await sendLifecycleEmail('cancellation_completed', subscription.id, email);
}

async function onTrialWillEnd(subscription) {
  // Stripe fires this before a trial converts: send the trial-ending email
  // with the exact charge date and a billing link (v5 Prompt 14).
  console.log(`Trial ending soon for subscription ${subscription.id} (trial_end ${subscription.trial_end}).`);
  const email = await emailForStripeCustomer(subscription.customer);
  if (email) {
    const chargeAt = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
    await sendLifecycleEmail('trial_ending', subscription.id, email, { chargeAt, ...priceInfo(subscription) });
  }
}

async function onInvoicePaid(invoice, eventAt) {
  if (!invoice.subscription) return;

  if (await isStaleSubscriptionEvent(invoice.subscription, eventAt)) {
    opsSignal('reconciliation_correction', {
      event_type: 'invoice.paid', subscription_id: invoice.subscription, invoice_id: invoice.id,
      reason: 'stale_out_of_order_skipped', severity: 'info',
    });
    return;
  }

  // v10 SC-06: was this payment a RECOVERY? Read the prior state before the
  // update overwrites it — a customer who was told "action needed" must be
  // told the problem is resolved, not left with an unanswered money warning.
  const { data: priorRow } = await supabase
    .from('subscriptions').select('status')
    .eq('stripe_subscription_id', invoice.subscription).single();
  const wasPastDue = priorRow && priorRow.status === 'past_due';

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
      stripe_event_at: eventAt,
    })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) {
    throw new Error(`Supabase update failed for invoice.paid: ${error.message}`);
  }

  // v10 SC-07: a renewal is a recurring cycle invoice, not the first one.
  // Stripe's billing_reason distinguishes them, so this needs no heuristic.
  // Deduped on the invoice id: a redelivered webhook cannot double-count the
  // one metric that proves the job was worth paying for twice.
  if (invoice.total > 0 && invoice.billing_reason === 'subscription_cycle') {
    track('subscription_renewed', {
      userId: null,
      dedupeKey: `renewal:${invoice.id}`,
      properties: { billing_reason: invoice.billing_reason },
    });
  }

  // Real charges only — the €0/$0 trial-start invoice is not a "payment".
  if (invoice.total > 0) {
    const email = invoice.customer_email || (await emailForStripeCustomer(invoice.customer));
    if (email) {
      const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null;
      // Exact amount + plan for the receipt (Prompt 29).
      let amount = null;
      if (invoice.total != null) {
        const cur = (invoice.currency || 'usd').toUpperCase();
        const val = (invoice.total / 100).toFixed(2);
        amount = cur === 'USD' ? `$${val}` : `${val} ${cur}`;
      }
      const priceId = invoice.lines?.data?.[0]?.price?.id;
      let planLabel = null;
      if (priceId) {
        const { pricePlans } = require('./customers');
        const plan = pricePlans()[priceId];
        planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null;
      }
      // A recovery gets the recovery message instead of a routine receipt.
      // Both are deduped on the invoice id, so a redelivery sends neither twice.
      if (wasPastDue) {
        await sendLifecycleEmail('payment_recovered', invoice.id, email, { periodEnd, amount });
      } else {
        await sendLifecycleEmail('payment_succeeded', invoice.id, email, { periodEnd, amount, planLabel });
      }
    }
  }
}

async function onInvoicePaymentFailed(invoice, eventAt) {
  if (!invoice.subscription) return;

  // SC-V10-00 out-of-order guard: a late payment_failed delivered AFTER the
  // recovery invoice.paid must not flip a recovered subscription back to
  // past_due — that would revoke entitlement the customer has paid for.
  if (await isStaleSubscriptionEvent(invoice.subscription, eventAt)) {
    // The regression this guards: a late payment_failed delivered after recovery
    // would otherwise revoke paid access. Record the correction for the operator.
    opsSignal('reconciliation_correction', {
      event_type: 'invoice.payment_failed', subscription_id: invoice.subscription, invoice_id: invoice.id,
      reason: 'stale_out_of_order_skipped', severity: 'warn',
    });
    return;
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due', stripe_event_at: eventAt })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) {
    throw new Error(`Supabase update failed for invoice.payment_failed: ${error.message}`);
  }

  const email = invoice.customer_email || (await emailForStripeCustomer(invoice.customer));
  if (email) await sendLifecycleEmail('payment_failed', invoice.id, email);
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
// v15 XAPP-01: exported for the cross-app isolation matrix tests. On the shared
// Stripe account these are the ownership boundary — a foreign event must never
// be adopted, mutated, emailed or counted.
module.exports.isOurSubscription = isOurSubscription;
module.exports.isOurCharge = isOurCharge;
