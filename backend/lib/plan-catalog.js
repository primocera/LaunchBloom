// ---------------------------------------------------------------------------
// Canonical commercial catalog (v5 Prompt 1) — the ONE source of truth for
// what each plan costs and includes. The landing page, account UI, upgrade
// modals and checkout allowlist all consume this (via GET /api/plans);
// enforcement limits come from PLAN_LIMITS so numbers can never drift.
//
// Prices are display prices in USD. Annual savings are CALCULATED from the
// monthly/yearly numbers — never handwritten.
// ---------------------------------------------------------------------------

const { PLAN_LIMITS } = require('./plan-limits');
const {
  SUPPORTED, EUR_COUNTRIES, countryOf, currencyForCountry, eurEnabled, eurCatalogReady,
} = require('./currency');

// v13 SC-P0-03: bumped whenever PRICES or the currency rules change. Pricing
// page, paywall, checkout CTA and the server-created Checkout Session all carry
// this same value, so a display/charge mismatch is traceable to one catalog.
const CATALOG_VERSION = '2026-07-31.1';

// One successful user-triggered generation or regeneration = one AI action.
const AI_ACTION_DEFINITION =
  'One AI action is one successful user-triggered generation or regeneration. ' +
  'Failed generations do not count. Copying, editing and exporting do not count.';

// Stripe env-variable names per plan/interval (payments.js resolves these).
const STRIPE_ENV = {
  starter: { monthly: 'STRIPE_PRICE_STARTER_MONTHLY', yearly: 'STRIPE_PRICE_STARTER_YEARLY' },
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', yearly: 'STRIPE_PRICE_PRO_YEARLY' },
  studio: { monthly: 'STRIPE_PRICE_STUDIO_MONTHLY', yearly: 'STRIPE_PRICE_STUDIO_YEARLY' },
};

// Canonical prices, per currency — the only place amounts are written outside
// Stripe. USD is the base; EUR amounts are the USD amounts converted at the ECB
// reference rate 1 USD = 0.8707 EUR (2026-07-31), monthly rounded to cents and
// yearly to whole euros. This is a fixed, owner-approved snapshot — NOT a live
// rate — so the displayed price always equals the charged price. Each Stripe
// Price must carry both currencies (currency_options); verify-stripe-prices.js
// asserts Stripe matches this table for both.
const PRICES = {
  starter: { usd: { monthly: 12.99, yearly: 99 }, eur: { monthly: 11.31, yearly: 86 } },
  pro: { usd: { monthly: 24.99, yearly: 199 }, eur: { monthly: 21.76, yearly: 173 } },
  studio: { usd: { monthly: 59, yearly: 499 }, eur: { monthly: 51.37, yearly: 434 } },
};

// v8 LB-S08: value comms reframed around jobs completed — capacity (campaigns,
// actions, workspaces) is what scales by tier; the campaign-control workflow
// (gap map, consistency checks, brief-change review, review packet export)
// is included for every paid/trial user and never uses AI actions. No badge
// until real usage data supports one (a fake "Most popular" is banned copy).
const PLAN_META = {
  starter: {
    note: 'Freelancers, creators, solo starters',
    jobs: 'Run one brand: take an offer from brief to a reviewed, exportable campaign a few times a month.',
  },
  pro: {
    note: 'Small ecommerce brands and serious creators',
    jobs: 'Run overlapping campaigns for up to three brands or stores with room to revise and regenerate.',
  },
  studio: {
    note: 'Agencies and multi-brand users',
    jobs: 'Run many client campaigns in parallel — separate workspaces, high revision capacity, handoff packets per client.',
  },
};

// Included on every plan AND the trial; never paywalled and never metered.
const INCLUDED_FREE =
  'Campaign gap map, consistency checks, brief-change review, evidence locker, ' +
  'review queue, editing and exports are included on every plan and the trial — ' +
  'they never use AI actions.';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function safeCurrency(currency) {
  return SUPPORTED.includes(currency) ? currency : 'usd';
}

const CURRENCY_SYMBOL = { usd: '$', eur: '€' };

