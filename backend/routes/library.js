// ---------------------------------------------------------------------------
// Asset Library (audit Prompt 13): one searchable place for everything the
// studios generate — filters, pagination, favourites, archive, rename,
// duplicate, delete, bulk archive, immutable version history with restore, and
// section-level AI rewrites. Every operation is ownership-scoped.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { planGate, usageFor } = require('../lib/plan-limits');
const { generateJson } = require('../lib/ai');
const { brandContextFor } = require('../lib/brand-profile');
const { creativeReadyGate } = require('../lib/quality-checks');
const { resolveWorkspace } = require('./workspaces');

router.use(express.json({ limit: '32kb' }));

// Per-table config: display title field, search/snippet fields, and which text
// fields the AI rewrite operates on.
const TABLES = {
  website_pages: {
    label: 'Website page',
    titleField: 'title',
    searchFields: ['title', 'seo_title', 'meta_description', 'cta'],
    rewriteFields: ['title', 'seo_title', 'meta_description', 'cta'],
  },
  email_assets: {
    label: 'Email',
    titleField: 'subject_line',
    searchFields: ['subject_line', 'headline', 'body_copy', 'cta'],
    rewriteFields: ['subject_line', 'preheader', 'headline', 'body_copy', 'cta'],
  },
  social_assets: {
    label: 'Social post',
    titleField: 'hook',
    searchFields: ['hook', 'caption', 'cta'],
    rewriteFields: ['hook', 'caption', 'cta'],
  },
  creative_assets: {
    label: 'Ad creative',
    titleField: 'headline',
    searchFields: ['hook', 'headline', 'primary_text', 'cta'],
    rewriteFields: ['hook', 'headline', 'primary_text', 'cta'],
  },
  seo_assets: {
    label: 'SEO asset',
    titleField: 'seo_title',
    searchFields: ['keyword', 'seo_title', 'meta_description', 'h1'],
    rewriteFields: ['seo_title', 'meta_description', 'h1'],
  },
};

function tableConfig(table, res) {
  const cfg = TABLES[table];
  if (!cfg) {
    res.status(400).json({ error: 'Unknown asset type.' });
    return null;
  }
  return cfg;
}

async function ownedAsset(ws, table, id) {
  const { data } = await supabase.from(table).select('*').eq('id', id).eq('workspace_id', ws.id).single();
  return data || null;
}

/** Snapshot the current row into asset_versions (immutable history). */
async function snapshot(ws, table, row) {
  await supabase.from('asset_versions').insert({
    workspace_id: ws.id,
    asset_table: table,
    asset_id: row.id,
    // Deep copy so later in-process mutation can't alter the snapshot.
    snapshot: JSON.parse(JSON.stringify(row)),
  }).then(() => {}, () => {});
}

function normalize(table, cfg, row) {
  const text = cfg.searchFields.map((f) => row[f]).filter((v) => typeof v === 'string').join(' — ');
  return {
    table,
    type_label: cfg.label,
    id: row.id,
    title: row[cfg.titleField] || row.title || cfg.label,
    snippet: text.slice(0, 180),
    status: row.status || 'draft',
    favourite: !!row.favourite,
    archived: !!row.archived,
    campaign_id: row.campaign_id || null,
    launch_kit_id: row.launch_kit_id || null,
    generation_run_id: row.generation_run_id || null,
    created_at: row.created_at,
  };
}

