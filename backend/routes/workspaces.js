// ---------------------------------------------------------------------------
// Workspaces + onboarding answers.
//
// Ownership is keyed on the stable Supabase Auth user id (audit Prompt 3):
// changing an email must not orphan data. workspaces.user_id is the primary
// owner key; user_email is kept for display and legacy backfill. MVP: one
// workspace per account, get-or-create on first touch.
// ---------------------------------------------------------------------------

const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

/**
 * Get-or-create the caller's workspace, keyed on the stable user_id when we
 * have one (email is a fallback for pre-migration rows). Always stamps user_id
 * on the resolved row so legacy workspaces get backfilled on first touch.
 */
async function ensureWorkspace(email, userId, name) {
  // Prefer the stable id.
  if (userId) {
    const { data: byId } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .single();
    if (byId) return byId;
  }

  // Legacy row created before user_id existed: adopt it and stamp the id.
  if (email) {
    const { data: byEmail } = await supabase
      .from('workspaces')
      .select('*')
      .is('user_id', null)
      .eq('user_email', email)
      .limit(1)
      .single();
    if (byEmail) {
      if (userId) {
        const { data: adopted } = await supabase
          .from('workspaces')
          .update({ user_id: userId })
          .eq('id', byEmail.id)
          .select()
          .single();
        return adopted || byEmail;
      }
      return byEmail;
    }
  }

  const { data: created, error } = await supabase
    .from('workspaces')
    .insert({ user_id: userId || null, user_email: email, name: name || 'My business' })
    .select()
    .single();
  if (error) throw new Error('Failed to create workspace: ' + error.message);
  return created;
}

/**
 * 404s unless the workspace exists and belongs to the caller. Matches on
 * user_id first (stable), falling back to user_email for un-backfilled rows.
 */
async function ownedWorkspace(workspaceId, email, userId) {
  let q = supabase.from('workspaces').select('*').eq('id', workspaceId);
  if (userId) {
    const { data } = await q.eq('user_id', userId).single();
    if (data) return data;
  }
  if (email) {
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .eq('user_email', email)
      .single();
    return data || null;
  }
  return null;
}

/** List the caller's non-archived workspaces (oldest first). */
async function listWorkspaces(userId, { includeArchived = false } = {}) {
  let q = supabase.from('workspaces').select('*').eq('user_id', userId);
  if (!includeArchived) q = q.eq('archived', false);
  const { data } = await q.order('created_at', { ascending: true });
  return data || [];
}

/**
 * Resolve the workspace a request should act on: the client-supplied
 * X-Workspace-Id when the caller owns it and it isn't archived, otherwise the
 * caller's first active workspace (get-or-create). Every route uses this so a
 * workspace is only ever touched by its owner.
 */
async function resolveWorkspace(req) {
  const wanted =
    req.get('x-workspace-id') ||
    (req.body && req.body.workspace_id) ||
    (req.query && req.query.workspace_id);

  if (wanted) {
    const owned = await ownedWorkspace(wanted, req.userEmail, req.userId);
    if (owned && !owned.archived) return owned;
  }
  const active = await listWorkspaces(req.userId);
  if (active[0]) return active[0];
  return ensureWorkspace(req.userEmail, req.userId);
}

// ── workspace CRUD (Prompt 7) ───────────────────────────────────────────────

// GET /api/workspaces — list active (+ archived) workspaces for the switcher.
router.get('/api/workspaces', requireAuth, async (req, res, next) => {
  try {
    const workspaces = await listWorkspaces(req.userId, { includeArchived: true });
    res.json({ workspaces });
  } catch (err) {
    next(err);
  }
});