/** Format an amount in the given currency: "$12.99", "€86", "€11.31". */
function money(amount, currency = 'usd') {
  const sym = CURRENCY_SYMBOL[safeCurrency(currency)];
  return Number.isInteger(amount) ? `${sym}${amount}` : `${sym}${amount.toFixed(2)}`;
}

/** Exact yearly saving vs 12 monthly payments, in `currency`: { amount, pct }. */
function yearlySavings(plan, currency = 'usd') {
  const p = PRICES[plan] && PRICES[plan][safeCurrency(currency)];
  if (!p) return null;
  const twelveMonths = round2(p.monthly * 12);
  const amount = round2(twelveMonths - p.yearly);
  const pct = Math.round((amount / twelveMonths) * 1000) / 10;
  return { amount, pct };
}

/** Highest savings percentage across plans, rounded down for the badge (never overstates). */
function maxSavingsPct(currency = 'usd') {
  return Math.max(...Object.keys(PRICES).map((p) => Math.floor(yearlySavings(p, currency).pct)));
}

/**
 * Serializable catalog for GET /api/plans and any UI. Limits are read live
 * from PLAN_LIMITS — this function cannot disagree with enforcement.
 */
function publicCatalog(currency = 'usd') {
  const cur = safeCurrency(currency);
  const plans = Object.keys(PRICES).map((key) => {
    const limits = PLAN_LIMITS[key];
    const savings = yearlySavings(key, cur);
    const amt = PRICES[key][cur];
    return {
      plan: key,
      label: limits.label,
      note: PLAN_META[key].note,
      jobs: PLAN_META[key].jobs,
      badge: PLAN_META[key].badge || null,
      price: {
        currency: cur,
        monthly: amt.monthly,
        yearly: amt.yearly,
        display: { monthly: money(amt.monthly, cur), yearly: money(amt.yearly, cur) },
      },
      stripe_env: STRIPE_ENV[key],
      workspaces: limits.workspaces,
      ai_actions: limits.ai_actions,
      launch_kits: limits.launch_kits,
      can_export: limits.can_export,
      yearly_savings: { amount: savings.amount, display: money(savings.amount, cur), pct: savings.pct },
    };
  });

  const trial = PLAN_LIMITS.trial;
  return {
    currency: cur,
    // v13 SC-P0-03: the catalog version the buyer was shown. Checkout stamps the
    // same value on its Stripe session metadata.
    catalog_version: CATALOG_VERSION,
    plans,
    trial: {
      days: 3,
      ai_actions_total: trial.ai_actions,
      launch_kits_total: trial.launch_kits,
      workspaces: trial.workspaces,
      // Required customer-facing copy (v5 Prompt 1).
      disclosure: "Payment method required. Cancel before your trial ends and you won't be charged.",
      eyebrow: 'Start with 3 days free',
    },
    yearly_badge: `Save up to ${maxSavingsPct(cur)}%`,
    ai_action_definition: AI_ACTION_DEFINITION,
    included_free: INCLUDED_FREE,
    // Region-based pricing note. Only shown once EUR pricing is actually live
    // (EUR_PRICING_ENABLED=1); while off, everyone is billed USD so a "EU pays
    // EUR" note would be false. When on, the displayed price equals the charged
    // price in both currencies, so this is a plain location statement.
    currency_note: process.env.EUR_PRICING_ENABLED !== '1'
      ? null
      : cur === 'eur'
        ? 'Shown in EUR based on your location. Customers outside the EU are billed in USD.'
        : 'Shown in USD. Customers in the EU/EEA are billed in EUR.',
  };
}

// ---------------------------------------------------------------------------
// v13 SC-P0-03 — authoritative server-side catalog selection.
//
// ONE function decides region -> currency -> price id -> availability. GET
// /api/plans (what the buyer sees) and POST create-checkout-session (what the
// buyer is charged) both call it, so the displayed price and the charged price
// come from the same decision. Client input never selects a currency or a
// Stripe price id: only { plan, interval } is accepted, and both are validated
// against this table.
// ---------------------------------------------------------------------------

const PLAN_ALIASES = { business: 'studio' };
const LEGACY_PLAN_ENV = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  studio: 'STRIPE_PRICE_BUSINESS',
};

