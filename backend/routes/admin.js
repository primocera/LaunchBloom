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
  } catch {
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
  } catch {
    res.status(500).json({ error: 'Health lookup failed', req_id: req.id });
  }
});

// v9 SC-10: production readiness — one secret-safe report combining the
// deterministic release-check config gates (presence booleans only, reused so
// there is no second source of truth) with live operational signals: outbox
// backlog, webhook failures and AI spend. No secret values, no customer content
// (no emails, campaign/asset text, evidence URLs or payment details).
router.get('/api/admin/readiness', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { collect } = require('../scripts/release-check');
    const { mode, checks } = collect();
    const blockers = checks.filter((c) => !c.ok && c.level === 'blocker');
    const external = checks.filter((c) => !c.ok && c.level === 'external');

    // Live signals — counts only, each defended so a missing table degrades
    // to null rather than failing the whole readiness report.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const reservationCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const countOf = async (fn) => { try { const { count } = await fn(); return count || 0; } catch { return null; } };
    const [outboxBacklog, webhookFailures, reservationLeakage, spendRows] = await Promise.all([
      countOf(() => supabase.from('email_outbox').select('id', { count: 'exact', head: true }).neq('status', 'sent')),
      countOf(() => supabase.from('stripe_events').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since)),
      // Reservation leakage: AI-spend reservations still 'reserved' well past a
      // normal generation — a leak means the daily brake is being consumed by
      // calls that never finalized or released.
      countOf(() => supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('status', 'reserved').lt('created_at', reservationCutoff)),
      supabase.from('ai_spend_ledger').select('amount_usd').gte('created_at', since).then((r) => r.data || [], () => []),
    ]);
    const spend24h = Array.isArray(spendRows)
      ? Math.round(spendRows.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0) * 100) / 100
      : null;
    const ceiling = Number(process.env.AI_SPEND_DAILY_CEILING_USD || 0) || null;

    const live = {
      outbox_backlog: outboxBacklog,
      webhook_failures_24h: webhookFailures,
      reservation_leakage: reservationLeakage,
      ai_spend_24h_usd: spend24h,
      ai_spend_ceiling_usd: ceiling,
      spend_over_ceiling: ceiling != null && spend24h != null ? spend24h > ceiling : null,
    };
    // Classify the raw counts into ok/warn/stop against explicit thresholds so a
    // reader (or a pager) does not have to remember what "too high" means.
    const { classifyReadiness } = require('../lib/readiness-thresholds');
    const { signals, status } = classifyReadiness(live);

    // SV-21-01: Stripe-ownership rollout readiness. Each probe DEGRADES to null
    // (→ classified as not-ready) rather than throwing, so a pre-migration schema
    // reports migration_missing instead of 500ing the whole report. paid_ready is
    // fail-closed: true only when the migration is applied, the backfill is
    // complete, zero rows are ambiguous AND the price-only fallback is disabled.
    const { classifyOwnershipReadiness } = require('../lib/ownership-readiness');
    const { ownershipEnforced } = require('../lib/stripe-ownership');
    // migration 038 applied ⇔ customers.app_user_id exists. Selecting the column
    // errors (undefined column) before the migration; treat that as not-applied.
    let migrationApplied = null;
    let unbackfilledCount = null;
    try {
      const probe = await supabase.from('customers').select('app_user_id').limit(1);
      if (probe.error) migrationApplied = false;
      else {
        migrationApplied = true;
        unbackfilledCount = await countOf(() =>
          supabase.from('customers').select('id', { count: 'exact', head: true })
            .not('stripe_customer_id', 'is', null).is('app_user_id', null));
      }
    } catch { migrationApplied = null; }
    // ambiguous legacy-map rows (0 = none). Table missing ⇒ migration not applied.
    const ambiguousCount = migrationApplied === false
      ? null
      : await countOf(() =>
          supabase.from('stripe_object_ownership').select('id', { count: 'exact', head: true })
            .eq('status', 'ambiguous'));
    // SV-22-01: verify the EXACT uniqueness invariant via the DB probe (migration
    // 040's stripe_ownership_uniqueness_ready()), not mere column presence. A
    // NON-partial single-column unique index on customers(app_user_id) is what
    // makes `onConflict: 'app_user_id'` a valid arbiter; the 039-only partial index
    // is NOT inferable and would fail the canonical upsert under enforcement. Any
    // probe failure (function absent on a pre-040 schema, or a read error) degrades
    // to null → classified UNKNOWN/UNIQUENESS_MISSING, never silently "ready".
    let uniquenessReady = null;
    if (migrationApplied === true) {
      try {
        const probe = await supabase.rpc('stripe_ownership_uniqueness_ready');
        if (!probe.error && typeof probe.data === 'boolean') uniquenessReady = probe.data;
        else if (!probe.error && probe.data == null) uniquenessReady = null;
      } catch { uniquenessReady = null; }
    }
    const ownership = classifyOwnershipReadiness({
      enforced: ownershipEnforced(),
      migrationApplied,
      unbackfilledCount,
      ambiguousCount,
      uniquenessReady,
    });

    await audit(req, 'readiness');
    res.json({
      mode,
      ready: blockers.length === 0,
      blockers: blockers.length,
      external: external.length,
      checks, // presence booleans + detail strings, no secret values
      live,
      signals,
      ownership, // { state, paid_ready, enforced, blockers[] } — fail-closed paid readiness
      operational_status: status, // 'ok' | 'degraded' | 'warn' | 'stop' (degraded = a signal could not be measured; never silently 'ok')
      note: 'Automated readiness is not a paid-launch GO. A live low-value charge + cancel/recover ' +
        'rehearsal with owner-recorded evidence is required (see docs/RUNBOOK_TRANSACTION_REHEARSAL.md).',
    });
  } catch {
    res.status(500).json({ error: 'Readiness lookup failed', req_id: req.id });
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
  } catch {
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
  } catch {
    res.status(500).json({ error: 'Lookup failed', req_id: req.id });
  }
});

