// ---------------------------------------------------------------------------
// Prompt 25: plan definitions and feature limits.
//
// Free limits are lifetime totals; paid limits reset monthly (counted from
// rows created since the start of the current calendar month). The plan
// itself comes from routes/customers.js planFor() — Stripe is the source
// of truth, this file only says what each plan may do.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const { planFor } = require('../routes/customers');
const { requireAuth } = require('./auth');

const PLAN_LIMITS = {
  free: {
    label: 'Free',
    monthly: false, // limits are lifetime totals
    workspaces: 1,
    positioning: 1,
    offer_generations: 1,
    launch_kits: 1, // one "limited" kit:
    content_plan_days: 7, //   7-day content plan
    can_export: false, //   no full kit export
  },
  starter: {
    label: 'Starter',
    monthly: true,
    workspaces: 1,
    positioning: 10,
    offer_generations: 3,
    launch_kits: 1,
    content_plan_days: 30,
    can_export: true,
  },
  pro: {
    label: 'Pro',
    monthly: true,
    workspaces: 3,
    positioning: Infinity,
    offer_generations: Infinity, // "unlimited within fair use" — rate limits apply
    launch_kits: 5,
    content_plan_days: 30,
    can_export: true,
  },
  business: {
    label: 'Business',
    monthly: true,
    workspaces: 10,
    positioning: Infinity,
    offer_generations: Infinity,
    launch_kits: 15,
    content_plan_days: 30,
    can_export: true,
  },
};

function limitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Count rows in `table` for a workspace — this month for paid, lifetime for free. */
async function countUsage(table, workspaceId, monthly) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (monthly) q = q.gte('created_at', monthStart());
  const { count } = await q;
  return count || 0;
}

/** Usage snapshot for the account page / upgrade prompts. */
async function usageFor(workspaceId, plan) {
  const { monthly } = limitsFor(plan);
  const [positioning, offers, kits] = await Promise.all([
    countUsage('positioning_outputs', workspaceId, monthly),
    countUsage('offers', workspaceId, monthly),
    countUsage('launch_kits', workspaceId, monthly),
  ]);
  return { positioning, offer_generations: Math.ceil(offers / 3), launch_kits: kits };
}

const FEATURE_TABLE = {
  positioning: 'positioning_outputs',
  offer_generations: 'offers',
  launch_kits: 'launch_kits',
};

/**
 * canGenerate('launch_kits', plan, workspaceId) → { ok, used, limit, plan }
 * offer_generations counts 3 offer rows as one generation.
 */
async function canGenerate(feature, plan, workspaceId) {
  const limits = limitsFor(plan);
  const limit = limits[feature];
  if (limit === Infinity) return { ok: true, used: null, limit: null, plan };
  let used = await countUsage(FEATURE_TABLE[feature], workspaceId, limits.monthly);
  if (feature === 'offer_generations') used = Math.ceil(used / 3);
  return { ok: used < limit, used, limit, plan };
}

async function canCreateWorkspace(plan, currentCount) {
  return currentCount < limitsFor(plan).workspaces;
}

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
        const ws = await ensureWorkspace(req.userEmail);
        req.workspace = ws;

        if (feature) {
          const check = await canGenerate(feature, plan, ws.id);
          if (!check.ok) {
            const upgradeTo = plan === 'free' ? 'Starter' : plan === 'starter' ? 'Pro' : 'Business';
            return res.status(402).json({
              error:
                plan === 'free'
                  ? `You've used your free ${feature.replace(/_/g, ' ')} allowance. Upgrade to keep going.`
                  : `You've hit this month's ${feature.replace(/_/g, ' ')} limit on ${limitsFor(plan).label}. Upgrade to ${upgradeTo} for more.`,
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
  planGate,
};
