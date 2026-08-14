#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v18 S05 — pull-based webhook reconciliation. READ-ONLY BY DEFAULT.
//
// Detects the failure a mirror-only reconciler cannot see: a Stripe
// subscription whose create/update webhook was never delivered (or arrived out
// of order), so the local `subscriptions` mirror is missing or stale. It pulls
// the truth from Stripe, keeps only OUR subscriptions (the exact ownership rule
// from webhooks.js, so a peer product on the shared account is never adopted),
// and reason-codes every gap:
//
//   missing_local   in Stripe, no local row  (missed create webhook)
//   status_drift    local status != Stripe   (missed update webhook)
//
// Guarantees:
//   * default mode is read-only — it LISTs from Stripe and SELECTs locally, no writes
//   * ownership is decided by webhooks.isOurSubscription — no second rule
//   * repair reuses webhooks.subscriptionMirrorRow — no second mirror shape / billing truth
//   * repair upsert is idempotent (onConflict) and never fabricates entitlement
//   * repair deliberately does NOT send lifecycle email — reconciliation is a
//     data-sync operation, not a customer-facing event replay
//   * no raw email in output; missing env exits 2 (BLOCKED), never a green 0
//
// Usage:
//   node backend/scripts/reconcile-stripe-webhooks.js            # dry-run report
//   node backend/scripts/reconcile-stripe-webhooks.js --json     # machine output
//   node backend/scripts/reconcile-stripe-webhooks.js --apply    # repair (owner-gated)
//
// --apply refuses unless RECONCILE_OWNER_MODE=1 is set.
// Exit codes: 0 = in sync, 1 = findings (dry-run), 2 = BLOCKED (config).
// ---------------------------------------------------------------------------

require('dotenv').config();

const { diffStripeVsLocal } = require('../lib/webhook-reconcile');
const { isOurSubscription, subscriptionMirrorRow } = require('../routes/webhooks');
const { opsSignal } = require('../lib/ops-signal');

/** Page through every subscription in the account (all statuses). Read-only. */
async function listAllStripeSubscriptions(stripe) {
  const all = [];
  let startingAfter;
  // Bounded loop so a pathological account can't spin forever.
  for (let page = 0; page < 200; page++) {
    const params = { status: 'all', limit: 100, expand: ['data.items'] };
    if (startingAfter) params.starting_after = startingAfter;
    const res = await stripe.subscriptions.list(params);
    const data = res && Array.isArray(res.data) ? res.data : [];
    all.push(...data);
    if (!res.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
  }
  return all;
}

/** Resolve local customer_id for a Stripe customer id (read-only). */
async function localCustomerId(supabase, stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { data } = await supabase
    .from('customers').select('id').eq('stripe_customer_id', stripeCustomerId).single();
  return data ? data.id : null;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const apply = args.includes('--apply');

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('BLOCKED: STRIPE_SECRET_KEY is not set. No Stripe pull was performed.');
    process.exit(2);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. No check was performed.');
    process.exit(2);
  }
  if (apply && process.env.RECONCILE_OWNER_MODE !== '1') {
    console.error('REFUSED: --apply requires RECONCILE_OWNER_MODE=1. Nothing was changed.');
    process.exit(2);
  }

  const stripe = require('../lib/stripe');
  const supabase = require('../lib/supabase');

  const stripeSubs = await listAllStripeSubscriptions(stripe);
  const { data: localRows, error } = await supabase
    .from('subscriptions').select('stripe_subscription_id, status');
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);

  const { findings, counts } = diffStripeVsLocal({
    stripeSubs, localRows: localRows || [], isOwned: isOurSubscription,
  });

  let repaired = 0;
  if (apply && findings.length) {
    const now = new Date().toISOString();
    const byId = new Map(stripeSubs.map((s) => [s.id, s]));
    for (const f of findings) {
      const sub = byId.get(f.subscription_id);
      if (!sub) continue;
      const customerId = await localCustomerId(supabase, sub.customer);
      // Idempotent mirror using the ONE canonical projection. eventAt = now, so
      // a genuinely newer real webhook later still wins the out-of-order guard.
      const { error: upErr } = await supabase.from('subscriptions').upsert(
        subscriptionMirrorRow(sub, customerId, now),
        { onConflict: 'stripe_subscription_id' },
      );
      if (upErr) {
        console.error(`repair failed for ${f.subscription_id}: ${upErr.message}`);
        continue;
      }
      repaired++;
      opsSignal('reconciliation_correction', {
        subscription_id: f.subscription_id, reason: `pull_${f.reason}_repaired`, severity: 'warning',
      });
    }
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    counts,
    findings,
    repaired: apply ? repaired : undefined,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`stripe→local webhook reconciliation — ${report.mode.toUpperCase()}`);
    console.log(`stripe subs: ${counts.total} | ours: ${counts.owned} | foreign skipped: ${counts.foreign_skipped}`);
    console.log(`in sync: ${counts.ok} | missing_local: ${counts.missing_local} | status_drift: ${counts.status_drift}`);
    for (const f of findings) {
      console.log(`  ${f.reason}: ${f.subscription_id}  stripe=${f.stripe_status}  local=${f.local_status ?? 'none'}`);
    }
    if (apply) console.log(`repaired: ${repaired}`);
  }

  // In apply mode, remaining gaps after repair are the exit signal; in dry-run,
  // any finding is a non-zero exit so CI/an operator sees it.
  const remaining = apply ? Math.max(findings.length - repaired, 0) : findings.length;
  process.exit(remaining ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('BLOCKED:', (err && err.message) || err);
    process.exit(2);
  });
}

module.exports = { listAllStripeSubscriptions };
