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
// SV-01 (v20): the ONE canonical, typed ownership rule. webhooks delegates to it
// so checkout, the reconciler, the portal and account deletion cannot drift to a
// second rule. Behaviour is identical to the prior inline logic; the typed states
// (owned/foreign/legacy_mapped/legacy_price/ambiguous) are mapped back to this
// file's { ours, legacy } shape so every existing consumer/test is unaffected.
const ownership = require('../lib/stripe-ownership');

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

// Peer-product stamp detector, canonical in lib/stripe-ownership.js. On the
// shared account, `source` — not a bare app_user_id key any product could also
// set — is what proves ownership; the full typed rule lives in that service and
// is reached here through ownsSubscription / isOurCharge.
const { hasForeignStamp } = ownership;

/**
 * LB-V17-02: a subscription is ours ONLY via exact proof, never via the mere
 * presence of an app_user_id key that another product on the shared account
 * could also carry.
 *
 *   1. Exact stamp: metadata.source === 'launchbloom' (or the equivalent
 *      metadata.scalvya === '1') — self-identifying, no email needed. Every
 *      subscription created after LB-V17-02 carries this.
 *   2. A foreign stamp is present → definitely NOT ours (drop, no fallback).
 *   3. Narrow LEGACY fallback: a configured Scalvya price AND no foreign stamp.
 *      This covers pre-LB-V17-02 subscriptions (app_user_id only) and the
 *      event-before-row race. A price match alone — with a foreign stamp — is
 *      never enough. Returns { legacy: true } so the caller can measure it.
 *
 * Returns a result object; use `isOurSubscription(sub).ours` for a boolean.
 */
function ownsSubscription(subscription, options = {}) {
  const result = ownership.classifySubscription(subscription, {
    isConfiguredPrice: (priceId) => {
      const { pricePlans } = require('./customers');
      return !!(priceId && pricePlans()[priceId]);
    },
    legacyMap: options.legacyMap,
  });
  return {
    ours: ownership.isOwning(result),
    // `legacy` keeps its historical meaning: the narrow price-only fallback was
    // used (the signal the sunset plan measures). An explicit owner-verified
    // legacy mapping is a proven adoption, not the fallback, so it is not flagged.
    legacy: ownership.isLegacyPriceFallback(result),
    state: result,
  };
}

/** Boolean convenience wrapper kept for the exported isolation-test surface. */
function isOurSubscription(subscription) {
  return ownsSubscription(subscription).ours;
}

/**
 * The single canonical projection of a Stripe subscription into the local
 * `subscriptions` mirror row. Extracted so the webhook handler AND the v18 S05
 * pull-based reconciliation job write the SAME shape — Stripe stays the one
 * billing truth; this is only its deterministic mirror, never a second source.
 * Pure and side-effect-free.
 *
 * Stripe moved current_period_start/end OFF the subscription object and ONTO
 * the subscription item in recent API versions (2025+/2026 dahlia). Read the
 * top-level field first for older versions, then fall back to the item — else
 * the renewal date is stored as null and the account page shows "renews on .".
 */
function subscriptionMirrorRow(subscription, customerId, eventAt) {
  const item = subscription.items?.data?.[0];
  const periodStartUnix = subscription.current_period_start ?? item?.current_period_start ?? null;
  const periodEndUnix = subscription.current_period_end ?? item?.current_period_end ?? null;
  return {
    stripe_subscription_id: subscription.id,
    customer_id: customerId ?? null,
    stripe_price_id: item?.price?.id ?? null,
    status: subscription.status,
    current_period_start: periodStartUnix ? new Date(periodStartUnix * 1000).toISOString() : null,
    current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    metadata: subscription.metadata,
    stripe_event_at: eventAt,
  };
}

/**
 * Resolve the Stripe subscription id an invoice references, across the API
 * shapes this repo sees: the classic top-level `invoice.subscription` (a string
 * or an expanded object) and the 2025+/2026 shape where the reference moved under
 * `invoice.parent.subscription_details.subscription` or the line item. Returns
 * null for a genuinely non-subscription invoice.
 */