// ── v10 SC-07: cohort funnel ────────────────────────────────────────────────
// The eleven-step campaign-control loop, computed from canonical events only
// (ids + timestamps; properties are not selected, so no content can leak).
// Every metric ships numerator, denominator, window, state and a decision.
// Tiny cohorts are suppressed. Internal decision aid — never public proof.
router.get('/api/admin/cohort', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'cohort');
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const { computeFunnel, biggestDropOff, costPerOutcome, COHORT_FUNNEL } = require('../lib/cohort');
    const { rosterFromEnv } = require('../lib/beta-scorecard');
    const wanted = COHORT_FUNNEL.map((f) => f.event).filter(Boolean);

    // ids + timestamps only — `properties` is deliberately not selected.
    const { data: eventRows } = await supabase
      .from('analytics_events')
      .select('event, user_id, workspace_id, campaign_id, created_at')
      .in('event', wanted)
      .gte('created_at', since)
      .limit(20000);

    // v18 X01: exclude staff/test/demo subjects using the same auditable roster
    // as the weekly scorecard, so the north-star funnel measures real customers.
    const funnel = computeFunnel(Array.isArray(eventRows) ? eventRows : [], {
      window: { days, since },
      roster: rosterFromEnv(),
    });

    // AI cost per outcome, from the ledger. Null rather than a divide-by-zero.
    const { data: spendRows } = await supabase
      .from('ai_spend_ledger').select('amount_usd').gte('created_at', since);
    const spend = (spendRows || []).reduce((sum, r) => sum + (Number(r.amount_usd) || 0), 0);
    const byStep = Object.fromEntries(funnel.steps.map((s) => [s.step, s.numerator]));

    res.json({
      window: { days, since },
      cohort: funnel,
      biggest_drop_off: biggestDropOff(funnel),
      cost: {
        ai_spend_usd: +spend.toFixed(4),
        per_activated_account: costPerOutcome(spend, byStep.first_asset_saved),
        per_exporting_account: costPerOutcome(spend, byStep.handoff_exported),
        per_renewed_account: costPerOutcome(spend, byStep.subscription_renewed),
        note: 'Null means the denominator was zero or spend is unknown — not that cost was zero.',
      },
      disclosure: 'Internal decision aid. These numbers are not benchmarks, are not ' +
        'statistically significant at beta scale, and must not be shown to customers or used as proof.',
    });
  } catch {
    res.status(500).json({ error: 'Cohort lookup failed', req_id: req.id });
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
  } catch {
    res.status(500).json({ error: 'Scorecard failed', req_id: req.id });
  }
});

// ── SC-P1-12 · Capped-beta value scorecard ──────────────────────────────────
// The activation value loop for the 10–20 user ICP beta. Read-only, pseudonymous
// (ids only, no content), staff/test/demo accounts excluded by an auditable rule,
// every funnel rate on one denominator, gates pre-registered as hypotheses.
// Analytics failure here is isolated: a failed pull degrades to an empty cohort.
const { computeScorecard, rosterFromEnv } = require('../lib/beta-scorecard');
const { weeklyDecisionRecord } = require('../lib/weekly-decision');

// Compute the canonical scorecard for a window. Ids/timestamps/categorical
// properties only — never content. SC-95-03: distinguish a real empty window
// from an analytics OUTAGE — a read failure (thrown error or a Supabase {error}
// result) makes every metric UNAVAILABLE, never zero, so an outage cannot read
// as "no activity" and blocks expansion.
async function betaScorecardForWindow(days) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  let rows = [];
  let dataAvailable = true;
  try {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('event, user_id, workspace_id, created_at, properties')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(20000);
    if (error) dataAvailable = false;
    else rows = Array.isArray(data) ? data : [];
  } catch {
    dataAvailable = false;
  }
  return computeScorecard(rows, {
    window: { days, since, until: new Date().toISOString() },
    roster: rosterFromEnv(),
    dataAvailable,
  });
}

router.get('/api/admin/beta-scorecard', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'beta_scorecard');
    const days = Math.min(Number(req.query.days) || 7, 90);
    res.json(await betaScorecardForWindow(days));
  } catch {
    res.status(500).json({ error: 'Beta scorecard failed', req_id: req.id });
  }
});

// SC-95-05: the weekly capped-beta decision record, generated FROM the canonical
// scorecard (not a second scorecard). Owner-supplied operational inputs:
// cohort start (BETA_COHORT_START) and invited count (BETA_INVITE_CAP) from env;
// billing-severity incident count from ?billing_incidents (default 0), since
// there is no automated billing-incident ledger. Never returns content or PII.
router.get('/api/admin/weekly-decision', requireAuth, requireAdmin, async (req, res) => {
  try {
    await audit(req, 'weekly_decision');
    const days = Math.min(Number(req.query.days) || 7, 90);
    const scorecard = await betaScorecardForWindow(days);
    const record = weeklyDecisionRecord(scorecard, {
      now: Date.now(),
      cohortStart: process.env.BETA_COHORT_START || null,
      invited: process.env.BETA_INVITE_CAP || null,
      billingIncidents: Math.max(0, Number(req.query.billing_incidents) || 0),
    });
    res.json(record);
  } catch {
    res.status(500).json({ error: 'Weekly decision failed', req_id: req.id });
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
  } catch {
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

// Cron entry point. Called by an external scheduler (cron-job.org on the free
// stack — configure it to send `Authorization: Bearer ${CRON_SECRET}`).
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
