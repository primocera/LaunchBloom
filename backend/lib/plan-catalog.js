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

// Display prices (USD — Stripe charges in USD, primary market is the US).
// The only place prices are written down outside Stripe.
const PRICES = {
  starter: { monthly: 12.99, yearly: 99 },
  pro: { monthly: 24.99, yearly: 199 },
  studio: { monthly: 59, yearly: 499 },
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

/** Exact yearly saving vs 12 monthly payments: { amount, pct } (pct to 1dp). */
function yearlySavings(plan) {
  const p = PRICES[plan];
  if (!p) return null;
  const twelveMonths = round2(p.monthly * 12);
  const amount = round2(twelveMonths - p.yearly);
  const pct = Math.round((amount / twelveMonths) * 1000) / 10;
  return { amount, pct };
}

/** Highest savings percentage across plans, rounded down for the badge (never overstates). */
function maxSavingsPct() {
  return Math.max(...Object.keys(PRICES).map((p) => Math.floor(yearlySavings(p).pct)));
}

function usd(n) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * Serializable catalog for GET /api/plans and any UI. Limits are read live
 * from PLAN_LIMITS — this function cannot disagree with enforcement.
 */
function publicCatalog() {
  const plans = Object.keys(PRICES).map((key) => {
    const limits = PLAN_LIMITS[key];
    const savings = yearlySavings(key);
    return {
      plan: key,
      label: limits.label,
      note: PLAN_META[key].note,
      jobs: PLAN_META[key].jobs,
      badge: PLAN_META[key].badge || null,
      price: {
        monthly: PRICES[key].monthly,
        yearly: PRICES[key].yearly,
        display: { monthly: usd(PRICES[key].monthly), yearly: usd(PRICES[key].yearly) },
      },
      stripe_env: STRIPE_ENV[key],
      workspaces: limits.workspaces,
      ai_actions: limits.ai_actions,
      launch_kits: limits.launch_kits,
      can_export: limits.can_export,
      yearly_savings: { amount: savings.amount, display: usd(savings.amount), pct: savings.pct },
    };
  });

  const trial = PLAN_LIMITS.trial;
  return {
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
    yearly_badge: `Save up to ${maxSavingsPct()}%`,
    ai_action_definition: AI_ACTION_DEFINITION,
    included_free: INCLUDED_FREE,
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
  AI_ACTION_DEFINITION,
  yearlySavings,
  maxSavingsPct,
  publicCatalog,
  missingStripeEnv,
};
