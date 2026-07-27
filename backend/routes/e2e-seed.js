// ---------------------------------------------------------------------------
// v11 SC-03 — deterministic seed/reset for the authenticated browser matrix.
//
// The signed-in product could not be tested in a browser because the Playwright
// harness is credential-free: every authenticated route redirected to login, so
// the highest-value paid journey was covered by unit tests alone. This router
// creates isolated synthetic data for one test run and deletes it again by run
// id.
//
// It is fail-closed in three independent ways, because a seeding endpoint that
// reaches production is a data-loss incident:
//
//   1. server.js mounts it only when E2E_SEED_ENABLED === '1'.
//   2. It refuses to load at all when launchMode() is 'production'.
//   3. Every request must carry the E2E_SEED_SECRET, which must be long enough
//      to not be guessable.
//
// It does NOT bypass authorization anywhere else: it creates rows and a real
// Supabase Auth user, and the tests then sign in through the ordinary login
// flow and are subject to every normal ownership and entitlement check.
// Entitlement is never granted here — plan state comes from the billing tables
// exactly as it does in production.
// ---------------------------------------------------------------------------

const express = require('express');
const crypto = require('crypto');

const supabase = require('../lib/supabase');
const { launchMode } = require('../lib/launch-config');

const router = express.Router();
const json = express.json({ limit: '16kb' });

// Every seeded row is reachable from the workspace, so cleanup only ever needs
// the workspaces this run created. Children cascade.
const RUN_PREFIX = 'e2e-run-';
const SEED_DOMAIN = 'e2e.invalid'; // reserved TLD: these addresses can never receive mail

function seedingAllowed() {
  if (launchMode() === 'production') return 'refusing to seed in production';
  if (process.env.E2E_SEED_ENABLED !== '1') return 'E2E_SEED_ENABLED is not 1';
  const secret = process.env.E2E_SEED_SECRET || '';
  if (secret.length < 24) return 'E2E_SEED_SECRET is missing or too short (24+ characters)';
  return null;
}

// Timing-safe comparison: a seeding secret is a credential like any other.
function secretMatches(provided) {
  const expected = process.env.E2E_SEED_SECRET || '';
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function guard(req, res, next) {
  const problem = seedingAllowed();
  if (problem) return res.status(404).json({ error: 'Not found' }); // never advertise the endpoint
  if (!secretMatches(req.get('x-e2e-seed-secret'))) {
    return res.status(401).json({ error: 'Seed secret required.' });
  }
  next();
}

const isRunId = (v) => typeof v === 'string' && /^[a-z0-9-]{8,64}$/.test(v);
const emailFor = (runId, role) => `${RUN_PREFIX}${runId}-${role}@${SEED_DOMAIN}`;

// Synthetic content only. Nothing here resembles a real customer, and no
// fixture-only wording is phrased so it could leak into product copy as if it
// described a real brand.
const BRAND_FIXTURE = {
  name: 'Northwind Studio',
  what_we_sell: 'A four-week group coaching programme for independent consultants.',
  audience: 'Independent consultants billing under six figures who want a repeatable offer.',
  tone: 'Direct, practical, no hype.',
  proof: 'Twelve cohorts delivered since 2023.',
  restrictions: 'No income claims. No guarantees of results.',
};

const CAMPAIGN_FIXTURE = {
  name: 'Autumn cohort launch',
  objective: 'Fill the October cohort',
  audience: BRAND_FIXTURE.audience,
  offer_summary: 'Four-week group programme, twelve seats, opens 1 October.',
  channels: ['landing', 'email', 'social', 'ads'],
  key_message: 'One repeatable offer beats five scattered ones.',
  promo_terms: 'Early-bird pricing closes 24 September.',
};

/**
 * Create the Supabase Auth user for a run. Confirmed on creation so the test
 * can sign in immediately — this mirrors a user who verified their email, it
 * does not skip verification for anyone else.
 */
async function createUser(email, password) {
  const admin = supabase.adminClient().auth.admin;
  const { data, error } = await admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { e2e: true },
  });
  if (error) throw new Error(`could not create seed user: ${error.message}`);
  return data.user;
}

