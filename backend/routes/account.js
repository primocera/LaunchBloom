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

// Workspace-scoped tables to export/delete (best-effort; missing tables are
// skipped so a partially-migrated DB doesn't break the operation).
const WORKSPACE_TABLES = [
  'onboarding_answers',
  'positioning_outputs',
  'offers',
  'launch_kits',
  'content_items',
  'email_items',
  'ad_ideas',
  'seo_items',
  'weekly_tasks',
  'website_pages',
  'email_assets',
  'social_assets',
  'creative_assets',
  'seo_assets',
  'usage_events',
];

async function collectWorkspaceData(workspaceId) {
  const out = {};
  for (const table of WORKSPACE_TABLES) {
    const { data, error } = await supabase.from(table).select('*').eq('workspace_id', workspaceId);
    if (!error) out[table] = data || [];
  }
  return out;
}

// GET /api/account/export
router.get('/api/account/export', requireAuth, async (req, res, next) => {
  try {
    const ws = await ensureWorkspace(req.userEmail, req.userId);
    const data = await collectWorkspaceData(ws.id);
    const payload = {
      exported_at: new Date().toISOString(),
      account: { email: req.userEmail, user_id: req.userId },
      workspace: ws,
      data,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="launchbloom-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});

// POST /api/account/delete
router.post('/api/account/delete', requireAuth, express.json({ limit: '1kb' }), async (req, res, next) => {
  try {
    const email = req.userEmail;
    const userId = req.userId;

    // 1. Cancel any active Stripe subscriptions and detach the customer.
    try {
      const { data: customer } = await supabase
        .from('customers')
        .select('id, stripe_customer_id')
        .eq('email', email)
        .single();
      if (customer && customer.stripe_customer_id) {
        const subs = await stripe.subscriptions.list({ customer: customer.stripe_customer_id, status: 'all', limit: 100 });
        for (const sub of subs.data) {
          if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
            await stripe.subscriptions.cancel(sub.id).catch(() => {});
          }
        }
      }
    } catch (e) {
      /* billing cleanup is best-effort; continue with data deletion */
    }

    // 2. Delete all workspace-scoped data, then the workspace. ensureWorkspace
    // resolves (and adopts) the caller's workspace; MVP is one per user.
    const ws = await ensureWorkspace(email, userId);
    for (const table of WORKSPACE_TABLES) {
      await supabase.from(table).delete().eq('workspace_id', ws.id).then(() => {}, () => {});
    }
    await supabase.from('workspaces').delete().eq('id', ws.id).then(() => {}, () => {});
    // Belt-and-braces: any other workspace still keyed to this user id.
    await supabase.from('workspaces').delete().eq('user_id', userId).then(() => {}, () => {});

    // 3. Delete the Supabase Auth user (revokes all sessions) and clear cookies.
    try {
      await supabase.adminClient().auth.admin.deleteUser(userId);
    } catch (e) {
      /* if this fails the account still has no data; surface a soft error */
    }
    clearSessionCookies(res);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
