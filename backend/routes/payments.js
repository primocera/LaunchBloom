// ---------------------------------------------------------------------------
// Stripe payments. Inherited from ConversionForge; trimmed to the endpoints
// OfferFlow actually uses (hosted Checkout + cancel + status).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { resolveEntitlement, readFailed, redactEmail } = require('./customers');
const {
  planUnavailableBody,
  EntitlementUnavailableError,
  isEntitlementUnavailable,
} = require('../lib/subscription-state');
const { requireAuth } = require('../lib/auth');
const { track } = require('../lib/analytics');
const { selectCatalog, selectionTelemetry } = require('../lib/plan-catalog');
const { opsSignal } = require('../lib/ops-signal');

// Scalvya's ownership tag in the SHARED Stripe account. Every customer this app
// creates carries metadata.source = this value; recovery and reconciliation only
// ever match on it, so a Mellowa (or any foreign) customer is never adopted.
const APP_STRIPE_SOURCE = 'launchbloom';

/**
 * v15 SC-02: multiple Scalvya-owned Stripe customers exist for one user. This is
 * never resolved by arbitrary selection — it fails closed with a stable internal
 * code and a redacted operator signal. No PII, no customer ids in the message.
 */
class CustomerReconciliationRequiredError extends Error {
  constructor(count) {
    super('customer reconciliation required');
    this.name = 'CustomerReconciliationRequiredError';
    this.code = 'CUSTOMER_RECONCILIATION_REQUIRED';
    this.candidateCount = count;
  }
}

/**
 * A deterministic, PII-free Stripe idempotency key for customer creation, stable
 * across retries that should converge on ONE customer. Namespaced by app + the
 * stable internal user id — never the raw (mutable, PII) email.
 */
function stripeCustomerIdempotencyKey(userId) {
  return `scalvya:customer:create:${userId}`;
}

/**
 * Read-only recovery: find Scalvya-owned Stripe customers for this user by exact
 * app-ownership metadata (source + stable user id). Returns zero / one / multiple
 * so the caller can create idempotently, reuse, or fail closed. Never matches on
 * email, so it cannot adopt a foreign product's customer from the shared account.
 */
