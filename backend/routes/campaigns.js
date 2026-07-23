// ---------------------------------------------------------------------------
// Campaign Studio (audit Prompt 12) — the product's organizing layer.
//
// A campaign holds one brief (objective, audience, offer, dates, channels,
// promo terms). "Generate strategy" is an AI action that produces the message
// hierarchy + calendar; the user approves the brief, then generates linked
// assets (emails, social, ads, landing) from it — all sharing campaign_id so
// discount, dates, CTA and audience stay consistent. No external publishing.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { planGate, usageFor } = require('../lib/plan-limits');
const { generateJson } = require('../lib/ai');
const { brandContextFor } = require('../lib/brand-profile');
const { resolveWorkspace } = require('./workspaces');
const { track } = require('../lib/analytics');
const { DELIVERABLES, campaignGap, validatePlan } = require('../lib/deliverables');
const { runConsistencyChecks, FINDING_META, RULES_VERSION } = require('../lib/consistency');
const { PLAYBOOKS, playbookById, sanitizeTemplateData } = require('../lib/playbooks');
const { campaignImpact, diffFingerprint, briefDiffForAsset, MATERIAL_FIELDS } = require('../lib/brief-impact');

router.use(express.json({ limit: '16kb' }));

const ASSET_TABLES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];

async function ownedCampaign(ws, id) {
  const { data } = await supabase.from('campaigns').select('*').eq('id', id).eq('workspace_id', ws.id).single();
  return data || null;
}

function briefPatch(body) {
  const patch = {};
  const b = body || {};
  // v5 Prompt 6: the full brief — goal, offer, audience, markets, language,
  // key message, proof, restrictions, promotion, dates and a real deadline.
  const strings = ['name', 'objective', 'audience', 'offer_summary', 'products', 'promo_terms', 'status',
    'markets', 'language', 'key_message', 'proof', 'restrictions'];
  for (const k of strings) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, k === 'name' ? 120 : 4000);
  for (const k of ['start_date', 'end_date', 'deadline']) if (typeof b[k] === 'string') patch[k] = b[k] || null;
  if (Array.isArray(b.channels)) patch.channels = b.channels.map(String).slice(0, 8);
  if (typeof b.brief_approved === 'boolean') patch.brief_approved = b.brief_approved;
  if (typeof b.archived === 'boolean') patch.archived = b.archived;
  if (typeof b.offer_id === 'string' || b.offer_id === null) patch.offer_id = b.offer_id;
  return patch;
}