// POST /api/workspaces — create a new workspace, enforcing the plan's cap.
router.post('/api/workspaces', requireAuth, express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const { planFor } = require('./customers');
    const { limitsFor } = require('../lib/plan-limits');
    const plan = (await planFor(req.userEmail)) || 'free';
    const max = limitsFor(plan).workspaces;

    const active = await listWorkspaces(req.userId);
    if (active.length >= max) {
      return res.status(402).json({
        error: `Your ${limitsFor(plan).label} plan allows ${max} workspace${max === 1 ? '' : 's'}. Upgrade for more.`,
        code: 'UPGRADE',
        feature: 'workspaces',
        used: active.length,
        limit: max,
        plan,
      });
    }

    const name = String((req.body || {}).name || '').trim().slice(0, 80) || 'New workspace';
    const { data: created, error } = await supabase
      .from('workspaces')
      .insert({ user_id: req.userId, user_email: req.userEmail, name })
      .select()
      .single();
    if (error) throw new Error('Failed to create workspace: ' + error.message);
    res.status(201).json({ workspace: created });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/workspaces/:id — rename or archive/unarchive.
router.patch('/api/workspaces/:id', requireAuth, express.json({ limit: '2kb' }), async (req, res, next) => {
  try {
    const owned = await ownedWorkspace(req.params.id, req.userEmail, req.userId);
    if (!owned) return res.status(404).json({ error: 'Workspace not found' });

    const patch = {};
    const b = req.body || {};
    if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 80) || owned.name;
    if (typeof b.archived === 'boolean') {
      // Never archive the caller's last active workspace.
      if (b.archived) {
        const active = await listWorkspaces(req.userId);
        if (active.length <= 1) {
          return res.status(400).json({ error: 'You must keep at least one active workspace.' });
        }
      }
      patch.archived = b.archived;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const { data, error } = await supabase
      .from('workspaces')
      .update(patch)
      .eq('id', owned.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json({ workspace: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/workspaces/:id — delete a workspace and its data (not the last one).
router.delete('/api/workspaces/:id', requireAuth, async (req, res, next) => {
  try {
    const owned = await ownedWorkspace(req.params.id, req.userEmail, req.userId);
    if (!owned) return res.status(404).json({ error: 'Workspace not found' });

    const all = await listWorkspaces(req.userId, { includeArchived: true });
    if (all.length <= 1) {
      return res.status(400).json({ error: 'You can’t delete your only workspace.' });
    }

    const { deleteWorkspaceData } = require('../lib/workspace-data');
    await deleteWorkspaceData(owned.id);
    await supabase.from('workspaces').delete().eq('id', owned.id).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Brand Profile (Prompt 9) ────────────────────────────────────────────────

// GET /api/workspace/brand-profile
router.get('/api/workspace/brand-profile', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data } = await supabase
      .from('brand_profiles')
      .select('data, updated_at')
      .eq('workspace_id', ws.id)
      .single();
    res.json({ workspace_id: ws.id, profile: (data && data.data) || {}, updated_at: (data && data.updated_at) || null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/workspace/brand-profile — upsert (autosave from the guided form).
router.put('/api/workspace/brand-profile', requireAuth, express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const profile = (req.body && typeof req.body === 'object') ? (req.body.profile || req.body) : {};
    const { data, error } = await supabase
      .from('brand_profiles')
      .upsert(
        { workspace_id: ws.id, data: profile, updated_at: new Date().toISOString() },
        { onConflict: 'workspace_id' }
      )
      .select('data, updated_at')
      .single();
    if (error) throw new Error('Failed to save brand profile: ' + error.message);
    res.json({ ok: true, profile: data.data, updated_at: data.updated_at });
  } catch (err) {
    next(err);
  }
});

// GET /api/workspace — the caller's workspace + latest onboarding/positioning
router.get('/api/workspace', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const [{ data: onboarding }, { data: positioning }] = await Promise.all([
      supabase.from('onboarding_answers').select('*').eq('workspace_id', ws.id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('positioning_outputs').select('*').eq('workspace_id', ws.id)
        .order('created_at', { ascending: false }).limit(1).single(),
    ]);
    res.json({ workspace: ws, onboarding: onboarding || null, positioning: positioning || null });
  } catch (err) {
    next(err);
  }
});

// POST /api/workspace/onboarding — save (replace) onboarding answers
router.post('/api/workspace/onboarding', requireAuth, express.json({ limit: '32kb' }), async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const b = req.body || {};
    const row = {
      workspace_id: ws.id,
      skills: String(b.skills || ''),
      interests: String(b.interests || ''),
      experience: String(b.experience || ''),
      audience_ideas: String(b.audience_ideas || ''),
      product_type: String(b.product_type || ''),
      current_stage: String(b.current_stage || ''),
      main_goal: String(b.main_goal || ''),
      weekly_time_available: String(b.weekly_time_available || ''),
      biggest_challenge: String(b.biggest_challenge || ''),
      platforms: Array.isArray(b.platforms) ? b.platforms.map(String) : [],
    };
    if (!row.skills && !row.interests && !row.product_type) {
      return res.status(400).json({ error: 'Tell us at least your skills, interests, or product type.' });
    }
    const { data, error } = await supabase.from('onboarding_answers').insert(row).select().single();
    if (error) throw new Error('Failed to save onboarding: ' + error.message);
    res.status(201).json({ ok: true, onboarding: data });
  } catch (err) {
    next(err);
  }
});

// GET /api/workspace/offers — the caller's offers (newest first)
router.get('/api/workspace/offers', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .eq('workspace_id', ws.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ offers: data || [] });
  } catch (err) {
    next(err);
  }
});

// GET /api/workspace/launch-kits — the caller's launch kits (newest first)
router.get('/api/workspace/launch-kits', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data, error } = await supabase
      .from('launch_kits')
      .select('id, offer_id, title, summary, created_at, updated_at')
      .eq('workspace_id', ws.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ launch_kits: data || [] });
  } catch (err) {
    next(err);
  }
});

