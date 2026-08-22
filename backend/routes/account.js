// ---------------------------------------------------------------------------
// Account data controls (audit Prompt 14): self-service export + deletion.
//
//   GET  /api/account/export  → download all of the caller's data as JSON
//   POST /api/account/delete  → cancel billing, wipe data, delete the auth user
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const stripe = require('../lib/stripe');
const { requireAuth } = require('../lib/auth');
const { clearSessionCookies } = require('../lib/session');
const { ensureWorkspace } = require('./workspaces');
const { planFor, findCustomerRow } = require('./customers');
const { ownershipEnforced } = require('../lib/stripe-ownership');
const { limitsFor, usageFor } = require('../lib/plan-limits');
const { collectWorkspaceData, deleteWorkspaceData } = require('../lib/workspace-data');
const { sendLifecycleEmail } = require('../lib/lifecycle-email');
const { track } = require('../lib/analytics');
const { configuredAppUrl } = require('../lib/launch-config');
const { isOwnedScalvyaCustomer } = require('./payments');
const { opsSignal } = require('../lib/ops-signal');

/**
 * XAPP-95-01: the shared customers.stripe_customer_id link is not ownership
 * proof by itself — the same column that checkout must verify (SC-95-01) is also
 * consumed by the billing portal and account deletion. Retrieve the customer and
 * confirm exact Scalvya ownership (source + this user's app_user_id) before any
 * Stripe call. Returns 'owned' | 'foreign' | 'missing' | 'unreadable' so each
 * caller can fail closed appropriately without ever acting on a foreign customer.
 */
async function ownedStripeCustomerStatus(stripeCustomerId, userId) {
  if (!stripeCustomerId) return 'missing';
  let customer;
  try {
    customer = await stripe.customers.retrieve(stripeCustomerId);
  } catch (err) {
    if (err.code === 'resource_missing') return 'missing';
    return 'unreadable';
  }
  return isOwnedScalvyaCustomer(customer, userId) ? 'owned' : 'foreign';
}

/**
 * SV-21-01: clear a stale/foreign stripe_customer_id link, scoped by the SAME
 * canonical key the row was resolved by (app_user_id under enforcement, email
 * before it) so an email change can never clear the wrong row.
 */
async function clearCustomerLink({ userId, email }) {
  const q = supabase.from('customers').update({ stripe_customer_id: null });
  if (ownershipEnforced() && userId) return q.eq('app_user_id', userId);
  return q.eq('email', (email || '').trim().toLowerCase());
}

/** Which interval a stored price id represents, from the env allowlist. */
function intervalForPrice(priceId) {
  if (!priceId) return null;
  for (const key of Object.keys(process.env)) {
    if (process.env[key] === priceId && /_YEARLY$/.test(key)) return 'yearly';
    if (process.env[key] === priceId && /_MONTHLY$/.test(key)) return 'monthly';
  }
  return null;
}