/** The env var name ("price key") that holds the Stripe price for a plan/interval. */
function priceKey(plan, interval) {
  const p = PLAN_ALIASES[plan] || plan;
  const entry = STRIPE_ENV[p];
  if (!entry) return null;
  return entry[interval === 'yearly' ? 'yearly' : 'monthly'];
}

/** Resolve the Stripe price id for a plan/interval from env (legacy monthly fallback). */
function stripePriceId(plan, interval) {
  const p = PLAN_ALIASES[plan] || plan;
  const key = priceKey(p, interval);
  if (!key) return null;
  return process.env[key] || process.env[LEGACY_PLAN_ENV[p]] || null;
}

/**
 * Authoritative selection for a request.
 *
 * @param {object} req  express request (read for edge geo headers only)
 * @param {object} [opts] { plan, interval } when a specific price is needed
 * @returns {{
 *   region: 'eu'|'non_eu', currency: 'usd'|'eur', requested_currency: 'usd'|'eur',
 *   catalog_version: string, fallback_reason: string|null,
 *   plan: string|null, interval: string|null,
 *   price_key: string|null, price_id: string|null, available: boolean,
 * }}
 */
function selectCatalog(req, opts = {}) {
  const country = String(countryOf(req) || '').trim().toUpperCase();
  const region = EUR_COUNTRIES.has(country) ? 'eu' : 'non_eu';

  // What the region WOULD be quoted if EUR were fully live, vs what it actually
  // gets. The fallback is decided here, before display — never after.
  const requested = eurEnabled() ? currencyForCountry(country) : 'usd';
  let currency = requested;
  let fallbackReason = null;
  if (requested === 'eur' && !eurCatalogReady()) {
    currency = 'usd';
    fallbackReason = 'eur_catalog_unverified';
  }
  if (currency === 'eur' && missingStripeEnv().length) {
    currency = 'usd';
    fallbackReason = 'stripe_price_env_incomplete';
  }

  const plan = opts.plan ? (PLAN_ALIASES[opts.plan] || opts.plan) : null;
  const interval = opts.interval === 'yearly' ? 'yearly' : (opts.interval ? 'monthly' : null);
  const known = plan ? Object.prototype.hasOwnProperty.call(PRICES, plan) : false;
  const key = known ? priceKey(plan, interval) : null;
  const id = known ? stripePriceId(plan, interval) : null;

  return {
    region,
    currency,
    requested_currency: requested,
    catalog_version: CATALOG_VERSION,
    fallback_reason: fallbackReason,
    plan: known ? plan : null,
    interval,
    price_key: key,
    price_id: id,
    // With no plan asked for, availability means "the catalog can be displayed".
    available: plan ? Boolean(known && id) : true,
  };
}

/** Redacted, PII-free telemetry shape for a selection (safe to log/track). */
function selectionTelemetry(sel) {
  return {
    region: sel.region,
    currency: sel.currency,
    requested_currency: sel.requested_currency,
    catalog_version: sel.catalog_version,
    fallback_reason: sel.fallback_reason,
    plan: sel.plan,
    interval: sel.interval,
    price_key: sel.price_key, // env var NAME, never the price id or any user data
  };
}

/** Names of Stripe price env vars that are missing (for production config checks). */
function missingStripeEnv() {
  const missing = [];
  for (const plan of Object.keys(STRIPE_ENV)) {
    for (const interval of ['monthly', 'yearly']) {
      const name = STRIPE_ENV[plan][interval];
      // Legacy single-price vars keep old deployments working for monthly.
      const legacy = { starter: 'STRIPE_PRICE_STARTER', pro: 'STRIPE_PRICE_PRO', studio: 'STRIPE_PRICE_BUSINESS' }[plan];
      if (!process.env[name] && !(interval === 'monthly' && process.env[legacy])) missing.push(name);
    }
  }
  return missing;
}

module.exports = {
  PRICES,
  INCLUDED_FREE,
  STRIPE_ENV,
  CATALOG_VERSION,
  PLAN_ALIASES,
  priceKey,
  stripePriceId,
  selectCatalog,
  selectionTelemetry,
  AI_ACTION_DEFINITION,
  money,
  yearlySavings,
  maxSavingsPct,
  publicCatalog,
  missingStripeEnv,
};