async function recoverScalvyaCustomer(userId) {
  if (typeof stripe.customers.search !== 'function') return { status: 'zero' };
  const query = `metadata['app_user_id']:'${userId}' AND metadata['source']:'${APP_STRIPE_SOURCE}'`;
  const res = await stripe.customers.search({ query, limit: 10 });
  const live = (res && res.data ? res.data : []).filter(
    (c) => c && !c.deleted && c.metadata
      && c.metadata.app_user_id === userId && c.metadata.source === APP_STRIPE_SOURCE,
  );
  if (live.length === 0) return { status: 'zero' };
  if (live.length === 1) return { status: 'one', id: live[0].id };
  return { status: 'multiple', count: live.length, ids: live.map((c) => c.id) };
}

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
  // v15 SC-02: identity is the STABLE INTERNAL user id. Without it we can build
  // neither a PII-free idempotency key nor a safe recovery query, so we fail
  // closed rather than fall back to an email-keyed identity (email is mutable
  // and PII). requireAuth guarantees userId upstream; this is defense in depth.
  if (!userId) throw new EntitlementUnavailableError(new Error('missing stable user id for customer identity'));

  // v14 SC-02: FAIL CLOSED. A Supabase read error is NOT "no customer" — reading
  // it as absence lets a transient outage mint a SECOND Stripe customer for a
  // user who already has one. Distinguish a verified no-row (PGRST116) from a
  // real failure and throw the canonical unavailable error on the latter, before
  // any Stripe mutation.
  const { data: existing, error: existingErr } = await supabase
    .from('customers')
    .select('id, stripe_customer_id')
    .eq('email', email)
    .single();
  if (readFailed(existingErr)) throw new EntitlementUnavailableError(existingErr);

  if (existing && existing.stripe_customer_id) {
    // Shared-Stripe fallout: the stored id can point at a customer that only
    // exists in test mode or on another account ("No such customer" in live).
    // Verify it against the current key; recover on resource_missing.
    try {
      const c = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!c.deleted) return existing.stripe_customer_id;
    } catch (err) {
      if (err.code !== 'resource_missing') throw err;
      // v14 SC-03: never log the full email — redacted + opaque Stripe id only.
      console.warn(`[ensureStripeCustomer] stale stripe_customer_id ${existing.stripe_customer_id} for ${redactEmail(email)} — recovering`);
    }
  }

  // v15 SC-02: BEFORE creating, recover an existing Scalvya-owned customer by app
  // metadata. Stripe does NOT deduplicate Customer objects by email, so a bare
  // create() on every retry (e.g. after a failed link write) would multiply
  // customers. Recovery reclaims a prior orphan by the stable user id instead.
  //   zero     → create idempotently;
  //   one      → reuse (the query already proved it live + Scalvya-owned);
  //   multiple → fail closed, never an arbitrary selection.
  const recovered = await recoverScalvyaCustomer(userId);
  if (recovered.status === 'multiple') throw new CustomerReconciliationRequiredError(recovered.count);

  let customerId;
  if (recovered.status === 'one') {
    customerId = recovered.id;
  } else {
    // The namespaced idempotency key makes concurrent and retried creates for
    // the same user converge on ONE Customer within Stripe's key-retention
    // window (~24h) — the primary guard against duplicates under a race.
    const stripeCustomer = await stripe.customers.create(
      { email, metadata: { app_user_id: userId, source: APP_STRIPE_SOURCE } },
      { idempotencyKey: stripeCustomerIdempotencyKey(userId) },
    );
    customerId = stripeCustomer.id;
  }

  // v14 SC-02: verify persistence. If the Stripe customer cannot be mirrored in
  // Supabase we must NOT open checkout against an unlinked customer — a webhook
  // could later fail to attribute the subscription. We do NOT delete the Stripe
  // customer on a failed link (no proven-safe idempotent compensation without
  // first proving no subscription/session references it); the recovery lookup
  // above reclaims it on the next attempt. Log a redacted event and fail closed.
  const { error: upsertErr } = await supabase
    .from('customers')
    .upsert(
      { email, stripe_customer_id: customerId, metadata: { app_user_id: userId } },
      { onConflict: 'email' }
    );
  if (upsertErr) {
    console.error(JSON.stringify({
      code: 'STRIPE_CUSTOMER_PERSIST_FAILED',
      level: 'error',
      source: 'ensureStripeCustomer',
      email: redactEmail(email),
      stripe_customer_id: customerId,
    }));
    throw new EntitlementUnavailableError(upsertErr);
  }

  // v15 SC-02: conflict/race check. If a concurrent writer linked a DIFFERENT
  // customer, the DB row is the durable truth — never open checkout against the
  // customer we happened to create. Prefer the persisted winner if it is live;
  // otherwise fail closed for reconciliation. A read-back miss (no row / read
  // error) is treated as transient and does not undo the durable write above.
  const { data: linked } = await supabase
    .from('customers')
    .select('stripe_customer_id')
    .eq('email', email)
    .single();
  if (linked && linked.stripe_customer_id && linked.stripe_customer_id !== customerId) {
    try {
      const winner = await stripe.customers.retrieve(linked.stripe_customer_id);
      if (!winner.deleted) {
        opsSignal('reconciliation_correction', { reason: 'stripe_customer_link_race_resolved', severity: 'info' });
        return linked.stripe_customer_id;
      }
    } catch { /* winner unretrievable — fall through to reconciliation-required */ }
    throw new CustomerReconciliationRequiredError(2);
  }

  return customerId;
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
 * fresh checkout must NOT grant another 3-day free trial.
 *
 * v14 SC-02: FAIL CLOSED. Only a VERIFIED absence returns false — a verified
 * no-customer row (PGRST116) or a verified empty subscription set. Any Supabase
 * read error throws EntitlementUnavailableError, because treating an outage as
 * "no prior trial" is exactly how a returning user is handed a second free
 * trial. Callers must resolve this BEFORE mutating anything in Stripe.
 */