function invoiceSubscriptionId(invoice) {
  const direct = invoice.subscription;
  if (typeof direct === 'string' && direct) return direct;
  if (direct && typeof direct === 'object' && direct.id) return direct.id;
  const viaParent =
    invoice.parent?.subscription_details?.subscription ||
    invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ||
    invoice.lines?.data?.[0]?.subscription;
  if (typeof viaParent === 'string' && viaParent) return viaParent;
  if (viaParent && typeof viaParent === 'object' && viaParent.id) return viaParent.id;
  return null;
}

/**
 * SV-21-01 (v21): canonical invoice ownership — replaces the old price-only
 * isOurInvoice, which adopted ANY invoice whose first line used a configured
 * Scalvya price (so a foreign product's invoice on a shared price would be
 * processed). An invoice is now ours ONLY when its SUBSCRIPTION classifies as
 * owned / legacy_mapped (or, until the fallback is sunset, legacy_price via the
 * subscription's own metadata) — the invoice line price is never proof.
 *
 * Returns { ours, legacy, state, unavailable }:
 *   - a trusted local mirror row is accepted, but a stored-metadata foreign or
 *     conflicting stamp still rejects it (defense in depth);
 *   - for the event-before-row race (no mirror yet), the referenced Stripe
 *     subscription is retrieved and classified by exact metadata / legacy map;
 *   - a DB read failure or a transient Stripe error → unavailable:true so the
 *     caller fails closed with a retryable 5xx (never adopted, never dropped as
 *     foreign, event not marked processed).
 */