async function deleteUser(userId) {
  const admin = supabase.adminClient().auth.admin;
  try { await admin.deleteUser(userId); } catch { /* already gone */ }
}

// ── POST /api/e2e/seed ─────────────────────────────────────────────────────
// Body: { run_id, scenario }. Returns the credentials and ids the browser
// suite needs. The password is generated per run and never reused.
router.post('/api/e2e/seed', guard, json, async (req, res) => {
  const { run_id: runId, scenario = 'campaign_ready' } = req.body || {};
  if (!isRunId(runId)) return res.status(400).json({ error: 'run_id must be 8-64 chars of [a-z0-9-]' });

  const email = emailFor(runId, scenario);
  const password = `e2e-${crypto.randomBytes(18).toString('hex')}`;

  try {
    const user = await createUser(email, password);

    const { data: workspace, error: wsErr } = await supabase.from('workspaces')
      .insert({ user_email: email, name: `${BRAND_FIXTURE.name} (${runId})`, type: 'service' })
      .select('id').single();
    if (wsErr) throw new Error(`workspace insert failed: ${wsErr.message}`);

    const created = { workspace_id: workspace.id };

    if (scenario !== 'empty_workspace') {
      const { error: bpErr } = await supabase.from('brand_profiles')
        .insert({ workspace_id: workspace.id, data: BRAND_FIXTURE });
      if (bpErr) throw new Error(`brand profile insert failed: ${bpErr.message}`);
      created.brand_profile = true;
    }

    if (['campaign_ready', 'brief_approved', 'stale_brief'].includes(scenario)) {
      const { data: campaign, error: cErr } = await supabase.from('campaigns')
        .insert({
          workspace_id: workspace.id,
          ...CAMPAIGN_FIXTURE,
          brief_approved: scenario !== 'campaign_ready',
          status: 'draft',
        })
        .select('id').single();
      if (cErr) throw new Error(`campaign insert failed: ${cErr.message}`);
      created.campaign_id = campaign.id;
    }

    res.json({
      run_id: runId,
      scenario,
      email,
      password,
      user_id: user.id,
      ...created,
      note: 'Synthetic data. Delete with DELETE /api/e2e/seed/:run_id when the run ends.',
    });
  } catch (err) {
    // Best-effort cleanup so a half-built run never lingers.
    try { await router.cleanup(runId); } catch { /* nothing to undo */ }
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Delete everything a run created. Scoped by the run's email prefix, so it can
// never touch a row this endpoint did not create.
router.cleanup = async function cleanup(runId) {
  const like = `${RUN_PREFIX}${runId}-%@${SEED_DOMAIN}`;
  const { data: workspaces } = await supabase.from('workspaces')
    .select('id, user_email').like('user_email', like);

  for (const ws of workspaces || []) {
    // Children cascade from workspaces; brand_profiles has no FK cascade.
    await supabase.from('brand_profiles').delete().eq('workspace_id', ws.id);
    await supabase.from('workspaces').delete().eq('id', ws.id);
  }

  const admin = supabase.adminClient().auth.admin;
  try {
    const { data } = await admin.listUsers({ perPage: 200 });
    for (const u of (data && data.users) || []) {
      if (u.email && u.email.startsWith(`${RUN_PREFIX}${runId}-`) && u.email.endsWith(`@${SEED_DOMAIN}`)) {
        await deleteUser(u.id);
      }
    }
  } catch { /* auth admin unavailable — workspace rows are already gone */ }

  return (workspaces || []).length;
};

router.delete('/api/e2e/seed/:runId', guard, async (req, res) => {
  const { runId } = req.params;
  if (!isRunId(runId)) return res.status(400).json({ error: 'invalid run_id' });
  try {
    const removed = await router.cleanup(runId);
    res.json({ run_id: runId, workspaces_removed: removed });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
module.exports.seedingAllowed = seedingAllowed;
module.exports.RUN_PREFIX = RUN_PREFIX;
module.exports.SEED_DOMAIN = SEED_DOMAIN;
