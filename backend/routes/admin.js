// ---------------------------------------------------------------------------
// Minimal admin support view (audit Prompt 16). Read-only, behind an
// ADMIN_EMAILS allowlist. Never returns customer content — only account
// state (plan, usage counts, subscription status) needed to answer a
// support ticket.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

function requireAdmin(req, res, next) {
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.includes((req.userEmail || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Look up one account by email for support: plan state + usage, no content.
router.get('/api/admin/user', requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email query param required' });

  try {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .limit(1)
      .single();

    let sub = null;
    if (customer) {
      const { data } = await supabase
        .from('subscriptions')
        .select('status, stripe_price_id, current_period_end, cancel_at_period_end, created_at')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(1);
      sub = (data && data[0]) || null;
    }

    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, name, archived, created_at')
      .eq('user_email', email);

    const wsIds = (workspaces || []).map((w) => w.id);
    let usage = [];
    if (wsIds.length) {
      const { data } = await supabase
        .from('usage_events')
        .select('feature, status, created_at')
        .in('workspace_id', wsIds)
        .order('created_at', { ascending: false })
        .limit(50);
      usage = data || [];
    }

    res.json({
      email,
      subscription: sub,
      workspaces: workspaces || [],
      recent_usage: usage,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', req_id: req.id });
  }
});

// Ops overview: recent failures worth alerting on.
router.get('/api/admin/health', requireAuth, requireAdmin, async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [webhookFails, genFails] = await Promise.all([
      supabase.from('stripe_events').select('id', { count: 'exact', head: true })
        .eq('status', 'failed').gte('created_at', since),
      supabase.from('usage_events').select('id', { count: 'exact', head: true })
        .eq('status', 'released').gte('created_at', since),
    ]);
    res.json({
      window: '24h',
      webhook_failures: webhookFails.count || 0,
      failed_generations: genFails.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Health lookup failed', req_id: req.id });
  }
});

module.exports = router;