async function classifyInvoiceOwnership(invoice, options = {}) {
  const notOurs = { ours: false, legacy: false, state: ownership.OWNERSHIP.FOREIGN, unavailable: false };
  const unavailable = { ours: false, legacy: false, state: ownership.OWNERSHIP.UNAVAILABLE, unavailable: true };

  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return notOurs; // non-subscription invoice — not ours (parity with prior behaviour)

  const classifyOpts = {
    isConfiguredPrice: (priceId) => {
      const { pricePlans } = require('./customers');
      return !!(priceId && pricePlans()[priceId]);
    },
    legacyMap: options.legacyMap,
  };

  // 1. Trusted local mirror. A real read failure is NOT "no row" — fail closed
  //    (retryable) rather than misclassify an unreadable mirror as foreign.
  const { data: mirror, error } = await supabase
    .from('subscriptions')
    .select('metadata, stripe_subscription_id')
    .eq('stripe_subscription_id', subId)
    .single();
  if (error && error.code !== 'PGRST116') return unavailable;
  if (mirror) {
    // A mirror is only ever written for an owned subscription, so its presence is
    // ownership proof. Still fail closed if its STORED metadata actively PROVES
    // the object foreign/conflicting (defense in depth) — but absence of a stamp
    // (older rows carry no source metadata) does NOT prove foreign, so an
    // unstamped mirror stays ours and enforcement never revokes a subscription we
    // are actively mirroring.
    const meta = mirror.metadata || {};
    if (ownership.hasConflictingStamp(meta)) {
      return { ours: false, legacy: false, state: ownership.OWNERSHIP.AMBIGUOUS, unavailable: false };
    }
    if (ownership.hasForeignStamp(meta)) {
      return { ours: false, legacy: false, state: ownership.OWNERSHIP.FOREIGN, unavailable: false };
    }
    return { ours: true, legacy: false, state: ownership.OWNERSHIP.OWNED, unavailable: false };
  }

  // 2. Event-before-row race (no mirror yet). Before spending a Stripe read on
  //    EVERY sibling product's invoice on the shared account, apply a cheap
  //    NEGATIVE filter: an invoice is only plausibly ours if it carries our exact
  //    stamp, an explicit legacy mapping, or a configured Scalvya price. The
  //    price is used ONLY to decide whether to look — never to adopt (adoption
  //    still requires the retrieved subscription's metadata / legacy map below).
  const invoiceMeta = invoice.subscription_details?.metadata || invoice.metadata || {};
  const priceId = invoice.lines?.data?.[0]?.price?.id;
  const configuredPrice = classifyOpts.isConfiguredPrice(priceId);
  const mappedLegacy = !!(options.legacyMap && typeof options.legacyMap.has === 'function' && options.legacyMap.has(subId));
  if (ownership.hasForeignStamp(invoiceMeta)) return notOurs;
  if (!(ownership.hasExactStamp(invoiceMeta) || mappedLegacy || configuredPrice)) return notOurs;

  // 3. Plausibly ours — classify the referenced Stripe subscription by its exact
  //    metadata (or an explicit legacy mapping). The invoice line price is never
  //    used as proof; a transient retrieve failure fails closed (retryable).
  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    if (err && err.code === 'resource_missing') return notOurs; // gone / never ours
    return unavailable;
  }
  const state = ownership.classifySubscription(subscription, classifyOpts);
  return {
    ours: ownership.isOwning(state),
    legacy: ownership.isLegacyPriceFallback(state),
    state,
    unavailable: false,
  };
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

  // LB-V17-02: a subscription accepted only through the narrow legacy
  // configured-price fallback (no exact source stamp) is measured so the
  // fallback can be sunset once pre-LB-V17-02 subscriptions age out.
  const ownSubscriptionOrDrop = () => {
    const own = ownsSubscription(data);
    if (!own.ours) { ignoreForeign(); return false; }
    if (own.legacy) {
      opsSignal('legacy_price_ownership_fallback', {
        event_id: event.id, event_type: event.type, subscription_id: data.id, severity: 'info',
      });
    }
    return true;
  };

  // SV-21-01: the invoice analogue. Ownership is decided by the SUBSCRIPTION
  // (canonical typed rule), never the invoice line price. An UNAVAILABLE
  // ownership read throws so Stripe receives a retryable failure and the event is
  // NOT marked processed — it is never converted to foreign or to owned.
  const ownInvoiceOrDrop = async () => {
    const own = await classifyInvoiceOwnership(data);
    if (own.unavailable) {
      throw new Error(`invoice ownership unavailable for ${data.id || 'unknown'} — retry`);
    }
    if (!own.ours) { ignoreForeign(); return false; }
    if (own.legacy) {
      opsSignal('legacy_price_ownership_fallback', {
        event_id: event.id, event_type: event.type, subscription_id: invoiceSubscriptionId(data), severity: 'info',
      });
    }
    return true;
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
      if (!ownSubscriptionOrDrop()) return;
      await onSubscriptionUpdated(data, eventAt, event.type, event.data.previous_attributes || {});
      break;
    case 'customer.subscription.deleted':
      if (!ownSubscriptionOrDrop()) return;
      await onSubscriptionDeleted(data, eventAt);
      break;
    case 'customer.subscription.trial_will_end':
      if (!ownSubscriptionOrDrop()) return;
      await onTrialWillEnd(data);
      break;
    case 'invoice.paid':
      if (!(await ownInvoiceOrDrop())) return;
      await onInvoicePaid(data, eventAt);
      break;
    case 'invoice.payment_failed':
      if (!(await ownInvoiceOrDrop())) return;
      await onInvoicePaymentFailed(data, eventAt);
      break;
    // A refund or a dispute does NOT itself change the subscription status, so
    // it must not change entitlement here — the status transition Stripe sends
    // (e.g. customer.subscription.deleted) is what does. We acknowledge it,
    // record a signal for the operator, and make no data mutation. Foreign ones
    // are dropped exactly like any other foreign event.
    case 'charge.refunded':
      if (!(await isOurCharge(data))) { ignoreForeign(); return; }
      opsSignal('charge_refunded', { event_id: event.id, event_type: event.type, charge_id: data.id, severity: 'info' });
      break;
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
      if (!(await isOurCharge(data))) { ignoreForeign(); return; }
      opsSignal('charge_dispute', {
        event_id: event.id, event_type: event.type, dispute_id: data.id, charge_id: data.charge, severity: 'warn',
      });
      break;
    case 'customer.created':
    case 'customer.updated':
      // LB-V19 (LB-01): apply the same source/ownership policy the other events
      // use. A customer carrying a foreign stamp is dropped, never used to mutate
      // a local row. (The update itself is already scoped to a stripe_customer_id
      // that only our own stamped checkout ever writes, so this is defense in
      // depth; it makes the policy explicit and drops foreign events early.)
      if (hasForeignStamp(data.metadata)) { ignoreForeign(); return; }
      await onCustomerUpdated(data);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

/**
 * LB-V17-02: a charge/dispute is ours ONLY via exact proof:
 *   1. Exact metadata stamp (source === 'launchbloom' or scalvya === '1'), or
 *   2. a TRUSTED PARENT — its Stripe customer is one WE own. Only our own
 *      checkout.session.completed (which requires the exact scalvya stamp) ever
 *      writes customers.stripe_customer_id, so a match is proof without any
 *      extra provider read or email lookup.
 * A foreign stamp, or a bare app_user_id key, is never accepted. Unknown →
 * foreign (fail safe). Refund/dispute events mutate nothing, so a false negative
 * only drops an ops signal; a false positive would leak another product's money
 * events into ours — this errs to the safe side.
 */
async function isOurCharge(object) {
  // Metadata half via the canonical service: OWNED → ours; FOREIGN/AMBIGUOUS →
  // not ours (a conflicting exact+foreign stamp is never adopted for money
  // events); null → undecided, fall through to the trusted-parent lookup.
  const byMeta = ownership.classifyChargeMeta(object);
  if (byMeta === ownership.OWNERSHIP.OWNED) return true;
  if (byMeta === ownership.OWNERSHIP.FOREIGN || byMeta === ownership.OWNERSHIP.AMBIGUOUS) return false;
  const stripeCustomerId = object?.customer;
  if (stripeCustomerId) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('stripe_customer_id', stripeCustomerId)
      .single();
    if (data) return true;
  }
  return false;
}

