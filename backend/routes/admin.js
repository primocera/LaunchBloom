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

// Audit every admin view (Prompt 18): who looked, what at, when. Best-effort —
// never blocks the read. Admin endpoints stay read-only; a recovery action, if
// ever added, must be its own separately-audited endpoint.
async function audit(req, action, target = null) {
  try {
    await supabase.from('admin_audit').insert({
      admin_email: (req.userEmail || '').toLowerCase(),
      action,
      target: target || null,
    });
  } catch (err) {
    console.error('[admin] audit failed', action, err.message);
  }
}

// Look up one account by email for support: plan state + usage, no content.
router.get('/api/admin/user', requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email query param required' });
  await audit(req, 'user_lookup', email);

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
    await audit(req, 'health');
    res.json({
      window: '24h',
      webhook_failures: webhookFails.count || 0,
      failed_generations: genFails.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Health lookup failed', req_id: req.id });
  }
});

// Recent failed generations (released usage) — read-only, no content.
router.get('/api/admin/failed-generations', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'failed_generations');
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase.from('usage_events')
      .select('workspace_id, feature, status, created_at')
      .eq('status', 'released').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(100);
    res.json({ window: '7d', items: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', req_id: req.id });
  }
});

// Stuck usage reservations: still 'reserved' well past a normal generation.
router.get('/api/admin/stuck-reservations', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'stuck_reservations');
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min
    const { data } = await supabase.from('usage_events')
      .select('id, workspace_id, feature, status, created_at')
      .eq('status', 'reserved').lt('created_at', cutoff)
      .order('created_at', { ascending: true }).limit(100);
    res.json({ older_than: '15m', items: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', req_id: req.id });
  }
});

// ── Weekly beta scorecard (Prompt 18) ───────────────────────────────────────
// Each metric ships its definition so numbers are never ambiguous. Read-only,
// derived from the analytics ledger + subscriptions; no customer content.
const SCORECARD_DEFINITIONS = {
  acquisition: 'Distinct users who fired signup_started in the window.',
  activation: 'Verified account + minimum Brand Profile + first saved generation (see ACTIVATION).',
  time_to_first_value: 'Median time from signup_completed to first_asset_saved.',
  trial_conversion: 'trial_started that became subscription_activated in the window.',
  retention: 'Activated users with any event in the last 7 days.',
  generation_success: 'succeeded / (succeeded + released) usage_events.',
  cost_per_action: 'Reported separately from the AI cost ledger; not fabricated here.',
  cancellation_reasons: 'Grouped reasons from subscription_canceled feedback.',
};

router.get('/api/admin/scorecard', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'scorecard');
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const count = async (event) => {
      const { count: c } = await supabase.from('analytics_events')
        .select('id', { count: 'exact', head: true })
        .eq('event', event).gte('created_at', since);
      return c || 0;
    };
    const [succeeded, released] = await Promise.all([
      supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('status', 'succeeded').gte('created_at', since),
      supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('status', 'released').gte('created_at', since),
    ]);
    const s = succeeded.count || 0;
    const r = released.count || 0;
    res.json({
      window: '7d',
      definitions: SCORECARD_DEFINITIONS,
      metrics: {
        acquisition: await count('signup_started'),
        trials_started: await count('trial_started'),
        subscriptions_activated: await count('subscription_activated'),
        first_generations: await count('first_generation'),
        first_assets_saved: await count('first_asset_saved'),
        limit_reached: await count('limit_reached'),
        generation_success_rate: s + r > 0 ? Math.round((s / (s + r)) * 100) : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Scorecard failed', req_id: req.id });
  }
});

module.exports = router;
