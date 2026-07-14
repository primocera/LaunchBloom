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
 * Resolve the start of the metering window for an account.
 * - paid plans: the current subscription period start (rolling), else month.
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
      if (sub && sub.current_period_start) return sub.current_period_start;
    }
  } catch (e) {
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

/** Insert a reserved action; returns its id (or null if the ledger is missing). */
async function reserveAction({ userId, workspaceId, feature, model }) {
  const { data, error } = await supabase
    .from('usage_events')
    .insert({
      user_id: userId || null,
      workspace_id: workspaceId,
      feature,
      action: 'generate',
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

async function finalizeAction(id, info = {}) {
  if (!id) return;
  await supabase
    .from('usage_events')
    .update({
      status: 'succeeded',
      model: info.model || null,
      input_tokens: info.inputTokens ?? null,
      output_tokens: info.outputTokens ?? null,
      estimated_cost: info.estimatedCost ?? null,
    })
    .eq('id', id);
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
  countActions,
  reserveAction,
  finalizeAction,
  releaseAction,
};