// GET /api/account/billing — current plan, trial/renewal dates, status, usage.
router.get('/api/account/billing', requireAuth, async (req, res, next) => {
  try {
    const email = req.userEmail;
    const plan = (await planFor(email)) || 'free';
    const limits = limitsFor(plan);
    const ws = await ensureWorkspace(email, req.userId);
    const usage = await usageFor(ws.id, plan, email, req.userId);

    let subscription = null;
    // v7 LB-12: whether a fresh checkout would include the 3-day trial. False
    // once any prior trial or active subscription exists, so the paywall can
    // show pay-today copy instead of promising a second trial.
    let trialEligible = false;
    if (plan === 'free') {
      const { hadTrialOrActiveSubscription } = require('./payments');
      trialEligible = !(await hadTrialOrActiveSubscription({ email, userId: req.userId }));
    }
    // SV-21-01: resolve the billing row by canonical identity (app_user_id under
    // enforcement, email before it).
    const customer = await findCustomerRow({ userId: req.userId, email }, 'id');
    if (customer) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id, status, stripe_price_id, current_period_end, trial_end, cancel_at_period_end')
        .eq('customer_id', customer.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_end', { ascending: false })
        .limit(1)
        .single();
      if (sub) {
        subscription = {
          id: sub.stripe_subscription_id,
          status: sub.status,
          interval: intervalForPrice(sub.stripe_price_id),
          current_period_end: sub.current_period_end,
          trial_end: sub.trial_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          // Trial converts / renews here; the exact charge date.
          next_charge_at: sub.status === 'trialing' ? sub.trial_end : sub.current_period_end,
        };
      }
    }

    res.json({
      email,
      plan,
      plan_label: limits.label,
      has_billing: !!customer,
      trial_eligible: trialEligible,
      subscription,
      usage,
      limits: {
        ai_actions: limits.ai_actions === Infinity ? null : limits.ai_actions,
        launch_kits: limits.launch_kits === Infinity ? null : limits.launch_kits,
        monthly: limits.monthly,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/account/billing-portal — Stripe Billing Portal session (invoices,
// card, cancel/reactivate, plan changes) for the signed-in customer.
//
// v13 SC-P0-05: this is the ONE canonical portal endpoint. Identity is
// req.userEmail (never a client-supplied email or customer id) and the return
// URL comes from validated server configuration only — any returnUrl in the
// query or body is ignored, so there is no open redirect to reach.
router.post('/api/account/billing-portal', requireAuth, async (req, res, next) => {
  try {
    let returnUrl;
    try {
      returnUrl = configuredAppUrl('/app/account');
    } catch (err) {
      console.error('[billing-portal] return URL misconfigured:', err.message);
      return res.status(503).json({
        error: 'Billing is temporarily unavailable. Your workspace and drafts are unaffected.',
        code: 'LAUNCH_CONFIG_INCOMPLETE',
        req_id: req.id,
      });
    }
    // SV-21-01: resolve the billing row by canonical identity.
    const customer = await findCustomerRow({ userId: req.userId, email: req.userEmail }, 'stripe_customer_id');
    if (!customer || !customer.stripe_customer_id) {
      return res.status(404).json({ error: 'No billing account yet. Start a plan first.' });
    }

    // XAPP-95-01: never open a portal into a customer we cannot prove is ours.
    const ownership = await ownedStripeCustomerStatus(customer.stripe_customer_id, req.userId);
    if (ownership === 'missing') {
      // Stale id from a test-mode/foreign checkout on the shared Stripe account.
      // Clear it so the next checkout mints a fresh live customer.
      await clearCustomerLink({ userId: req.userId, email: req.userEmail });
      return res.status(404).json({ error: 'No billing account yet. Start a plan first.' });
    }
    if (ownership === 'foreign') {
      // A live customer that is NOT ours (foreign product or wrong user). Do NOT
      // hand the user a portal into it, and do NOT auto-clear a live foreign link.
      opsSignal('ownership_mismatch', { reason: 'billing_portal_foreign_customer', severity: 'high' });
      return res.status(404).json({ error: 'No billing account yet. Start a plan first.' });
    }
    if (ownership === 'unreadable') {
      return res.status(503).json({
        error: 'Billing is temporarily unavailable. Your workspace and drafts are unaffected.',
        code: 'BILLING_UNAVAILABLE', req_id: req.id,
      });
    }

    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: returnUrl,
      });
    } catch (err) {
      if (err.code === 'resource_missing') {
        await clearCustomerLink({ userId: req.userId, email: req.userEmail });
        return res.status(404).json({ error: 'No billing account yet. Start a plan first.' });
      }
      throw err;
    }
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// GET /api/account/export — every owned workspace, not just the active one
// (playbook v6, Prompt 8). Versioned archive shape so future importers can
// tell what they're reading.
router.get('/api/account/export', requireAuth, async (req, res, next) => {
  try {
    const { data: owned } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', req.userId);
    const ownedList = Array.isArray(owned) ? owned : [];
    const workspaces = ownedList.length
      ? ownedList
      : [await ensureWorkspace(req.userEmail, req.userId)];

    const archives = [];
    for (const ws of workspaces) {
      archives.push({ workspace: ws, data: await collectWorkspaceData(ws.id) });
    }

    const payload = {
      export_version: 2,
      exported_at: new Date().toISOString(),
      account: { email: req.userEmail, user_id: req.userId },
      workspace_count: archives.length,
      workspaces: archives,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="scalvya-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});

// POST /api/account/delete — step-tracked deletion with a receipt (playbook
// v6, Prompt 8). Each external side effect records ok/failed instead of being
// swallowed; the response is an honest receipt the user (and support) can act
// on. Idempotent: re-running skips already-deleted resources.
router.post('/api/account/delete', requireAuth, express.json({ limit: '1kb' }), async (req, res, next) => {
  try {
    const email = req.userEmail;
    const userId = req.userId;
    const steps = [];
    const step = (name, status, detail) => steps.push({ name, status, ...(detail ? { detail } : {}) });

    // 1. Cancel any active Stripe subscriptions.
    try {
      // SV-21-01: resolve the billing row by canonical identity.
      const customer = await findCustomerRow({ userId, email }, 'id, stripe_customer_id');
      if (customer && customer.stripe_customer_id) {
        // XAPP-95-01: never LIST or CANCEL subscriptions on a customer we cannot
        // prove is ours — cancelling a foreign product's live subscriptions would
        // be a cross-tenant billing mutation. Verify ownership first; on anything
        // but 'owned', skip the Stripe step and continue deleting local data.
        const ownership = await ownedStripeCustomerStatus(customer.stripe_customer_id, userId);
        if (ownership !== 'owned') {
          if (ownership === 'foreign') opsSignal('ownership_mismatch', { reason: 'account_delete_foreign_customer', severity: 'high' });
          step('stripe_cancellation', ownership === 'missing' ? 'ok' : 'skipped',
            ownership === 'missing' ? 'no live billing account' : 'billing account not verified as owned — not cancelled here');
        } else {
          const subs = await stripe.subscriptions.list({ customer: customer.stripe_customer_id, status: 'all', limit: 100 });
          let canceled = 0;
          let failures = 0;
          for (const sub of subs.data) {
            if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
              try {
                await stripe.subscriptions.cancel(sub.id);
                canceled++;
              } catch {
                failures++;
              }
            }
          }
          if (failures > 0) step('stripe_cancellation', 'failed', `${failures} subscription(s) could not be canceled — contact support`);
          else step('stripe_cancellation', 'ok', canceled ? `${canceled} subscription(s) canceled` : 'no active subscriptions');
        }
      } else {
        step('stripe_cancellation', 'ok', 'no billing account');
      }
    } catch {
      step('stripe_cancellation', 'failed', 'billing lookup failed — cancellation not confirmed');
    }

    // 2. Delete every workspace the user owns and all of its data.
    try {
      const { data: workspaces } = await supabase
        .from('workspaces')
        .select('id')
        .eq('user_id', userId);
      const owned = Array.isArray(workspaces) ? workspaces : (workspaces ? [workspaces] : []);
      let wsFailures = 0;
      for (const ws of owned) {
        try {
          await deleteWorkspaceData(ws.id);
          await supabase.from('workspaces').delete().eq('id', ws.id);
        } catch {
          wsFailures++;
        }
      }
      if (wsFailures > 0) step('workspace_data', 'failed', `${wsFailures} of ${owned.length} workspace(s) could not be fully deleted`);
      else step('workspace_data', 'ok', `${owned.length} workspace(s) deleted`);
    } catch {
      step('workspace_data', 'failed', 'workspace lookup failed');
    }

    // 3. Delete the Supabase Auth user (revokes all sessions).
    try {
      const { error } = await supabase.adminClient().auth.admin.deleteUser(userId);
      if (error) throw error;
      step('auth_user', 'ok');
    } catch (e) {
      const already = /not.*found/i.test(String(e && e.message));
      step('auth_user', already ? 'ok' : 'failed', already ? 'already deleted' : 'sign-in account could not be deleted — contact support');
    }

    // 4. Retained records, stated explicitly (playbook: no silent retention).
    step('retained_records', 'ok', 'Billing/invoice records are retained by Stripe for legal reasons; anonymized analytics events are retained.');

    clearSessionCookies(res);
    track('account_deleted', { userId });

    const failed = steps.filter((s) => s.status === 'failed');
    const receipt = {
      completed: failed.length === 0,
      requested_at: new Date().toISOString(),
      steps,
      ...(failed.length ? { support_note: 'Some steps did not complete. Re-run deletion or contact support with this receipt.' } : {}),
    };

    // Deletion-record email through the outbox (best-effort; the receipt in
    // this response is the source of truth).
    sendLifecycleEmail('deletion_completed', `${userId}:${Date.now()}`, email, {
      completed: receipt.completed,
      failedSteps: failed.map((s) => s.name),
    }).catch(() => {});

    res.json({ ok: failed.length === 0, receipt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
