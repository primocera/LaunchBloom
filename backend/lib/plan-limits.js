// ---------------------------------------------------------------------------
// Prompt 25 + Upgrade Prompt 4: plan definitions and feature limits.
//
// Monetization is a 3-day paid Stripe trial → starter | pro | studio. The
// `trial` and `free` plans use lifetime totals (monthly: false); paid plans
// reset monthly (rows created since the start of the current calendar month).
// The plan itself comes from routes/customers.js planFor() — Stripe is the
// source of truth; this file only says what each plan may do.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const { planFor } = require('../routes/customers');
const { requireAuth } = require('./auth');

const PLAN_LIMITS = {
  // Very limited demo for unauthenticated/public sample mode and old accounts.
  // Full launch kits are gated behind starting the trial.
  free: {
    label: 'Free',
    monthly: false, // lifetime totals
    workspaces: 1,
    positioning: 1,
    offer_generations: 1,
    launch_kits: 0, // 0 full kits unless a trial is started
    asset_generations: 0,
    content_plan_days: 7,
    can_export: false,
  },
  // 3-day free trial (Stripe status "trialing"). Treated like starter but with
  // hard lifetime caps of 1 full kit and 20 asset generations.
  trial: {
    label: 'Trial',
    monthly: false, // lifetime totals over the 3-day window
    workspaces: 1,
    positioning: 10,
    offer_generations: 5,
    launch_kits: 1,
    asset_generations: 20,
    content_plan_days: 30,
    can_export: true,
  },
  starter: {
    label: 'Starter',
    monthly: true,
    workspaces: 1,
    positioning: 10,
    offer_generations: 5,
    launch_kits: 3,
    asset_generations: 25,
    content_plan_days: 30,
    can_export: true,
  },
  pro: {
    label: 'Pro',
    monthly: true,
    workspaces: 3,
    positioning: Infinity, // unlimited within fair-use rate limits
    offer_generations: Infinity,
    launch_kits: 10,
    asset_generations: 100,
    content_plan_days: 30,
    can_export: true,
  },
  studio: {
    label: 'Studio',
    monthly: true,
    workspaces: 10,
    positioning: Infinity,
    offer_generations: Infinity,
    launch_kits: 30,
    asset_generations: 300,
    content_plan_days: 30,
    can_export: true,
  },
};

// Old accounts / data may still resolve to "business"; treat it as studio.
const PLAN_ALIASES = { business: 'studio' };

function limitsFor(plan) {
  return PLAN_LIMITS[PLAN_ALIASES[plan] || plan] || PLAN_LIMITS.free;
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Count rows in `table` for a workspace — this month for paid, lifetime otherwise. */
async function countUsage(table, workspaceId, monthly) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (monthly) q = q.gte('created_at', monthStart());
  const { count, error } = await q;
  // A missing table (migration not applied yet) counts as zero usage rather
  // than blowing up the gate.
  if (error) return 0;
  return count || 0;
}

// Marketing-asset tables (upgrade migration 004). One generated row = one
// "asset generation" for limit purposes; all five tables share the same key.
const ASSET_TABLES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];

/** Total marketing-asset rows across all asset tables for a workspace. */
async function countAssetGenerations(workspaceId, monthly) {
  const counts = await Promise.all(ASSET_TABLES.map((t) => countUsage(t, workspaceId, monthly)));
  return counts.reduce((a, b) => a + b, 0);
}

/** Usage snapshot for the account page / upgrade prompts. */
async function usageFor(workspaceId, plan) {
  const { monthly } = limitsFor(plan);
  const [positioning, offers, kits, assets] = await Promise.all([
    countUsage('positioning_outputs', workspaceId, monthly),
    countUsage('offers', workspaceId, monthly),
    countUsage('launch_kits', workspaceId, monthly),
    countAssetGenerations(workspaceId, monthly),
  ]);
  return {
    positioning,
    offer_generations: Math.ceil(offers / 3),
    launch_kits: kits,
    asset_generations: assets,
  };
}

const FEATURE_TABLE = {
  positioning: 'positioning_outputs',
  offer_generations: 'offers',
  launch_kits: 'launch_kits',
};

/**
 * canGenerate('launch_kits', plan, workspaceId) → { ok, used, limit, plan }
 * offer_generations counts 3 offer rows as one generation.
 * asset_generations sums rows across all marketing-asset tables.
 */
async function canGenerate(feature, plan, workspaceId) {
  const limits = limitsFor(plan);
  const limit = limits[feature];
  if (limit === Infinity) return { ok: true, used: null, limit: null, plan };

  let used;
  if (feature === 'asset_generations') {
    used = await countAssetGenerations(workspaceId, limits.monthly);
  } else {
    used = await countUsage(FEATURE_TABLE[feature], workspaceId, limits.monthly);
    if (feature === 'offer_generations') used = Math.ceil(used / 3);
  }
  return { ok: used < limit, used, limit, plan };
}

async function canCreateWorkspace(plan, currentCount) {
  return currentCount < limitsFor(plan).workspaces;
}

// Which plan a user should upgrade to when they hit a wall on their current one.
const NEXT_PLAN = { free: 'Trial', trial: 'Starter', starter: 'Pro', pro: 'Studio', studio: 'Studio' };

/**
 * Express middleware factory: authenticates, resolves the plan, and enforces
 * the feature limit against the caller's workspace. Attaches req.userPlan
 * and req.planLimits. 402 + code UPGRADE when the limit is hit.
 */
function planGate(feature) {
  return function (req, res, next) {
    requireAuth(req, res, async () => {
      try {
        const plan = (await planFor(req.userEmail)) || 'free';
        req.userPlan = plan;
        req.planLimits = limitsFor(plan);

        // Resolve the caller's workspace (same get-or-create as workspaces.js)
        const { ensureWorkspace } = require('../routes/workspaces');
        const ws = await ensureWorkspace(req.userEmail, req.userId);
        req.workspace = ws;

        if (feature) {
          const check = await canGenerate(feature, plan, ws.id);
          if (!check.ok) {
            const featureLabel = feature.replace(/_/g, ' ');
            const upgradeTo = NEXT_PLAN[PLAN_ALIASES[plan] || plan] || 'Pro';
            const perPeriod = limitsFor(plan).monthly ? "this month's" : 'your';
            return res.status(402).json({
              error:
                plan === 'free'
                  ? `Start your free trial to generate ${featureLabel}.`
                  : `You've hit ${perPeriod} ${featureLabel} limit on ${limitsFor(plan).label}. Upgrade to ${upgradeTo} for more.`,
              code: 'UPGRADE',
              feature,
              used: check.used,
              limit: check.limit,
              plan,
            });
          }
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

module.exports = {
  PLAN_LIMITS,
  limitsFor,
  usageFor,
  canGenerate,
  canCreateWorkspace,
  countAssetGenerations,
  planGate,
};
