// ---------------------------------------------------------------------------
// Stripe payments. Inherited from ConversionForge; trimmed to the endpoints
// OfferFlow actually uses (hosted Checkout + cancel + status).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { resolveEntitlement, readFailed, redactEmail, findCustomerRow } = require('./customers');
const {
  planUnavailableBody,
  EntitlementUnavailableError,
  isEntitlementUnavailable,
} = require('../lib/subscription-state');
const { requireAuth } = require('../lib/auth');
const { track } = require('../lib/analytics');
const { selectCatalog, selectionTelemetry } = require('../lib/plan-catalog');
const { opsSignal } = require('../lib/ops-signal');
// SV-01 (v20): the canonical, typed ownership service. payments shares its exact
// source tag and customer classifier so checkout and the webhook decide identity
// with ONE rule.
const ownership = require('../lib/stripe-ownership');

// Scalvya's ownership tag in the SHARED Stripe account. Every customer this app
// creates carries metadata.source = this value; recovery and reconciliation only
// ever match on it, so a Mellowa (or any foreign) customer is never adopted.
const APP_STRIPE_SOURCE = ownership.APP_STRIPE_SOURCE;

/**
 * v15 SC-02: multiple Scalvya-owned Stripe customers exist for one user. This is
 * never resolved by arbitrary selection — it fails closed with a stable internal
 * code and a redacted operator signal. No PII, no customer ids in the message.
 */
class CustomerReconciliationRequiredError extends Error {
  constructor(count, reason = null) {
    super('customer reconciliation required');
    this.name = 'CustomerReconciliationRequiredError';
    this.code = 'CUSTOMER_RECONCILIATION_REQUIRED';
    this.candidateCount = count;
    // SC-95-01: why reconciliation is required (duplicate candidates vs a live
    // link/winner whose ownership could not be proven). Operator signal only —
    // never surfaced to the buyer.
    this.reason = reason;
  }
}

/**
 * SC-95-01: the ONE ownership predicate for a live Stripe Customer on the shared
 * account. A Customer is Scalvya-owned only if it is not deleted AND its
 * metadata proves this app (`source`) AND this exact stable user
 * (`app_user_id`). The durable DB link, a recovered search candidate, the
 * freshly created object and a concurrent link-race winner all pass through
 * here before use — object presence, a local DB row or email equality is never
 * proof, so a Mellowa/foreign or wrong-user Customer can never be adopted even
 * when the email or user id look identical.
 */
