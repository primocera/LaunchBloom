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
const { processEmailOutbox, replayDeadLetter } = require('../lib/lifecycle-email');

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
  signups_completed: 'Distinct users who fired signup_completed in the window.',
  activation: 'signup_completed users whose first_asset_saved happened within 24h of signup. Beta gate: ≥45%.',
  time_to_first_value_minutes: 'Median minutes from signup_completed to first_asset_saved for activated users. Beta gate: ≤15.',
  trial_conversion: 'trial_started users who also fired subscription_activated in the window. Beta gate: ≥20%.',
  d7_retention: 'Signups ≥9 days old with any event on days 5–9 after signup. Beta gate: ≥30%.',
  generation_success: 'succeeded / (succeeded + released) usage_events. Beta gate: ≥97%.',
  limit_reached_users: 'Distinct users who hit a plan limit in the window.',
  cancellation_reasons: 'Grouped redacted reasons from subscription_canceled events.',
  cost_per_action: 'From the ai_spend_ledger table (input/output tokens + estimated USD per day); never fabricated here.',
};

// v6 Prompt 10: computed cohorts — every metric returns numerator,
// denominator, value and the exact date window, so numbers are decision-ready
// and reconcilable to the source tables. Computation happens in JS over the
// windowed event rows (beta-scale volumes; no content is ever read).
function metric(numerator, denominator, unit = 'ratio') {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? +((numerator / denominator) * 100).toFixed(1) : null,
    unit: denominator > 0 ? 'percent' : unit,
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** userId → earliest timestamp of each event type within the window. */
function firstByUser(rows, event) {
  const out = new Map();
  for (const r of rows) {
    if (r.event !== event || !r.user_id) continue;
    const t = new Date(r.created_at).getTime();
    if (!out.has(r.user_id) || t < out.get(r.user_id)) out.set(r.user_id, t);
  }
  return out;
}

router.get('/api/admin/scorecard', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'scorecard');
    const days = Math.min(Number(req.query.days) || 7, 90);
    const sinceMs = Date.now() - days * 24 * 3600 * 1000;
    const since = new Date(sinceMs).toISOString();

    // One windowed pull of the events we compute from (ids + timestamps only).
    const EVENTS = [
      'signup_started', 'signup_completed', 'trial_started', 'subscription_activated',
      'first_generation', 'first_asset_saved', 'limit_reached', 'subscription_canceled',
    ];
    const { data: eventRows } = await supabase
      .from('analytics_events')
      .select('event, user_id, created_at, properties')
      .in('event', EVENTS)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(10000);
    const rows = Array.isArray(eventRows) ? eventRows : [];

    const distinct = (event) => firstByUser(rows, event).size;

    // Activation: verified signup that saved a first asset within 24h of signup.
    const signups = firstByUser(rows, 'signup_completed');
    const firstSaves = firstByUser(rows, 'first_asset_saved');
    let activated = 0;
    const ttfvMinutes = [];
    for (const [userId, signupAt] of signups) {
      const savedAt = firstSaves.get(userId);
      if (savedAt != null && savedAt - signupAt <= 24 * 3600 * 1000) {
        activated++;
        ttfvMinutes.push(Math.max(0, (savedAt - signupAt) / 60000));
      }
    }

    // D7 retention: users who signed up 7+ days into the past edge of the
    // window and had any event on days 5–9 after signup.
    let d7Eligible = 0;
    let d7Retained = 0;
    for (const [userId, signupAt] of signups) {
      if (Date.now() - signupAt < 9 * 24 * 3600 * 1000) continue; // window not elapsed
      d7Eligible++;
      const retained = rows.some((r) => {
        if (r.user_id !== userId) return false;
        const dt = (new Date(r.created_at).getTime() - signupAt) / (24 * 3600 * 1000);
        return dt >= 5 && dt <= 9;
      });
      if (retained) d7Retained++;
    }

    // Trial → paid within the window.
    const trials = firstByUser(rows, 'trial_started');
    const paid = firstByUser(rows, 'subscription_activated');
    let converted = 0;
    for (const userId of trials.keys()) if (paid.has(userId)) converted++;

    // Generation success from the usage ledger.
    const [succeeded, released] = await Promise.all([
      supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('status', 'succeeded').gte('created_at', since),
      supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('status', 'released').gte('created_at', since),
    ]);
    const s = succeeded.count || 0;
    const r = released.count || 0;

    // Cancellation reasons (redacted properties only).
    const cancelReasons = {};
    for (const row of rows) {
      if (row.event !== 'subscription_canceled') continue;
      const reason = (row.properties && row.properties.reason) || 'unspecified';
      cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
    }

    res.json({
      window: { days, since, until: new Date().toISOString() },
      definitions: SCORECARD_DEFINITIONS,
      metrics: {
        acquisition: { numerator: distinct('signup_started'), denominator: null, value: distinct('signup_started'), unit: 'users' },
        signups_completed: { numerator: signups.size, denominator: null, value: signups.size, unit: 'users' },
        activation: metric(activated, signups.size),
        time_to_first_value_minutes: { numerator: activated, denominator: null, value: median(ttfvMinutes) != null ? +median(ttfvMinutes).toFixed(1) : null, unit: 'median_minutes' },
        trial_conversion: metric(converted, trials.size),
        d7_retention: metric(d7Retained, d7Eligible),
        generation_success: metric(s, s + r),
        limit_reached_users: { numerator: distinct('limit_reached'), denominator: null, value: distinct('limit_reached'), unit: 'users' },
        cancellation_reasons: cancelReasons,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Scorecard failed', req_id: req.id });
  }
});

// ── Email outbox (playbook v6, Prompt 6) ────────────────────────────────────

// Dead letters and failing emails, so delivery problems are visible.
router.get('/api/admin/email-outbox', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'email_outbox_view');
    const { data } = await supabase.from('email_events')
      .select('id, email_type, recipient, status, attempts, next_attempt_at, last_error, created_at')
      .in('status', ['failed', 'dead_letter', 'pending'])
      .order('created_at', { ascending: false })
      .limit(100);
    res.json({ items: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', req_id: req.id });
  }
});

// Run one outbox pass now (also reachable via the cron endpoint below).
router.post('/api/admin/email-outbox/process', requireAuth, requireAdmin, async (req, res) => {
  await audit(req, 'email_outbox_process');
  res.json(await processEmailOutbox({ limit: 50 }));
});

// Put a dead-letter row back in the queue.
router.post('/api/admin/email-outbox/replay/:id', requireAuth, requireAdmin, async (req, res) => {
  await audit(req, 'email_outbox_replay', req.params.id);
  const ok = await replayDeadLetter(req.params.id);
  if (!ok) return res.status(404).json({ error: 'No dead-letter row with that id' });
  res.json({ ok: true });
});

// Cron entry point (Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`).
// No session — authenticated by the shared secret only.
router.get('/api/cron/email-outbox', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.get('authorization') || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(await processEmailOutbox({ limit: 50 }));
});

module.exports = router;
