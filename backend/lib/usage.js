// ---------------------------------------------------------------------------
// Usage metering ledger (audit Prompt 6).
//
// One successful user-triggered generation = one AI action. Callers reserve an
// action before the expensive AI call, then finalize it on success or release
// it on failure. Counting includes 'reserved' + 'succeeded' rows so concurrent
// requests can't exceed the limit; 'released'/'failed' rows don't count.
//
// Billing window: paid plans meter per rolling Stripe billing period; trial and
// free plans use lifetime totals.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const supabase = require('./supabase');

const COUNTED_STATUSES = ['reserved', 'succeeded'];

/** UTC start of the current calendar month (fallback window for paid plans). */
function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * The latest monthly anniversary of `periodStart` that is not in the future.
 * Plan allowances are MONTHLY ("120 AI actions / month") on both intervals, but
 * a yearly subscription's Stripe period is the whole year - metering from its
 * start would hand a yearly buyer one month's allowance for twelve months. For
 * a monthly subscription the anniversary is the period start itself. The day
 * of month is clamped (Jan 31 → Feb 28), matching how Stripe bills.
 */
/** `start` moved `monthsAhead` calendar months, day of month clamped. */
function addMonthsClamped(start, monthsAhead) {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + monthsAhead;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
}

function monthlyWindowStart(periodStart, now = new Date()) {
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime()) || start > now) return periodStart;
  let months = 0;
  while (addMonthsClamped(start, months + 1) <= now) months++;
  return months === 0 ? periodStart : addMonthsClamped(start, months).toISOString();
}

/** When a monthly window that began at `since` resets (null for lifetime). */
function windowResetsAt(since) {
  if (!since) return null;
  const start = new Date(since);
  if (Number.isNaN(start.getTime())) return null;
  return addMonthsClamped(start, 1).toISOString();
}

/**
 * Resolve the start of the metering window for an account.
 * - paid plans: the current monthly cycle inside the subscription period
 *   (rolling from the billing date), else the calendar month.
 * - trial/free: null → lifetime totals.
 */
async function windowStart(email, plan) {
  if (plan === 'trial' || plan === 'free' || !plan) return null;
  try {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', (email || '').toLowerCase())
      .single();
    if (customer) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('current_period_start')
        .eq('customer_id', customer.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_start', { ascending: false })
        .limit(1)
        .single();
      if (sub && sub.current_period_start) return monthlyWindowStart(sub.current_period_start);
    }
  } catch {
    /* fall through to calendar month */
  }
  return monthStart();
}

/** Count metered actions for a workspace since `since` (null = lifetime). */
async function countActions(workspaceId, since, feature) {
  let q = supabase
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', COUNTED_STATUSES);
  if (feature) q = q.eq('feature', feature);
  if (since) q = q.gte('created_at', since);
  const { count, error } = await q;
  if (error) return 0; // missing table (migration not applied) fails open to 0
  return count || 0;
}

/**
 * Count metered actions across ALL of a user's workspaces since `since`. The
 * AI-action pool is account-wide (a Pro user's 120 actions are shared across
 * their 3 workspaces, not 120 each), so limits count by user_id.
 */
async function countUserActions(userId, since, feature) {
  let q = supabase
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', COUNTED_STATUSES);
  if (feature) q = q.eq('feature', feature);
  if (since) q = q.gte('created_at', since);
  const { count, error } = await q;
  if (error) return 0;
  return count || 0;
}

/** Insert a reserved action; returns its id (or null if the ledger is missing). */
async function reserveAction({ userId, workspaceId, feature, model, action }) {
  const { data, error } = await supabase
    .from('usage_events')
    .insert({
      user_id: userId || null,
      workspace_id: workspaceId,
      feature,
      action: action || 'generate',
      request_id: crypto.randomUUID(),
      units: 1,
      model: model || null,
      status: 'reserved',
    })
    .select('id')
    .single();
  if (error) return null;
  return data.id;
}

// Accepts either camelCase or the generateJson `__meta` (snake_case) shape.
async function finalizeAction(id, info = {}) {
  if (!id) return;
  const patch = { status: 'succeeded' };
  const model = info.model;
  const inTok = info.input_tokens ?? info.inputTokens;
  const outTok = info.output_tokens ?? info.outputTokens;
  const cost = info.estimated_cost ?? info.estimatedCost;
  if (model != null) patch.model = model;
  if (inTok != null) patch.input_tokens = inTok;
  if (outTok != null) patch.output_tokens = outTok;
  if (cost != null) patch.estimated_cost = cost;
  await supabase.from('usage_events').update(patch).eq('id', id);
}

/** Release a reservation so it no longer counts (failed / aborted generation). */
async function releaseAction(id, failed = false) {
  if (!id) return;
  await supabase
    .from('usage_events')
    .update({ status: failed ? 'failed' : 'released' })
    .eq('id', id);
}

module.exports = {
  windowStart,
  monthlyWindowStart,
  windowResetsAt,
  countActions,
  countUserActions,
  reserveAction,
  finalizeAction,
  releaseAction,
};