// GET /api/assets/library?type=&status=&campaign_id=&favourite=&archived=&q=&page=&per=
router.get('/api/assets/library', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const q = req.query || {};
    const wanted = q.type && TABLES[q.type] ? [q.type] : Object.keys(TABLES);
    const search = String(q.q || '').toLowerCase().slice(0, 100);
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const per = Math.min(100, Math.max(5, parseInt(q.per, 10) || 25));

    let items = [];
    for (const table of wanted) {
      const cfg = TABLES[table];
      let query = supabase.from(table).select('*').eq('workspace_id', ws.id);
      if (q.campaign_id) query = query.eq('campaign_id', q.campaign_id);
      if (q.status) query = query.eq('status', q.status);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
      if (error) continue; // missing table/column (migration pending) — skip
      for (const row of data || []) {
        const n = normalize(table, cfg, row);
        if (q.favourite === 'true' && !n.favourite) continue;
        // archived hidden unless explicitly requested
        if (q.archived === 'true' ? !n.archived : n.archived) continue;
        if (search && !(`${n.title} ${n.snippet}`.toLowerCase().includes(search))) continue;
        items.push(n);
      }
    }

    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = items.length;
    items = items.slice((page - 1) * per, page * per);

    res.json({ items, total, page, per });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/assets/library/:table/:id — edit fields (snapshots previous state).
router.patch('/api/assets/library/:table/:id', requireAuth, async (req, res, next) => {
  try {
    const cfg = tableConfig(req.params.table, res);
    if (!cfg) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });

    const b = req.body || {};
    const patch = {};
    // Library metadata
    if (typeof b.favourite === 'boolean') patch.favourite = b.favourite;
    if (typeof b.archived === 'boolean') patch.archived = b.archived;
    // v5 Prompt 11: record a compliance acknowledgement for high-risk creatives.
    if (b.compliance_ack === true) patch.compliance_ack = { acknowledged: true, at: new Date().toISOString() };
    else if (b.compliance_ack === false) patch.compliance_ack = { acknowledged: false, at: new Date().toISOString() };
    if (typeof b.status === 'string') {
      const nextStatus = b.status.slice(0, 30);
      // Block unsupported proof / fake scarcity from reaching "ready"/"published".
      if (req.params.table === 'creative_assets' && (nextStatus === 'ready' || nextStatus === 'published')) {
        const merged = { ...row, ...patch }; // include an ack applied in the same request
        const gate = creativeReadyGate(merged);
        if (!gate.ok) return res.status(409).json({ error: gate.reason, code: 'COMPLIANCE_ACK' });
      }
      patch.status = nextStatus;
    }
    // v5 Prompt 10: social calendar — plan an item on a date (or clear it)
    // without exporting. Scheduling metadata, so it never snapshots a version.
    if (b.planned_date === null) patch.planned_date = null;
    else if (typeof b.planned_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.planned_date)) {
      patch.planned_date = b.planned_date;
    }
    // v5 Prompt 6: attach/detach an existing asset to a campaign — the
    // campaign must belong to this workspace.
    if (b.campaign_id === null) patch.campaign_id = null;
    else if (typeof b.campaign_id === 'string') {
      const { data: camp } = await supabase.from('campaigns')
        .select('id').eq('id', b.campaign_id).eq('workspace_id', ws.id).single();
      if (!camp) return res.status(404).json({ error: 'Campaign not found' });
      patch.campaign_id = camp.id;
    }
    // Content edits: any rewriteFields are editable text
    let contentEdit = false;
    for (const f of cfg.rewriteFields) {
      if (typeof b[f] === 'string') { patch[f] = b[f]; contentEdit = true; }
    }
    if (typeof b.title === 'string' && cfg.titleField !== 'title') { patch[cfg.titleField] = b.title; contentEdit = true; }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    if (contentEdit) await snapshot(ws, req.params.table, row); // versions on content changes only

    const { data, error } = await supabase.from(req.params.table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, asset: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/assets/library/:table/:id/duplicate
router.post('/api/assets/library/:table/:id/duplicate', requireAuth, async (req, res, next) => {
  try {
    const cfg = tableConfig(req.params.table, res);
    if (!cfg) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });

    const copy = { ...row };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    copy.status = 'draft';
    copy.favourite = false;
    if (copy[cfg.titleField]) copy[cfg.titleField] = `${copy[cfg.titleField]} (copy)`;

    const { data, error } = await supabase.from(req.params.table).insert(copy).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json({ ok: true, asset: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/assets/library/:table/:id
router.delete('/api/assets/library/:table/:id', requireAuth, async (req, res, next) => {
  try {
    if (!tableConfig(req.params.table, res)) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });
    await snapshot(ws, req.params.table, row); // keep a last snapshot
    await supabase.from(req.params.table).delete().eq('id', row.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/assets/library/bulk — { action: 'archive'|'unarchive', items: [{table,id}] }
router.post('/api/assets/library/bulk', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { action, items } = req.body || {};
    if (!['archive', 'unarchive'].includes(action) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'action (archive|unarchive) and items are required.' });
    }
    let done = 0;
    for (const it of items.slice(0, 100)) {
      if (!TABLES[it.table]) continue;
      const row = await ownedAsset(ws, it.table, it.id);
      if (!row) continue;
      await supabase.from(it.table).update({ archived: action === 'archive' }).eq('id', row.id);
      done++;
    }
    res.json({ ok: true, updated: done });
  } catch (err) {
    next(err);
  }
});

// GET /api/assets/library/:table/:id/versions
router.get('/api/assets/library/:table/:id/versions', requireAuth, async (req, res, next) => {
  try {
    if (!tableConfig(req.params.table, res)) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });
    const { data } = await supabase
      .from('asset_versions').select('id, created_at, snapshot')
      .eq('workspace_id', ws.id).eq('asset_table', req.params.table).eq('asset_id', row.id)
      .order('created_at', { ascending: false }).limit(30);
    res.json({ versions: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/assets/library/:table/:id/restore — { version_id }
router.post('/api/assets/library/:table/:id/restore', requireAuth, async (req, res, next) => {
  try {
    const cfg = tableConfig(req.params.table, res);
    if (!cfg) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });

    const { data: version } = await supabase
      .from('asset_versions').select('*')
      .eq('id', (req.body || {}).version_id)
      .eq('workspace_id', ws.id).eq('asset_table', req.params.table).eq('asset_id', row.id)
      .single();
    if (!version) return res.status(404).json({ error: 'Version not found' });

    await snapshot(ws, req.params.table, row); // current state becomes a version too
    const restore = { ...version.snapshot };
    delete restore.id;
    delete restore.created_at;
    restore.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from(req.params.table).update(restore).eq('id', row.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ ok: true, asset: data });
  } catch (err) {
    next(err);
  }
});

// ── section-level AI rewrite (one metered action) ───────────────────────────

const REWRITE_MODES = {
  shorter: 'Make it noticeably shorter while keeping the core message.',
  longer: 'Expand it with more concrete detail (no fluff, no invented facts).',
  direct: 'Make it more direct and confident.',
  native: 'Make it read more natively and naturally in its language.',
  tone: 'Adjust the tone as instructed.',
  instruction: 'Apply the user instruction.',
};

// POST /api/ai/asset/:table/:id/rewrite — { mode, instruction? }
router.post('/api/ai/asset/:table/:id/rewrite', planGate('regenerate_section'), async (req, res, next) => {
  try {
    const cfg = tableConfig(req.params.table, res);
    if (!cfg) return;
    const ws = req.workspace;
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });

    const mode = String((req.body || {}).mode || 'instruction');
    const instruction = String((req.body || {}).instruction || '').slice(0, 500);
    const rule = REWRITE_MODES[mode] || REWRITE_MODES.instruction;

    const current = {};
    for (const f of cfg.rewriteFields) if (typeof row[f] === 'string') current[f] = row[f];

    const schema = {
      type: 'object',
      properties: Object.fromEntries(Object.keys(current).map((f) => [f, { type: 'string' }])),
      required: Object.keys(current),
      additionalProperties: false,
    };

    const brand = await brandContextFor(ws.id);
    const result = await generateJson({
      system: `You rewrite existing marketing copy. ${rule} Keep the same facts and offer — never invent new claims. Return every field, rewritten where relevant.`,
      prompt: brand.text +
        `Rewrite this ${cfg.label.toLowerCase()}${instruction ? `\nInstruction: ${instruction}` : ''}\n\nCurrent copy:\n` +
        JSON.stringify(current, null, 2),
      schema,
      maxTokens: 4000,
    });
    req.usageInfo = result.__meta;

    await snapshot(ws, req.params.table, row);
    const { data: saved, error } = await supabase.from(req.params.table)
      .update({ ...result, updated_at: new Date().toISOString() })
      .eq('id', row.id).select().single();
    if (error) throw new Error(error.message);

    res.json({ ok: true, asset: saved, usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
