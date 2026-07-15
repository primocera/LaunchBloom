// ---------------------------------------------------------------------------
// Plan definitions + feature limits (audit Prompt 6).
//
// Metering is a single pool of "AI actions": one successful user-triggered
// generation = one action, regardless of how many rows it produces. Launch kits
// keep an additional sub-cap. Paid plans meter per rolling Stripe billing
// period; trial/free use lifetime totals. The ledger lives in lib/usage.js.
//
// The plan itself comes from routes/customers.js planFor() — Stripe is the
// source of truth; this file only says what each plan may do.
// ---------------------------------------------------------------------------

const { planFor } = require('../routes/customers');
const { requireAuth } = require('./auth');
const usage = require('./usage');
const { track } = require('./analytics');

const PLAN_LIMITS = {
  // Very limited demo. Full generation is gated behind starting the trial.
  free: {
    label: 'Free',
    monthly: false,
    workspaces: 1,
    ai_actions: 0,
    launch_kits: 0,
    content_plan_days: 7,
    can_export: false,
  },
  // 3-day paid trial (Stripe status "trialing"): 20 actions, 1 launch kit.
  trial: {
    label: 'Trial',
    monthly: false, // lifetime totals over the 3-day window
    workspaces: 1,
    ai_actions: 20,
    launch_kits: 1,
    content_plan_days: 30,
    can_export: true,
  },
  starter: {
    label: 'Starter',
    monthly: true,
    workspaces: 1,
    ai_actions: 30,
    launch_kits: 3,
    content_plan_days: 30,
    can_export: true,
  },
  pro: {
    label: 'Pro',
    monthly: true,
    workspaces: 3,
    ai_actions: 120,
    launch_kits: 10,
    content_plan_days: 30,
    can_export: true,
  },
  studio: {
    label: 'Studio',
    monthly: true,
    workspaces: 10,
    ai_actions: 400,
    launch_kits: 30,
    content_plan_days: 30,
    can_export: true,
  },
};

// Old accounts / data may still resolve to "business"; treat it as studio.
const PLAN_ALIASES = { business: 'studio' };

function limitsFor(plan) {
  return PLAN_LIMITS[PLAN_ALIASES[plan] || plan] || PLAN_LIMITS.free;
}

/**
 * Usage snapshot for the account page / upgrade prompts:
 *   { ai_actions: <used>, launch_kits: <used> }
 * Counted from the usage_events ledger within the plan's billing window.
 */
async function usageFor(workspaceId, plan, email, userId) {
  const since = await usage.windowStart(email, plan);
  // Account-wide pool when we have a user id; else fall back to the workspace.
  const [actions, kits] = userId
    ? await Promise.all([
        usage.countUserActions(userId, since, null),
        usage.countUserActions(userId, since, 'launch_kits'),
      ])
    : await Promise.all([
        usage.countActions(workspaceId, since, null),
        usage.countActions(workspaceId, since, 'launch_kits'),
      ]);
  return { ai_actions: actions, launch_kits: kits };
}

// Which plan a user should upgrade to when they hit a wall on their current one.
const NEXT_PLAN = { free: 'Trial', trial: 'Starter', starter: 'Pro', pro: 'Studio', studio: 'Studio' };

function upgradeMessage(plan, feature) {
  const limits = limitsFor(plan);
  const upgradeTo = NEXT_PLAN[PLAN_ALIASES[plan] || plan] || 'Pro';
  const perPeriod = limits.monthly ? "this month's" : 'your';
  const label = feature === 'launch_kits' ? 'launch kit' : 'AI action';
  if (plan === 'free') return `Start your free trial to generate.`;
  return `You've hit ${perPeriod} ${label} limit on ${limits.label}. Upgrade to ${upgradeTo} for more.`;
}

/**
 * Express middleware factory. Authenticates, resolves the plan + workspace, and
 * meters the request against the AI-action pool (plus the launch-kit sub-cap).
 * It RESERVES an action before the route runs and, via a response hook,
 * finalizes it on success or releases it on failure — so failed generations
 * never consume quota. Pass feature=null to authenticate without metering.
 */
function planGate(feature) {
  return function (req, res, next) {
    requireAuth(req, res, async () => {
      try {
        const plan = (await planFor(req.userEmail)) || 'free';
        const limits = limitsFor(plan);
        req.userPlan = plan;
        req.planLimits = limits;

        const { resolveWorkspace } = require('../routes/workspaces');
        const ws = await resolveWorkspace(req);
        req.workspace = ws;

        if (!feature) return next();

        const since = await usage.windowStart(req.userEmail, plan);

        // Launch-kit sub-cap — account-wide (counts reserved + succeeded).
        if (feature === 'launch_kits') {
          const kitsUsed = await usage.countUserActions(req.userId, since, 'launch_kits');
          if (kitsUsed >= limits.launch_kits) {
            track('limit_reached', { userId: req.userId, workspaceId: ws.id, properties: { plan, feature: 'launch_kits' } });
            return res.status(402).json(gateBody(plan, 'launch_kits', kitsUsed, limits.launch_kits));
          }
        }

        // AI-action pool — account-wide across the user's workspaces.
        const poolLimit = limits.ai_actions;
        if (poolLimit !== Infinity) {
          const used = await usage.countUserActions(req.userId, since, null);
          if (used >= poolLimit) {
            track('limit_reached', { userId: req.userId, workspaceId: ws.id, properties: { plan, feature } });
            return res.status(402).json(gateBody(plan, feature, used, poolLimit));
          }
        }

        // Reserve, then re-verify (concurrency: err toward rejecting, not over-allowing).
        const reservationId = await usage.reserveAction({
          userId: req.userId,
          workspaceId: ws.id,
          feature,
          model: process.env.ANTHROPIC_MODEL || null,
        });

        if (poolLimit !== Infinity && reservationId) {
          const after = await usage.countUserActions(req.userId, since, null);
          if (after > poolLimit) {
            await usage.releaseAction(reservationId);
            return res.status(402).json(gateBody(plan, feature, poolLimit, poolLimit));
          }
        }

        req.usageEventId = reservationId;

        // Finalize on success, release on failure — exactly once.
        let settled = false;
        res.on('finish', () => {
          if (settled) return;
          settled = true;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            usage.finalizeAction(reservationId, req.usageInfo || {}).catch(() => {});
            track('generation_success', { userId: req.userId, workspaceId: ws.id, properties: { feature, plan } });
          } else {
            usage.releaseAction(reservationId, res.statusCode >= 500).catch(() => {});
            track('generation_failed', { userId: req.userId, workspaceId: ws.id, properties: { feature, plan, status: res.statusCode } });
          }
        });

        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

function gateBody(plan, feature, used, limit) {
  return {
    error: upgradeMessage(plan, feature),
    code: 'UPGRADE',
    feature,
    used,
    limit,
    plan,
  };
}

module.exports = {
  PLAN_LIMITS,
  limitsFor,
  usageFor,
  planGate,
};