/**
 * True if this subscription row was already written by a NEWER Stripe event, so
 * an out-of-order (older) delivery must not overwrite it.
 */
async function isStaleSubscriptionEvent(subscriptionId, eventAt) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('stripe_event_at')
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  // LB-V19 (LB-01): distinguish "no local row yet" from "could not read". PGRST116
  // is the expected no-row case (not stale — proceed). Any other error means the
  // mirror was unreadable; fail CLOSED (throw → 5xx → Stripe redelivers) rather
  // than treating an unavailable read as "not stale" and letting a possibly-older
  // event overwrite newer data.
  if (error && error.code !== 'PGRST116') {
    throw new Error(`stale-check read unavailable for ${subscriptionId}: ${error.message}`);
  }
  return !!(data && data.stripe_event_at && new Date(data.stripe_event_at) > new Date(eventAt));
}

async function onCheckoutSessionCompleted(session) {
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const stripeCustomerId = session.customer;
  // The stable app identity established when checkout was CREATED (payments.js
  // stamps both session.metadata.app_user_id and client_reference_id).
  const appUserId = session.metadata?.app_user_id || session.client_reference_id || null;

  // SV-21-01 (v21): under enforcement the customer row is keyed and linked by the
  // stable app_user_id, NEVER relinked by checkout email — and this event, the
  // only one that writes customers.stripe_customer_id, verifies the live Stripe
  // Customer's EXACT source + this-user stamp before persisting. So a foreign or
  // wrong-user customer id can never be adopted even when the email matches.
  if (ownership.ownershipEnforced()) {
    if (!appUserId || !stripeCustomerId) {
      // Acknowledged (already gated on the exact scalvya stamp upstream), but an
      // unidentifiable session persists nothing.
      opsSignal('ownership_mismatch', { reason: 'checkout_missing_app_user_id', severity: 'high' });
      return;
    }
    let customerObj;
    try {
      customerObj = await stripe.customers.retrieve(stripeCustomerId);
    } catch (err) {
      // Transient provider read — throw so Stripe retries; never persist blind.
      throw new Error(`checkout customer unavailable for ${stripeCustomerId}: ${err.message}`, { cause: err });
    }
    if (ownership.classifyCustomer(customerObj, appUserId) !== ownership.OWNERSHIP.OWNED) {
      opsSignal('ownership_mismatch', { reason: 'checkout_customer_ownership_unproven', severity: 'high' });
      return; // acked, never adopted
    }
    const linkEmail = (customerObj.email || email || '').toLowerCase();
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .upsert(
        { app_user_id: appUserId, email: linkEmail, stripe_customer_id: stripeCustomerId, metadata: { app_user_id: appUserId } },
        { onConflict: 'app_user_id', ignoreDuplicates: false },
      )
      .select('id')
      .single();
    if (customerError) {
      throw new Error(`Supabase upsert failed for customer on checkout: ${customerError.message}`);
    }
    if (session.mode === 'subscription' && session.subscription) {
      await supabase.from('subscriptions').update({ customer_id: customer.id }).eq('stripe_subscription_id', session.subscription);
      console.log(`Checkout subscription linked: ${session.subscription} → customer ${customer.id}`);
    }
    return;
  }

  // Pre-enforcement (capped beta / pre-038 schema): unchanged email-keyed link.
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

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', subscription.customer)
    .single();

  const { error } = await supabase.from('subscriptions').upsert(
    subscriptionMirrorRow(subscription, customer?.id ?? null, eventAt),
    { onConflict: 'stripe_subscription_id' }
  );

  if (error) {
    throw new Error(`Supabase upsert failed for subscription update: ${error.message}`);
  }

  console.log(`Subscription ${subscription.status}: ${subscription.id}`);

  // LB-V19 (LB-01): emit value/billing analytics only AFTER the durable upsert
  // succeeds. Before this, a failed upsert (which throws and is redelivered)
  // would have already fired subscription_created/trial_started for state that
  // never persisted, double-counting on retry. Now analytics reflect only
  // durably-persisted state, matching the lifecycle-email ordering below.
  const userId = (subscription.metadata && subscription.metadata.app_user_id) || null;
  if (eventType === 'customer.subscription.created') {
    track('subscription_created', { userId, properties: { status: subscription.status } });
    if (subscription.status === 'trialing') {
      track('trial_started', { userId, properties: { trial_end: subscription.trial_end || null } });
    }
  } else {
    track('subscription_updated', { userId, properties: { status: subscription.status } });
  }

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
// v18 S05: the pull-based reconciliation job reuses the exact ownership rule and
// mirror projection, so it can never adopt a foreign subscription or write a row
// shape that drifts from the webhook's.
module.exports.ownsSubscription = ownsSubscription;
module.exports.subscriptionMirrorRow = subscriptionMirrorRow;
// SV-21-01 (v21): canonical invoice ownership (replaces the price-only
// isOurInvoice) + the API-shape-tolerant subscription-id resolver, exported so
// the adversarial invoice tests can assert owned/foreign/ambiguous/unavailable.
module.exports.classifyInvoiceOwnership = classifyInvoiceOwnership;
module.exports.invoiceSubscriptionId = invoiceSubscriptionId;
// SV-21-01: exported so the enforced-path test can assert a wrong-user / foreign
// checkout customer is never persisted and the owner key is app_user_id.
module.exports.onCheckoutSessionCompleted = onCheckoutSessionCompleted;