async function hadTrialOrActiveSubscription(email) {
  email = (email || '').trim().toLowerCase();
  if (!email) return false;
  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .single();
  if (readFailed(customerErr)) throw new EntitlementUnavailableError(customerErr);
  if (!customer) return false;

  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('status, trial_end')
    .eq('customer_id', customer.id);
  if (readFailed(subsErr)) throw new EntitlementUnavailableError(subsErr);
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

    // v14 SC-02: resolve ALL billing state that gates checkout BEFORE creating
    // or mutating anything in Stripe. Trial eligibility is verified here; if it
    // cannot be verified, hadTrialOrActiveSubscription throws before any Stripe
    // customer exists. 3-day free trial for first-time subscribers only.
    const giveTrial = !(await hadTrialOrActiveSubscription(email));

    const baseUrl = resolveBaseUrl();
    const customerId = await ensureStripeCustomer(email, userId);

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
    // v14 SC-02: billing state could not be verified (trial-history or customer
    // read/persist failure). Nothing was created in Stripe — the reads run
    // before ensureStripeCustomer, and a persist failure throws before a session
    // is created. Return a stable, retryable 503 with honest "not charged" copy.
    if (isEntitlementUnavailable(err)) {
      track('checkout_failed', { userId: req.userId, properties: { reason: 'billing_state_unavailable' } });
      return checkoutUnavailable(res, { retryable: true, reason: 'billing_state_unavailable' });
    }
    // v15 SC-02: multiple Scalvya-owned Stripe customers for one user. Not
    // retryable by the buyer — an operator must reconcile. Emit a redacted,
    // PII-free signal (the count only) and fail closed with the safe copy.
    if (err instanceof CustomerReconciliationRequiredError) {
      opsSignal('reconciliation_correction', {
        reason: `multiple_stripe_customers:${err.candidateCount}`,
        severity: 'high',
      });
      track('checkout_failed', { userId: req.userId, properties: { reason: 'customer_reconciliation_required' } });
      return checkoutUnavailable(res, { retryable: false, reason: 'customer_reconciliation_required' });
    }
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
    // v14 SC-03: never echo Stripe/Supabase raw text to the client. A vanished
    // subscription is a 404; everything else is a stable generic 500.
    console.error('[cancel-subscription] error', err.type, err.code, err.message);
    if (err.code === 'resource_missing') {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.status(500).json({ error: 'Could not update your subscription right now. Please try again.', code: 'SUBSCRIPTION_UPDATE_FAILED' });
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
    // v14 SC-03: stable generic message; never leak Stripe/Supabase raw text.
    console.error('[get-subscription] error', err.type, err.code, err.message);
    if (err.code === 'resource_missing') {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.status(500).json({ error: 'Could not load your subscription right now. Please try again.', code: 'SUBSCRIPTION_LOOKUP_FAILED' });
  }
});

module.exports = router;
// v7 LB-12: account/billing uses this to switch paywall copy to pay-today for
// users who already used their one trial.
module.exports.hadTrialOrActiveSubscription = hadTrialOrActiveSubscription;
// v15 SC-02: exported for unit tests (idempotency, recovery, race, reconciliation).
module.exports.ensureStripeCustomer = ensureStripeCustomer;
module.exports.recoverScalvyaCustomer = recoverScalvyaCustomer;
module.exports.stripeCustomerIdempotencyKey = stripeCustomerIdempotencyKey;
module.exports.CustomerReconciliationRequiredError = CustomerReconciliationRequiredError;
module.exports.APP_STRIPE_SOURCE = APP_STRIPE_SOURCE;