function isOwnedScalvyaCustomer(customer, userId) {
  // Delegates to the canonical typed classifier; a customer is adoptable only
  // when it is exactly OWNED by this app AND this stable user id.
  return ownership.classifyCustomer(customer, userId) === ownership.OWNERSHIP.OWNED;
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
  // SV-21-01: canonical identity — findCustomerRow keys on app_user_id under
  // enforcement (email is mutable display data) and on email before it, and fails
  // closed on a read error or on multiple app_user_id rows.
  const existing = await findCustomerRow({ userId, email }, 'id, stripe_customer_id');

  if (existing && existing.stripe_customer_id) {
    // Shared-Stripe fallout: the stored id can point at a customer that only
    // exists in test mode or on another account ("No such customer" in live),
    // or — the SC-95-01 hole — at a live FOREIGN or wrong-user customer. A
    // durable DB link is not ownership proof by itself; verify metadata at the
    // moment of use.
    let linkedCustomer = null;
    try {
      linkedCustomer = await stripe.customers.retrieve(existing.stripe_customer_id);
    } catch (err) {
      if (err.code !== 'resource_missing') throw err;
      // resource_missing → stale link, eligible for the existing safe recovery.
      opsSignal('stale_link_recovered', { reason: 'linked_customer_missing', severity: 'info' });
      // v14 SC-03: never log the full email — redacted + opaque Stripe id only.
      console.warn(`[ensureStripeCustomer] stale stripe_customer_id ${existing.stripe_customer_id} for ${redactEmail(email)} — recovering`);
    }
    if (linkedCustomer) {
      // SC-95-01: reuse the durable link ONLY when metadata proves ownership.
      if (isOwnedScalvyaCustomer(linkedCustomer, userId)) return existing.stripe_customer_id;
      if (!linkedCustomer.deleted) {
        // Live but foreign / wrong-user / missing-metadata. NEVER overwrite the
        // link and NEVER mint a second customer around it — fail closed for an
        // operator to reconcile. The buyer gets the safe checkout-unavailable
        // copy; nothing in Stripe is mutated.
        opsSignal('ownership_mismatch', { reason: 'durable_link_foreign_or_wrong_user', severity: 'high' });
        throw new CustomerReconciliationRequiredError(1, 'durable_link_ownership_mismatch');
      }
      // Deleted object behaves like a stale link → fall through to safe recovery.
      opsSignal('stale_link_recovered', { reason: 'linked_customer_deleted', severity: 'info' });
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
    // SC-95-01: verify the create RESPONSE carries our ownership stamp before
    // adopting it. We just set source + app_user_id, so a response that fails
    // the predicate means an idempotent replay returned a foreign object or the
    // client is misbehaving — never proceed with an unverified id.
    if (!isOwnedScalvyaCustomer(stripeCustomer, userId)) {
      throw new EntitlementUnavailableError(new Error('created Stripe customer failed ownership verification'));
    }
    customerId = stripeCustomer.id;
  }

  // v14 SC-02: verify persistence. If the Stripe customer cannot be mirrored in
  // Supabase we must NOT open checkout against an unlinked customer — a webhook
  // could later fail to attribute the subscription. We do NOT delete the Stripe
  // customer on a failed link (no proven-safe idempotent compensation without
  // first proving no subscription/session references it); the recovery lookup
  // above reclaims it on the next attempt. Log a redacted event and fail closed.
  // SV-21-01: under enforcement, app_user_id is a first-class column AND the
  // canonical conflict key — a changing email can no longer create, orphan or
  // switch billing identity, and `onConflict: 'email'` is never the final key.
  // (Enforcement is only turned on after migration 038 + the additive uniqueness
  // in 039 are applied and app_user_id is backfilled, so the conflict target
  // exists.) Before enforcement the historical email key is preserved unchanged.
  const enforced = ownership.ownershipEnforced();
  const upsertRow = enforced
    ? { app_user_id: userId, email, stripe_customer_id: customerId, metadata: { app_user_id: userId } }
    : { email, stripe_customer_id: customerId, metadata: { app_user_id: userId } };
  const { error: upsertErr } = await supabase
    .from('customers')
    .upsert(upsertRow, { onConflict: enforced ? 'app_user_id' : 'email' });
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
  // SV-21-01: read back by the same canonical key we wrote. A read-back miss,
  // read error or (under enforcement) an unexpected multi-row result is treated
  // as transient and MUST NOT undo the durable write above — fall through and
  // return the customer we created.
  let linked;
  try {
    if (enforced) {
      const { data } = await supabase
        .from('customers').select('stripe_customer_id').eq('app_user_id', userId).limit(2);
      linked = Array.isArray(data) && data.length === 1 ? data[0] : null;
    } else {
      const { data } = await supabase
        .from('customers').select('stripe_customer_id').eq('email', email).single();
      linked = data || null;
    }
  } catch { linked = null; }
  if (linked && linked.stripe_customer_id && linked.stripe_customer_id !== customerId) {
    try {
      const winner = await stripe.customers.retrieve(linked.stripe_customer_id);
      // SC-95-01: adopt the race winner ONLY when metadata proves exact
      // ownership. A live-but-foreign, wrong-user, metadata-free or deleted
      // winner is NOT proof the persisted link is ours — fail closed.
      if (isOwnedScalvyaCustomer(winner, userId)) {
        opsSignal('link_race_reconciliation', { reason: 'stripe_customer_link_race_resolved', severity: 'info' });
        return linked.stripe_customer_id;
      }
      opsSignal('ownership_mismatch', { reason: 'link_race_winner_foreign_or_wrong_user', severity: 'high' });
    } catch { /* winner unretrievable — fall through to reconciliation-required */ }
    throw new CustomerReconciliationRequiredError(2, 'link_race_ownership_unproven');
  }

  return customerId;
}

/**
 * True only when the signed-in user owns the subscription's local customer row.
 * SV-21-01: under enforcement ownership is decided by the stable app_user_id
 * (an email change never grants or revokes access); before enforcement the
 * historical email match is preserved. `identity` is { userId, userEmail }.
 */
async function ownsSubscription(subscriptionId, identity) {
  const userId = identity && identity.userId;
  const userEmail = (identity && identity.userEmail) || '';
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('customer_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  if (!sub?.customer_id) return false;

  if (ownership.ownershipEnforced() && userId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('app_user_id')
      .eq('id', sub.customer_id)
      .single();
    return !!customer && customer.app_user_id === userId;
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('email')
    .eq('id', sub.customer_id)
    .single();
  return !!customer?.email && !!userEmail && customer.email.toLowerCase() === userEmail.toLowerCase();
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
async function hadTrialOrActiveSubscription(identity) {
  // SV-21-01: accept either the legacy bare email string OR { email, userId }.
  // findCustomerRow resolves the row by app_user_id under enforcement and by
  // email before it, and fails closed (throws) on a read error — so an outage is
  // never mistaken for "no prior trial". Keying on the stable app_user_id also
  // stops a returning user getting a second free trial after an email change.
  const email = (typeof identity === 'string' ? identity : (identity && identity.email) || '').trim().toLowerCase();
  const userId = typeof identity === 'string' ? null : (identity && identity.userId) || null;
  if (!email && !userId) return false;

  const customer = await findCustomerRow({ userId, email }, 'id');
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
    // SV-22-01: the duplicate-subscription guard MUST resolve entitlement by the
    // same canonical owner key (stable app_user_id under enforcement) as the
    // account plan display and checkout customer lookup — otherwise an email
    // change would hide the existing subscription and let a second one be created.
    const { state, plan: currentPlan } = await resolveEntitlement({ userId, email });
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
    const giveTrial = !(await hadTrialOrActiveSubscription({ email, userId }));

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
        // LB-V17-02: stamp the EXACT Scalvya discriminator on the subscription
        // (and thus on the object the webhook sees), not just app_user_id. On the
        // shared Stripe account, `source` is what proves ownership — a bare
        // app_user_id key is no longer accepted as proof by the webhook.
        metadata: { source: APP_STRIPE_SOURCE, app_user_id: userId || '' },
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
    if (err instanceof CustomerReconciliationRequiredError || err.code === 'CUSTOMER_RECONCILIATION_REQUIRED') {
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
    if (!(await ownsSubscription(subscriptionId, { userId: req.userId, userEmail: req.userEmail }))) {
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
    if (!(await ownsSubscription(req.params.subscriptionId, { userId: req.userId, userEmail: req.userEmail }))) {
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
// SC-95-01: exported so the ownership matrix can assert the predicate directly.
module.exports.isOwnedScalvyaCustomer = isOwnedScalvyaCustomer;
module.exports.stripeCustomerIdempotencyKey = stripeCustomerIdempotencyKey;
module.exports.CustomerReconciliationRequiredError = CustomerReconciliationRequiredError;
module.exports.APP_STRIPE_SOURCE = APP_STRIPE_SOURCE;