// GET /api/workspace/dashboard — everything the Prompt 10 dashboard needs in
// one round trip: brand snapshot, current offer, this week's tasks, latest
// kit, and progress counts. All real Supabase data with nulls for empty state.
router.get('/api/workspace/dashboard', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);

    const [
      { data: onboarding },
      { data: positioning },
      { data: offers },
      { data: kit },
    ] = await Promise.all([
      supabase.from('onboarding_answers').select('*').eq('workspace_id', ws.id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('positioning_outputs').select('*').eq('workspace_id', ws.id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('offers').select('*').eq('workspace_id', ws.id)
        .order('created_at', { ascending: false }).limit(3),
      supabase.from('launch_kits').select('id, offer_id, title, summary, landing_page, created_at')
        .eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(1).single(),
    ]);

    // Prefer the offer the user actually picked (status=active), else newest.
    const offer = (offers || []).find((o) => o.status === 'active') || (offers || [])[0] || null;

    let thisWeek = [];
    let progress = null;
    if (kit) {
      const [tasks, contentCount, emailCount] = await Promise.all([
        supabase.from('weekly_tasks').select('*').eq('launch_kit_id', kit.id)
          .order('created_at', { ascending: true }),
        supabase.from('content_items').select('id', { count: 'exact', head: true })
          .eq('launch_kit_id', kit.id),
        supabase.from('email_items').select('id', { count: 'exact', head: true })
          .eq('launch_kit_id', kit.id),
      ]);
      const all = tasks.data || [];

      // Prompt 10 mix: 3 content, 2 sales, 1 website, 1 review — open tasks first.
      const open = all.filter((t) => !t.completed);
      const pick = (re, n) => open.filter((t) => re.test(`${t.task_type} ${t.task_title}`)).slice(0, n);
      const picked = [
        ...pick(/content|post|video|caption|social/i, 3),
        ...pick(/sale|outreach|dm|pitch|client|lead/i, 2),
        ...pick(/site|landing|page|seo|web/i, 1),
        ...pick(/review|reflect|measure|analy/i, 1),
      ];
      // De-dupe while keeping order, top up with any remaining open tasks.
      const seen = new Set();
      thisWeek = [...picked, ...open]
        .filter((t) => !seen.has(t.id) && seen.add(t.id))
        .slice(0, 7);

      progress = {
        posts_planned: contentCount.count || 0,
        emails_drafted: emailCount.count || 0,
        landing_page_ready: !!kit.landing_page,
        tasks_completed: all.filter((t) => t.completed).length,
        tasks_total: all.length,
      };
    }

    res.json({
      workspace: ws,
      onboarding: onboarding || null,
      positioning: positioning || null,
      offer,
      offers_count: (offers || []).length,
      kit: kit ? { id: kit.id, title: kit.title, summary: kit.summary, created_at: kit.created_at } : null,
      this_week: thisWeek,
      progress,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/workspace/launch-kits/:id/section — save a user-edited section
// Body: { section, data }. Edits are the user's own words: we only check the
// section name and ownership, not the AI schema.
const EDITABLE_SECTIONS = ['landing_page', 'content_plan', 'email_sequence', 'ads_kit', 'seo_kit', 'weekly_plan'];

router.patch(
  '/api/workspace/launch-kits/:id/section',
  requireAuth,
  express.json({ limit: '256kb' }),
  async (req, res, next) => {
    try {
      const { section, data } = req.body || {};
      if (!EDITABLE_SECTIONS.includes(section)) {
        return res.status(400).json({ error: 'section must be one of: ' + EDITABLE_SECTIONS.join(', ') });
      }
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'data object is required' });
      }
      const ws = await resolveWorkspace(req);
      const { data: kit } = await supabase
        .from('launch_kits')
        .select('id')
        .eq('id', req.params.id)
        .eq('workspace_id', ws.id)
        .single();
      if (!kit) return res.status(404).json({ error: 'Launch kit not found' });

      const { error } = await supabase
        .from('launch_kits')
        .update({ [section]: data })
        .eq('id', kit.id);
      if (error) throw new Error('Failed to save section: ' + error.message);

      res.json({ ok: true, section });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/workspace/launch-kits/:id — one full launch kit
router.get('/api/workspace/launch-kits/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data, error } = await supabase
      .from('launch_kits')
      .select('*')
      .eq('id', req.params.id)
      .eq('workspace_id', ws.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Launch kit not found' });
    res.json({ launch_kit: data });
  } catch (err) {
    next(err);
  }
});

// GET /api/workspace/launch-kits/:id/quality — Prompt 27 quality scores +
// Prompt 28 safety scan for the kit's sections and its offer.
const {
  scoreOfferQuality,
  scoreLandingPageQuality,
  scoreContentPlanQuality,
  scoreEmailSequenceQuality,
  creativeReadyGate,
} = require('../lib/quality-checks');
const { safetyCheck } = require('../lib/safety-check');

router.get('/api/workspace/launch-kits/:id/quality', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data: kit } = await supabase
      .from('launch_kits')
      .select('*')
      .eq('id', req.params.id)
      .eq('workspace_id', ws.id)
      .single();
    if (!kit) return res.status(404).json({ error: 'Launch kit not found' });

    const { data: offer } = await supabase
      .from('offers')
      .select('*')
      .eq('id', kit.offer_id)
      .eq('workspace_id', ws.id)
      .single();

    res.json({
      quality: {
        offer: offer ? scoreOfferQuality(offer) : null,
        landing_page: scoreLandingPageQuality(kit.landing_page || {}),
        content_plan: scoreContentPlanQuality(kit.content_plan || {}, offer || {}),
        email_sequence: scoreEmailSequenceQuality(kit.email_sequence || {}, offer || {}),
      },
      safety: {
        landing_page: safetyCheck(kit.landing_page),
        content_plan: safetyCheck(kit.content_plan),
        email_sequence: safetyCheck(kit.email_sequence),
        ads_kit: safetyCheck(kit.ads_kit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Per-item endpoints for the Studios (Prompts 19-23). The item tables are
// populated by the AI routes when a kit is generated; here users list them,
// edit fields, and flip status (planned/done/skipped, ready, selected...).
// ---------------------------------------------------------------------------

const ITEM_TABLES = {
  content_items: {
    order: 'day_number',
    editable: ['platform', 'content_type', 'topic', 'hook', 'caption_angle', 'cta', 'goal', 'status'],
  },
  email_items: {
    order: 'sequence_order',
    editable: ['email_type', 'subject_line', 'preheader', 'main_angle', 'body_outline', 'cta', 'status'],
  },
  ad_ideas: {
    order: 'created_at',
    editable: ['ad_type', 'hook', 'primary_text', 'headline', 'visual_direction', 'cta', 'status'],
  },
  seo_items: {
    order: 'created_at',
    editable: ['keyword', 'page_type', 'title', 'meta_description', 'content_angle', 'priority', 'status'],
  },
  weekly_tasks: {
    order: 'created_at',
    editable: ['task_type', 'task_title', 'task_description', 'priority', 'completed', 'week_start'],
  },
  // Upgrade 004 marketing-asset tables — power the new generator studios
  // (list saved assets, edit fields, flip status: draft/edited/ready/published).
  website_pages: {
    order: 'created_at',
    editable: ['page_type', 'title', 'seo_title', 'meta_description', 'sections', 'cta', 'status'],
  },
  email_assets: {
    order: 'created_at',
    editable: ['flow_type', 'email_order', 'subject_line', 'preheader', 'headline', 'body_copy', 'cta', 'send_timing', 'segment', 'design_notes', 'status'],
  },
  social_assets: {
    order: 'created_at',
    editable: ['platform', 'content_type', 'hook', 'caption', 'cta', 'visual_direction', 'hashtags', 'status'],
  },
  creative_assets: {
    order: 'created_at',
    editable: ['platform', 'creative_type', 'angle', 'hook', 'headline', 'primary_text', 'visual_direction', 'designer_notes', 'shot_list', 'text_overlays', 'cta', 'testing_angle', 'compliance_ack', 'status'],
  },
  seo_assets: {
    order: 'created_at',
    editable: ['page_type', 'keyword', 'keyword_intent', 'seo_title', 'meta_description', 'h1', 'h2s', 'faq', 'internal_links', 'priority'],
  },
};

// GET /api/workspace/items/:table?launch_kit_id=... — list a studio's items
router.get('/api/workspace/items/:table', requireAuth, async (req, res, next) => {
  try {
    const cfg = ITEM_TABLES[req.params.table];
    if (!cfg) return res.status(400).json({ error: 'Unknown item table' });
    const ws = await resolveWorkspace(req);

    let q = supabase.from(req.params.table).select('*').eq('workspace_id', ws.id);
    if (req.query.launch_kit_id) q = q.eq('launch_kit_id', req.query.launch_kit_id);
    const { data, error } = await q.order(cfg.order, { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ items: data || [] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/workspace/items/:table/:id — edit fields / status of one item
router.patch(
  '/api/workspace/items/:table/:id',
  requireAuth,
  express.json({ limit: '32kb' }),
  async (req, res, next) => {
    try {
      const cfg = ITEM_TABLES[req.params.table];
      if (!cfg) return res.status(400).json({ error: 'Unknown item table' });
      const ws = await resolveWorkspace(req);

      // Only allow whitelisted, present fields — never workspace_id/id/kit id.
      const updates = {};
      for (const k of cfg.editable) {
        if (k in (req.body || {})) updates[k] = req.body[k];
      }
      // v6 Prompt 24: an acknowledgement carries its proof source — a bare
      // checkbox cannot legalize a high-risk claim.
      if (typeof updates.compliance_ack === 'boolean') {
        updates.compliance_ack = {
          acknowledged: updates.compliance_ack,
          proof_source: typeof (req.body || {}).compliance_proof === 'string' ? req.body.compliance_proof.trim().slice(0, 500) : '',
          at: new Date().toISOString(),
        };
      }
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      // v5 Prompt 11: block unsupported proof / fake scarcity from "ready".
      if (req.params.table === 'creative_assets' && (updates.status === 'ready' || updates.status === 'published')) {
        const { data: row } = await supabase.from('creative_assets')
          .select('*').eq('id', req.params.id).eq('workspace_id', ws.id).single();
        if (row) {
          const gate = creativeReadyGate({ ...row, ...updates });
          if (!gate.ok) return res.status(409).json({ error: gate.reason, code: 'COMPLIANCE_ACK' });
        }
      }

      const { data, error } = await supabase
        .from(req.params.table)
        .update(updates)
        .eq('id', req.params.id)
        .eq('workspace_id', ws.id) // ownership: service_role bypasses RLS
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: 'Item not found' });
      res.json({ ok: true, item: data });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/workspace/items/weekly_tasks — add a custom weekly task (Prompt 23)
router.post(
  '/api/workspace/items/weekly_tasks',
  requireAuth,
  express.json({ limit: '8kb' }),
  async (req, res, next) => {
    try {
      const ws = await resolveWorkspace(req);
      const b = req.body || {};
      if (!b.launch_kit_id) return res.status(400).json({ error: 'launch_kit_id is required' });
      if (!b.task_title) return res.status(400).json({ error: 'task_title is required' });
      const row = {
        workspace_id: ws.id,
        launch_kit_id: b.launch_kit_id,
        task_type: String(b.task_type || 'custom'),
        task_title: String(b.task_title),
        task_description: String(b.task_description || ''),
        priority: ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
        completed: false,
      };
      const { data, error } = await supabase.from('weekly_tasks').insert(row).select().single();
      if (error) throw new Error(error.message);
      res.status(201).json({ ok: true, item: data });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
module.exports.ensureWorkspace = ensureWorkspace;
module.exports.ownedWorkspace = ownedWorkspace;
module.exports.resolveWorkspace = resolveWorkspace;
module.exports.listWorkspaces = listWorkspaces;