// GET /api/campaigns — list with per-campaign asset completion counts.
router.get('/api/campaigns', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data: campaigns } = await supabase
      .from('campaigns').select('*').eq('workspace_id', ws.id)
      .order('created_at', { ascending: false });

    // v8 LB-S01: attach each campaign's saved deliverable plan (one query) so
    // the Dashboard can prioritize unresolved required deliverables.
    const ids = (campaigns || []).map((c) => c.id);
    let planByCampaign = {};
    if (ids.length) {
      const { data: planRows } = await supabase
        .from('campaign_deliverables').select('campaign_id, deliverable_code, requirement_state')
        .eq('workspace_id', ws.id).in('campaign_id', ids);
      for (const r of planRows || []) {
        (planByCampaign[r.campaign_id] = planByCampaign[r.campaign_id] || []).push(
          { deliverable_code: r.deliverable_code, requirement_state: r.requirement_state });
      }
    }

    const withCounts = await Promise.all((campaigns || []).map(async (c) => {
      const counts = {};
      await Promise.all(ASSET_TABLES.map(async (t) => {
        const { count, error } = await supabase
          .from(t).select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws.id).eq('campaign_id', c.id);
        counts[t] = error ? 0 : (count || 0);
      }));
      return { ...c, asset_counts: counts, deliverable_plan: planByCampaign[c.id] || [] };
    }));

    res.json({ campaigns: withCounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns — create from a brief (no AI, no action consumed).
router.post('/api/campaigns', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const patch = briefPatch(req.body);
    if (!patch.name) return res.status(400).json({ error: 'Give the campaign a name.' });

    if (patch.offer_id) {
      const { data: offer } = await supabase.from('offers').select('id').eq('id', patch.offer_id).eq('workspace_id', ws.id).single();
      if (!offer) return res.status(404).json({ error: 'Offer not found' });
    }

    const { data, error } = await supabase
      .from('campaigns')
      .insert({ workspace_id: ws.id, ...patch })
      .select()
      .single();
    if (error) throw new Error('Failed to create campaign: ' + error.message);
    res.status(201).json({ campaign: data });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id
router.get('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S01: deliverable plan + gap map ───────────────────────────────────
// Deterministic and free: reading or saving the plan never spends an AI action.

async function assetsByTableFor(ws, campaignId) {
  const byTable = {};
  await Promise.all(DELIVERABLES.map(async (d) => {
    const { data } = await supabase
      .from(d.table).select('id, status')
      .eq('workspace_id', ws.id).eq('campaign_id', campaignId);
    byTable[d.table] = data || [];
  }));
  return byTable;
}

// GET /api/campaigns/:id/deliverables — the gap map: per-deliverable state
// derived from the saved plan + real asset rows, with transparent blockers.
router.get('/api/campaigns/:id/deliverables', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { data: planRows } = await supabase
      .from('campaign_deliverables').select('deliverable_code, requirement_state')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
    const gap = campaignGap(campaign, planRows || [], await assetsByTableFor(ws, campaign.id));
    res.json({ gap });
  } catch (err) {
    next(err);
  }
});

// PUT /api/campaigns/:id/deliverables — save the user's plan. Unknown codes
// and states are rejected; the plan is replaced atomically per campaign.
router.put('/api/campaigns/:id/deliverables', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const check = validatePlan(req.body);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const now = new Date().toISOString();
    const { error } = await supabase.from('campaign_deliverables').upsert(
      check.rows.map((r) => ({ ...r, campaign_id: campaign.id, workspace_id: ws.id, updated_at: now })),
      { onConflict: 'campaign_id,deliverable_code' }
    );
    if (error) throw new Error('Failed to save deliverable plan: ' + error.message);

    track('deliverable_plan_saved', {
      userId: req.userId,
      workspaceId: ws.id,
      properties: { required: check.rows.filter((r) => r.requirement_state === 'required').length, total: check.rows.length },
    });

    const gap = campaignGap(campaign, check.rows, await assetsByTableFor(ws, campaign.id));
    res.json({ ok: true, gap });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S02: cross-channel consistency check ──────────────────────────────
// Deterministic and free: recomputing findings never spends an AI action.
// Findings are derived fresh from structured asset fields + the brief; the
// consistency_findings table only tracks lifecycle (open/acknowledged/
// resolved) keyed by fingerprint, so a changed fingerprint reopens naturally.

async function fullAssetsByTableFor(ws, campaignId) {
  const byTable = {};
  await Promise.all(DELIVERABLES.map(async (d) => {
    const { data } = await supabase
      .from(d.table).select('*')
      .eq('workspace_id', ws.id).eq('campaign_id', campaignId);
    byTable[d.table] = data || [];
  }));
  return byTable;
}

// GET /api/campaigns/:id/consistency — recompute, reconcile lifecycle, return.
router.get('/api/campaigns/:id/consistency', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const computed = runConsistencyChecks(campaign, await fullAssetsByTableFor(ws, campaign.id));

    const { data: persisted } = await supabase
      .from('consistency_findings').select('fingerprint, status, note_category')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
    const byFp = new Map((persisted || []).map((r) => [r.fingerprint, r]));
    const now = new Date().toISOString();

    // Upsert current findings; a previously-resolved fingerprint that
    // reappears reopens (its resolution no longer holds).
    if (computed.length) {
      const { error } = await supabase.from('consistency_findings').upsert(
        computed.map((f) => {
          const prev = byFp.get(f.fingerprint);
          const status = prev && prev.status === 'acknowledged' ? 'acknowledged' : 'open';
          return {
            workspace_id: ws.id, campaign_id: campaign.id,
            fingerprint: f.fingerprint, code: f.code, severity: f.severity,
            rule_version: f.rule_version, status, last_seen_at: now, resolved_at: null,
          };
        }),
        { onConflict: 'campaign_id,fingerprint' }
      );
      if (error) throw new Error('Failed to record findings: ' + error.message);
    }

    // Findings that stopped appearing are resolved — server-confirmed event.
    const currentFps = new Set(computed.map((f) => f.fingerprint));
    for (const row of persisted || []) {
      if (row.status !== 'resolved' && !currentFps.has(row.fingerprint)) {
        await supabase.from('consistency_findings')
          .update({ status: 'resolved', resolved_at: now })
          .eq('campaign_id', campaign.id).eq('fingerprint', row.fingerprint);
        const meta = Object.entries(FINDING_META).find(([code]) => row.code === code);
        track('finding_resolved', {
          userId: req.userId, workspaceId: ws.id,
          properties: { code: row.code, severity: meta ? meta[1].severity : 'unknown' },
        });
      }
    }

    const findings = computed.map((f) => {
      const prev = byFp.get(f.fingerprint);
      return { ...f, status: prev && prev.status === 'acknowledged' ? 'acknowledged' : 'open', note_category: prev ? prev.note_category : null };
    });
    track('consistency_check_viewed', {
      userId: req.userId, workspaceId: ws.id,
      properties: {
        total: findings.length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
      },
    });

    res.json({
      rule_version: RULES_VERSION,
      findings,
      // Honest empty state: absence of findings is not approval.
      clean_message: findings.length === 0 ? 'No issues detected by these checks. This is not an approval — review remains yours.' : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S03: brief-change impact + stale-asset review ─────────────────────
// Derived from snapshots — free, no AI action, no silent propagation.

// GET /api/campaigns/:id/brief-impact — field-level diff of the current brief
// vs each asset's generation-time snapshot, with per-asset review state.
router.get('/api/campaigns/:id/brief-impact', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { data: reviews } = await supabase
      .from('asset_brief_reviews').select('asset_table, asset_id, diff_fingerprint, reviewed_at, reviewer')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
    const impact = campaignImpact(campaign, await fullAssetsByTableFor(ws, campaign.id), reviews || []);

    if (impact.affected.length) {
      track('stale_asset_opened', {
        userId: req.userId, workspaceId: ws.id,
        properties: { affected: impact.affected.length, open: impact.open },
      });
    }
    res.json({ impact });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/brief-impact/keep — explicitly keep one asset's
// snapshot for the CURRENT diff. Records reviewer + time; a further material
// brief change produces a new fingerprint and reopens the review. Keeping a
// snapshot is a decision on record — not a statement that it is factually
// correct.
router.post('/api/campaigns/:id/brief-impact/keep', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { asset_table, asset_id } = req.body || {};
    if (!MATERIAL_FIELDS[asset_table] || typeof asset_id !== 'string') {
      return res.status(400).json({ error: 'Send asset_table and asset_id.' });
    }
    const { data: asset } = await supabase
      .from(asset_table).select('*')
      .eq('id', asset_id).eq('workspace_id', ws.id).eq('campaign_id', campaign.id).single();
    if (!asset) return res.status(404).json({ error: 'Asset not found in this campaign' });

    const changed = briefDiffForAsset(campaign, asset_table, asset);
    if (!changed.length) return res.status(409).json({ error: 'This asset matches the current brief — nothing to keep.' });

    const { error } = await supabase.from('asset_brief_reviews').upsert({
      workspace_id: ws.id, campaign_id: campaign.id,
      asset_table, asset_id,
      diff_fingerprint: diffFingerprint(asset_table, asset_id, changed),
      decision: 'keep_snapshot',
      reviewer: req.userEmail || null,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: 'campaign_id,asset_table,asset_id' });
    if (error) throw new Error('Failed to record review: ' + error.message);

    track('stale_asset_resolved', {
      userId: req.userId, workspaceId: ws.id,
      properties: { method: 'keep_snapshot', changed_field_codes: changed.map((c) => c.field).join(',') },
    });
    track('review_item_resolved', {
      userId: req.userId, workspaceId: ws.id,
      properties: { kind: 'stale_keep' },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S06: first-party playbooks + workspace templates ──────────────────
// Playbooks are versioned structure (objective, deliverable plan, questions),
// never claims or benchmarks. Applying anything creates a NEW draft campaign —
// existing campaigns are never overwritten and approval never transfers.

// GET /api/playbooks — the versioned first-party catalog (preview data).
router.get('/api/playbooks', requireAuth, async (_req, res) => {
  res.json({ playbooks: PLAYBOOKS });
});

// POST /api/campaigns/apply-playbook — create a draft campaign from one.
router.post('/api/campaigns/apply-playbook', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { playbook_id, name } = req.body || {};
    const pb = playbookById(playbook_id);
    if (!pb) return res.status(404).json({ error: 'Playbook not found' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Give the campaign a name.' });

    const { data: campaign, error } = await supabase.from('campaigns').insert({
      workspace_id: ws.id,
      name: name.trim().slice(0, 120),
      objective: pb.suggested_objective,
      channels: pb.channels,
      status: 'draft',
      // facts stay empty for the user to verify — never prefilled from a playbook
    }).select().single();
    if (error) throw new Error('Failed to create campaign: ' + error.message);

    const now = new Date().toISOString();
    const planRows = Object.entries(pb.deliverables).map(([deliverable_code, requirement_state]) => ({
      workspace_id: ws.id, campaign_id: campaign.id, deliverable_code, requirement_state, updated_at: now,
    }));
    const { error: planErr } = await supabase.from('campaign_deliverables')
      .upsert(planRows, { onConflict: 'campaign_id,deliverable_code' });
    if (planErr) throw new Error('Failed to save deliverable plan: ' + planErr.message);

    track('playbook_applied', {
      userId: req.userId, workspaceId: ws.id,
      properties: { playbook_id: pb.id, playbook_version: pb.version },
    });
    res.status(201).json({ campaign, brief_questions: pb.brief_questions });
  } catch (err) {
    next(err);
  }
});

// GET /api/templates — this workspace's saved templates.
router.get('/api/templates', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data } = await supabase
      .from('workspace_templates').select('*').eq('workspace_id', ws.id)
      .order('created_at', { ascending: false });
    res.json({ templates: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/save-template — save a sanitized template from an
// existing campaign. `include` lists the brief fields to carry; everything
// else (approval, statuses, strategy, evidence, dates) is dropped by design.
router.post('/api/campaigns/:id/save-template', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { name, include } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Give the template a name.' });

    const { data: planRows } = await supabase
      .from('campaign_deliverables').select('deliverable_code, requirement_state')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);

    const data = sanitizeTemplateData(campaign, include, planRows || []);
    const { data: saved, error } = await supabase.from('workspace_templates').insert({
      workspace_id: ws.id,
      name: name.trim().slice(0, 120),
      source_campaign_id: campaign.id,
      data,
    }).select().single();
    if (error) throw new Error('Failed to save template: ' + error.message);
    res.status(201).json({ template: saved });
  } catch (err) {
    next(err);
  }
});

// POST /api/templates/:id/apply — new DRAFT campaign from a template.
router.post('/api/templates/:id/apply', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data: tpl } = await supabase
      .from('workspace_templates').select('*').eq('id', req.params.id).eq('workspace_id', ws.id).single();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Give the campaign a name.' });

    const brief = (tpl.data && tpl.data.brief) || {};
    const { data: campaign, error } = await supabase.from('campaigns').insert({
      workspace_id: ws.id,
      name: name.trim().slice(0, 120),
      ...brief,
      status: 'draft', // never approved, never published
    }).select().single();
    if (error) throw new Error('Failed to create campaign: ' + error.message);

    const deliverables = (tpl.data && tpl.data.deliverables) || [];
    if (deliverables.length) {
      const now = new Date().toISOString();
      await supabase.from('campaign_deliverables').upsert(
        deliverables.map((r) => ({ ...r, workspace_id: ws.id, campaign_id: campaign.id, updated_at: now })),
        { onConflict: 'campaign_id,deliverable_code' });
    }
    track('user_template_reused', { userId: req.userId, workspaceId: ws.id, properties: { template_version: tpl.version } });
    res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/templates/:id
router.delete('/api/templates/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    await supabase.from('workspace_templates').delete().eq('id', req.params.id).eq('workspace_id', ws.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S05: deterministic campaign package preview ───────────────────────
// Shown BEFORE the trial/checkout: what the paid workflow will assemble from
// this brief — inherited facts, planned deliverables, expected output
// structures and the review checks that run. No AI call, no fabricated draft.

const OUTPUT_STRUCTURE = {
  landing_page: 'Structured page copy: headline, sections, SEO title/meta, one primary CTA',
  email_flow: 'A sequenced email flow: subject options, preheader, body copy, timing and segment per email',
  social_set: 'Platform captions with hooks, CTAs, hashtags and visual direction (planned, never scheduled)',
  creative_brief: 'Ad creative briefs: hooks, headlines, primary text, shot list and testing angle (briefs, not media)',
  seo_ideas: 'SEO research ideas: keywords, intent, titles, H-structure and FAQs — no invented volume or difficulty',
};

router.get('/api/campaigns/:id/package-preview', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { data: planRows } = await supabase
      .from('campaign_deliverables').select('deliverable_code, requirement_state')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
    const plan = new Map((planRows || []).map((r) => [r.deliverable_code, r.requirement_state]));

    const preview = {
      brief_facts: {
        name: campaign.name,
        objective: campaign.objective || null,
        audience: campaign.audience || null,
        offer: campaign.offer_summary || null,
        promo_terms: campaign.promo_terms || null,
        key_message: campaign.key_message || null,
        dates: campaign.start_date ? `${campaign.start_date} → ${campaign.end_date || 'open'}` : null,
        proof: campaign.proof || null,
      },
      deliverables: DELIVERABLES.map((d) => ({
        code: d.code,
        label: d.label,
        requirement: plan.get(d.code) || 'unplanned',
        output_structure: OUTPUT_STRUCTURE[d.code],
      })),
      review_checks: Object.entries(FINDING_META).map(([code, m]) => ({ code, why: m.why })),
      honesty: 'This preview is assembled from your brief — nothing here is AI-generated content. ' +
        'Generation runs after the trial starts and uses 1 AI action per successful generation.',
    };
    track('package_preview_viewed', { userId: req.userId, workspaceId: ws.id, properties: { planned: plan.size } });
    res.json({ preview });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S04: campaign review queue + export manifest ──────────────────────
// One place to traverse every campaign risk; individual resolution stays in
// the mechanisms that own it (findings ack, snapshot keep, Library status).

async function buildReviewQueue(ws, campaign) {
  const assetsByTable = await fullAssetsByTableFor(ws, campaign.id);

  const findings = runConsistencyChecks(campaign, assetsByTable);
  const { data: persisted } = await supabase
    .from('consistency_findings').select('fingerprint, status, note_category')
    .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
  const statusByFp = new Map((persisted || []).map((r) => [r.fingerprint, r]));

  const { data: reviews } = await supabase
    .from('asset_brief_reviews').select('asset_table, asset_id, diff_fingerprint, reviewed_at, reviewer')
    .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
  const impact = campaignImpact(campaign, assetsByTable, reviews || []);

  const needsReview = [];
  const assetIndex = [];
  for (const [table, rows] of Object.entries(assetsByTable)) {
    for (const a of rows) {
      const title = (a.title || a.subject_line || a.hook || a.h1 || a.page_type || a.flow_type || 'Untitled');
      assetIndex.push({
        table, id: a.id, title, status: a.status || 'draft',
        brief_snapshot_at: a.brief_snapshot ? a.brief_snapshot.snapshot_at || null : null,
      });
      if (a.status === 'edited') needsReview.push({ table, id: a.id, title });
    }
  }

  const { data: linkRows } = await supabase
    .from('asset_evidence_links').select('evidence_id, asset_table, asset_id')
    .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
  const evidenceIds = [...new Set((linkRows || []).map((l) => l.evidence_id))];
  let evidence = [];
  if (evidenceIds.length) {
    const { data } = await supabase
      .from('evidence').select('id, type, label, source_url, source_ref, checked_date, review_by_date, archived')
      .eq('workspace_id', ws.id).in('id', evidenceIds);
    evidence = data || [];
  }
  const today = new Date().toISOString().slice(0, 10);
  const evidenceReminders = evidence.filter((e) => !e.archived && e.review_by_date && e.review_by_date < today);

  const openFindings = findings.map((f) => {
    const prev = statusByFp.get(f.fingerprint);
    return { ...f, status: prev && prev.status === 'acknowledged' ? 'acknowledged' : 'open' };
  });

  return {
    findings: openFindings,
    stale: impact.affected.filter((a) => a.review_state === 'review_brief_changes'),
    needs_review_assets: needsReview,
    evidence,
    evidence_links: linkRows || [],
    evidence_reminders: evidenceReminders,
    assets: assetIndex,
    // Export-blocking items: unresolved high-severity findings. Everything
    // else is a reminder — 'Ready to export' remains a human decision.
    blocking: openFindings.filter((f) => f.severity === 'high' && f.status !== 'acknowledged'),
  };
}

// GET /api/campaigns/:id/review — the campaign review queue by risk type.
router.get('/api/campaigns/:id/review', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ review: await buildReviewQueue(ws, campaign) });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id/review-manifest — deterministic handoff record:
// asset index, statuses, snapshot timestamps, unresolved items and evidence
// references. Explicitly NOT an approval or compliance certificate, and it
// never erases unresolved items.
router.get('/api/campaigns/:id/review-manifest', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const q = await buildReviewQueue(ws, campaign);
    const lines = [
      `# Review manifest — ${campaign.name}`,
      '',
      'This is a handoff record generated by Scalvya. It is NOT an approval,',
      'fact-check or compliance certificate — publishing decisions and platform/',
      'legal review remain with you and your downstream owner.',
      '',
      `Brief approved: ${campaign.brief_approved ? 'yes' : 'no'}`,
      '',
      '## Assets',
      ...q.assets.map((a) =>
        `- ${a.title} (${a.table}) — status: ${a.status}${a.brief_snapshot_at ? `, brief snapshot: ${a.brief_snapshot_at}` : ', no brief snapshot'}`),
      '',
      '## Unresolved items',
      ...(q.blocking.length ? q.blocking.map((f) => `- BLOCKING · ${f.code}: ${f.assets.map((x) => x.title).join(', ')}`) : []),
      ...q.findings.filter((f) => f.severity !== 'high' || f.status === 'acknowledged')
        .map((f) => `- ${f.status === 'acknowledged' ? 'acknowledged' : 'open'} · ${f.code}: ${f.assets.map((x) => x.title).join(', ')}`),
      ...q.stale.map((a) => `- review brief changes · ${a.title}: ${a.changed.map((c) => c.field).join(', ')}`),
      ...q.needs_review_assets.map((a) => `- needs review · ${a.title}`),
      ...(q.findings.length || q.stale.length || q.needs_review_assets.length ? [] : ['- none detected by these checks (this is not an approval)']),
      '',
      '## Evidence references',
      ...(q.evidence.length
        ? q.evidence.map((e) => `- ${e.label} (${e.type}) — checked ${e.checked_date}${e.source_url ? `, source: ${e.source_url}` : ''}${e.source_ref ? `, ref: ${e.source_ref}` : ''}`)
        : ['- none recorded']),
      '',
      `Generated ${new Date().toISOString()} · rules ${RULES_VERSION}`,
    ];

    if (q.blocking.length) {
      track('export_blocked', {
        userId: req.userId, workspaceId: ws.id,
        properties: { blocking: q.blocking.length },
      });
    }
    track('review_manifest_exported', {
      userId: req.userId, workspaceId: ws.id,
      properties: { assets: q.assets.length, unresolved: q.findings.length + q.stale.length + q.needs_review_assets.length },
    });
    res.json({ manifest_markdown: lines.join('\n'), blocking: q.blocking.length });
  } catch (err) {
    next(err);
  }
});

// ── v8 LB-S07: campaign review packet (export-only handoff, ADR-001) ────────
// A complete handoff record for a client/designer/channel operator. Formats:
// Markdown or print-friendly self-contained HTML. No share links (deferred
// per ADR-001), no collaboration claims, no approval implied.

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function packetMarkdown(campaign, q) {
  const unresolved = [
    ...q.blocking.map((f) => `- BLOCKING · ${f.code.replace(/_/g, ' ')}: ${f.assets.map((x) => x.title).join(', ')}`),
    ...q.findings.filter((f) => f.severity !== 'high' || f.status === 'acknowledged')
      .map((f) => `- ${f.status} · ${f.code.replace(/_/g, ' ')}: ${f.assets.map((x) => x.title).join(', ')}`),
    ...q.stale.map((a) => `- review brief changes · ${a.title} (${a.changed.map((c) => c.label).join(', ')})`),
    ...q.needs_review_assets.map((a) => `- needs review · ${a.title}`),
  ];
  return [
    `# Campaign review packet — ${campaign.name}`,
    '',
    '> Handoff record generated by Scalvya. NOT an approval, fact-check or',
    '> compliance certificate. Publishing, sending, scheduling and platform/',
    '> legal review belong to the downstream owner.',
    '',
    '## Campaign summary',
    ...[
      ['Objective', campaign.objective], ['Audience', campaign.audience],
      ['Offer', campaign.offer_summary], ['Promo terms', campaign.promo_terms],
      ['Key message', campaign.key_message], ['Proof', campaign.proof],
      ['Restrictions', campaign.restrictions],
      ['Dates', campaign.start_date ? `${campaign.start_date} → ${campaign.end_date || 'open'}` : null],
      ['Brief approved', campaign.brief_approved ? 'yes' : 'no'],
    ].filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`),
    '',
    '## Asset index',
    ...(q.assets.length
      ? q.assets.map((a) => `- ${a.title} · ${a.table.replace(/_/g, ' ')} · status: ${a.status}${a.brief_snapshot_at ? ` · brief snapshot ${a.brief_snapshot_at}` : ' · no brief snapshot'}`)
      : ['- no assets yet']),
    '',
    '## Unresolved items (disclosed, not erased)',
    ...(unresolved.length ? unresolved : ['- none detected by these checks (this is not an approval)']),
    '',
    '## Evidence references',
    ...(q.evidence.length
      ? q.evidence.map((e) => `- ${e.label} (${e.type}) — checked ${e.checked_date}${e.source_url ? ` — ${e.source_url}` : ''}${e.source_ref ? ` — ${e.source_ref}` : ''}`)
      : ['- none recorded']),
    '',
    '## Downstream owner checklist',
    '- [ ] Verify every fact, price, date and claim against your own sources.',
    '- [ ] Resolve the unresolved items above before publishing.',
    '- [ ] Check platform policies and legal/compliance requirements yourself.',
    '- [ ] Set up publishing/sending/scheduling in your own tools — Scalvya does none of these.',
    '- [ ] Record final approval in your own process.',
    '',
    `Generated ${new Date().toISOString()} · consistency rules ${RULES_VERSION}`,
  ].join('\n');
}

function packetHtml(campaign, md) {
  // Print-friendly, dependency-free; user content is escaped line by line.
  const body = md.split('\n').map((ln) => {
    if (ln.startsWith('# ')) return `<h1>${escHtml(ln.slice(2))}</h1>`;
    if (ln.startsWith('## ')) return `<h2>${escHtml(ln.slice(3))}</h2>`;
    if (ln.startsWith('> ')) return `<p class="note">${escHtml(ln.slice(2))}</p>`;
    if (ln.startsWith('- ')) return `<li>${escHtml(ln.slice(2)).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`;
    return ln.trim() ? `<p>${escHtml(ln)}</p>` : '';
  }).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
    `<title>${escHtml(campaign.name)} — review packet</title>` +
    `<style>body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111827}` +
    `h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.5rem;border-bottom:1px solid #E5E7EB;padding-bottom:4px}` +
    `.note{color:#6B7280;font-style:italic}li{margin:2px 0}@media print{body{margin:0}}</style>` +
    `</head><body>${body}</body></html>`;
}

// GET /api/campaigns/:id/review-packet?format=md|html
router.get('/api/campaigns/:id/review-packet', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const q = await buildReviewQueue(ws, campaign);
    const md = packetMarkdown(campaign, q);
    track('review_packet_exported', {
      userId: req.userId, workspaceId: ws.id,
      properties: { format: req.query.format === 'html' ? 'html' : 'md', assets: q.assets.length, unresolved: q.blocking.length },
    });
    // v8 LB-S09 funnel: the value moment — a campaign with every required
    // deliverable ready produced a handoff. Deduped once per campaign so repeat
    // exports don't inflate the completion count.
    try {
      const { data: planRows } = await supabase
        .from('campaign_deliverables').select('deliverable_code, requirement_state')
        .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
      const gap = campaignGap(campaign, planRows || [], await assetsByTableFor(ws, campaign.id));
      if (gap.all_required_ready) {
        track('campaign_completed', {
          userId: req.userId, workspaceId: ws.id, dedupeKey: `done:${campaign.id}`,
          properties: { required: gap.required_total, unresolved: q.blocking.length },
        });
      }
    } catch (_) { /* funnel emission must never block the export */ }
    if (req.query.format === 'html') {
      res.type('html').send(packetHtml(campaign, md));
    } else {
      res.json({ packet_markdown: md });
    }
  } catch (err) {
    next(err);
  }
});

// Categorical acknowledgment notes — never free text.
const ACK_NOTES = ['intentional', 'reviewed_ok', 'external_check_pending', 'other'];

// POST /api/campaigns/:id/consistency/ack — acknowledge one human-review
// finding. Acknowledgment never rewrites data and never implies approval.
router.post('/api/campaigns/:id/consistency/ack', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { fingerprint, note_category } = req.body || {};
    if (typeof fingerprint !== 'string' || !ACK_NOTES.includes(note_category)) {
      return res.status(400).json({ error: `Send fingerprint and a note_category (${ACK_NOTES.join('|')}).` });
    }
    const { data: row } = await supabase
      .from('consistency_findings').select('id, code, status')
      .eq('workspace_id', ws.id).eq('campaign_id', campaign.id).eq('fingerprint', fingerprint).single();
    if (!row) return res.status(404).json({ error: 'Finding not found — refresh the check first.' });
    const meta = FINDING_META[row.code];
    if (!meta || !meta.ackable) {
      return res.status(400).json({ error: 'This finding needs a fix, not an acknowledgment.' });
    }
    await supabase.from('consistency_findings')
      .update({ status: 'acknowledged', note_category })
      .eq('id', row.id);
    track('review_item_resolved', {
      userId: req.userId, workspaceId: ws.id,
      properties: { kind: 'finding_ack', code: row.code, note_category },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/campaigns/:id — edit the brief / approve / change status.
router.patch('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const patch = briefPatch(req.body);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    // v9 SC-03: optimistic concurrency for autosave. When the client sends the
    // updated_at it last saw, a newer row (edited in another tab/device) is a
    // conflict — reject with 409 STALE and the current row so the client can
    // recover instead of silently clobbering a newer approved brief.
    if (req.body.expected_updated_at && campaign.updated_at &&
        req.body.expected_updated_at !== campaign.updated_at) {
      return res.status(409).json({
        error: 'This campaign was changed somewhere else. Reload to get the latest version before saving.',
        code: 'STALE',
        campaign,
      });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('campaigns').update(patch).eq('id', campaign.id).select().single();
    if (error) throw new Error(error.message);

    // v8 LB-S03: a material brief edit is a change-control event — recorded
    // with field CODES only (never values/content). Assets are NOT touched:
    // impact is derived on review, nothing propagates silently.
    const ALL_MATERIAL = [...new Set(Object.values(MATERIAL_FIELDS).flat())];
    const changedMaterial = ALL_MATERIAL.filter(
      (f) => f in patch && String(patch[f] ?? '') !== String(campaign[f] ?? ''));
    if (changedMaterial.length) {
      track('brief_change_detected', {
        userId: req.userId, workspaceId: ws.id,
        properties: { changed_field_codes: changedMaterial.join(','), fields: changedMaterial.length },
      });
    }
    // v8 LB-S09 funnel: brief approval is a once-per-campaign milestone. Deduped
    // so a repeated approve (or a re-save) can't inflate the funnel.
    if (patch.brief_approved === true && !campaign.brief_approved) {
      track('brief_approved', {
        userId: req.userId, workspaceId: ws.id, dedupeKey: `brief:${campaign.id}`,
        properties: { objective: campaign.objective || null },
      });
    }
    res.json({ campaign: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id — assets keep existing (campaign_id set null by FK).
// v5 Prompt 6: when the campaign still has assets, deletion needs explicit
// ?confirm=1 — archiving is the default suggestion.
router.delete('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (req.query.confirm !== '1') {
      let assetCount = 0;
      for (const t of ASSET_TABLES) {
        const { count } = await supabase
          .from(t).select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws.id).eq('campaign_id', campaign.id);
        assetCount += count || 0;
      }
      if (assetCount > 0) {
        return res.status(409).json({
          error: `This campaign has ${assetCount} linked asset${assetCount === 1 ? '' : 's'}. Archive it instead, or confirm deletion (assets are kept but unlinked).`,
          code: 'CONFIRM_DELETE',
          assets: assetCount,
        });
      }
    }

    await supabase.from('campaigns').delete().eq('id', campaign.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/duplicate — copy the brief (not assets/strategy).
router.post('/api/campaigns/:id/duplicate', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { id, created_at, updated_at, strategy, brief_approved, archived, asset_counts, workspace_id, ...brief } = campaign;
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ ...brief, name: `${campaign.name} (copy)`, workspace_id: ws.id, status: 'draft' })
      .select()
      .single();
    if (error) throw new Error('Failed to duplicate campaign: ' + error.message);
    res.status(201).json({ campaign: data });
  } catch (err) {
    next(err);
  }
});

// ── strategy generation (one AI action) ─────────────────────────────────────

const strategySchema = {
  type: 'object',
  properties: {
    core_message: { type: 'string', description: 'The single sentence every asset must reinforce.' },
    message_hierarchy: {
      type: 'array', minItems: 3, maxItems: 5,
      items: { type: 'string' },
      description: 'Supporting messages in priority order.',
    },
    proof_points: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
    objections: {
      type: 'array', minItems: 2, maxItems: 5,
      items: {
        type: 'object',
        properties: { objection: { type: 'string' }, answer: { type: 'string' } },
        required: ['objection', 'answer'],
        additionalProperties: false,
      },
    },
    calendar: {
      type: 'array', minItems: 3, maxItems: 14,
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', description: 'e.g. "Day 1" or a date if campaign dates are known.' },
          channel: { type: 'string', enum: ['email', 'social', 'ads', 'landing', 'other'] },
          action: { type: 'string' },
        },
        required: ['day', 'channel', 'action'],
        additionalProperties: false,
      },
    },
    cta: { type: 'string', description: 'The one primary CTA used across assets.' },
  },
  required: ['core_message', 'message_hierarchy', 'proof_points', 'objections', 'calendar', 'cta'],
  additionalProperties: false,
};

const STRATEGY_SYSTEM =
  'You are a campaign strategist for small brands. From the campaign brief, produce a strategy that every ' +
  'asset (landing copy, emails, social posts, ads) will share: one core message, a message hierarchy, real ' +
  'proof points (bracketed placeholders if unknown), the main objections with answers, a realistic ' +
  'channel-by-channel calendar within the campaign dates, and one primary CTA. Stay strictly consistent ' +
  'with the stated offer, discount terms and dates — never invent different ones.';

// POST /api/campaigns/:id/strategy — generate (or regenerate) the strategy.
router.post('/api/campaigns/:id/strategy', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const brand = await brandContextFor(ws.id);
    const brief = [
      `Campaign: ${campaign.name}`,
      campaign.objective ? `Objective: ${campaign.objective}` : null,
      campaign.audience ? `Audience: ${campaign.audience}` : null,
      campaign.offer_summary ? `Offer: ${campaign.offer_summary}` : null,
      campaign.products ? `Products: ${campaign.products}` : null,
      campaign.promo_terms ? `Promo terms: ${campaign.promo_terms}` : null,
      campaign.start_date ? `Dates: ${campaign.start_date} → ${campaign.end_date || 'open'}` : null,
      campaign.channels && campaign.channels.length ? `Channels: ${campaign.channels.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const result = await generateJson({
      system: STRATEGY_SYSTEM,
      prompt: brand.text + `Create the campaign strategy for this brief:\n\n${brief}`,
      schema: strategySchema,
      maxTokens: 4000,
    });
    req.usageInfo = result.__meta;

    const { data: saved, error } = await supabase
      .from('campaigns')
      .update({ strategy: result, updated_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({
      ok: true,
      campaign: saved,
      context_used: brand.summary,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Shared helper for asset routes: verifies campaign ownership and returns a
 * prompt block from the brief + approved strategy so all assets align.
 */
async function campaignContext(ws, campaignId) {
  if (!campaignId) return { text: '', campaign: null };
  const campaign = await ownedCampaign(ws, campaignId);
  if (!campaign) return { error: 'Campaign not found', status: 404 };

  const s = campaign.strategy || {};
  const text =
    'CAMPAIGN BRIEF — every asset must stay consistent with this (same offer, discount, dates, audience, CTA):\n' +
    [
      `Campaign: ${campaign.name}`,
      campaign.objective ? `Objective: ${campaign.objective}` : null,
      campaign.audience ? `Audience: ${campaign.audience}` : null,
      campaign.offer_summary ? `Offer: ${campaign.offer_summary}` : null,
      campaign.promo_terms ? `Promo terms: ${campaign.promo_terms}` : null,
      campaign.markets ? `Markets: ${campaign.markets}` : null,
      campaign.language ? `Language: ${campaign.language}` : null,
      campaign.key_message ? `Key message: ${campaign.key_message}` : null,
      campaign.proof ? `Proof: ${campaign.proof}` : null,
      campaign.restrictions ? `Restrictions: ${campaign.restrictions}` : null,
      campaign.start_date ? `Dates: ${campaign.start_date} → ${campaign.end_date || 'open'}` : null,
      campaign.deadline ? `Hard deadline: ${campaign.deadline}` : null,
      s.core_message ? `Core message: ${s.core_message}` : null,
      s.message_hierarchy ? `Message hierarchy: ${s.message_hierarchy.join(' | ')}` : null,
      s.cta ? `Primary CTA: ${s.cta}` : null,
    ].filter(Boolean).join('\n') + '\n\n';

  // v5 Prompt 6: brief snapshot stored on every generated asset so its
  // context is traceable even after the campaign changes.
  const snapshot = {
    campaign_id: campaign.id,
    name: campaign.name,
    objective: campaign.objective || null,
    audience: campaign.audience || null,
    offer_summary: campaign.offer_summary || null,
    promo_terms: campaign.promo_terms || null,
    key_message: campaign.key_message || null,
    restrictions: campaign.restrictions || null,
    start_date: campaign.start_date || null,
    end_date: campaign.end_date || null,
    deadline: campaign.deadline || null,
    snapshot_at: new Date().toISOString(),
  };

  return { text, campaign, snapshot };
}

module.exports = router;
module.exports.campaignContext = campaignContext;
