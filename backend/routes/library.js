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
const { trackDeliverableProgress } = require('../lib/deliverables-track');
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

/**
 * Snapshot the current row into asset_versions (immutable history), recording
 * the source (edit | rewrite | restore | delete | generation) and author so
 * history is traceable. The brief snapshot already lives inside the row.
 */
async function snapshot(ws, table, row, { source = 'edit', author = null } = {}) {
  await supabase.from('asset_versions').insert({
    workspace_id: ws.id,
    asset_table: table,
    asset_id: row.id,
    source,
    author_email: author,
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
    // v5 Prompt 13: filterable facets (best-effort — not every table has each).
    platform: row.platform || null,
    language: row.target_language || row.language || (row.brief_snapshot && row.brief_snapshot.language) || null,
    product: (row.brief_snapshot && row.brief_snapshot.offer) || row.product || null,
    created_at: row.created_at,
    // v10 SC-02: what a campaign asset row must show without opening the asset —
    // when it last changed, and which brief version it was generated from (so a
    // stale asset is visible as stale). Derived, never a new stored field.
    updated_at: row.updated_at || null,
    brief_version: row.brief_version ?? (row.brief_snapshot && row.brief_snapshot.version) ?? null,
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

    // v10 SC-02: bounded retrieval. The previous implementation fetched up to
    // 500 rows PER TABLE and paginated in memory, so a workspace past that mark
    // silently dropped assets AND reported a wrong total. Filters that map to
    // real columns are now pushed to the database; the remainder (facets whose
    // column is not present on every table, and full-text search) still need a
    // scan, so that path is explicitly capped and reports `truncated` rather
    // than lying about the total.
    const needsScan = Boolean(search || q.platform || q.language || q.product);
    const SCAN_CAP = 1000; // per table; only reached by scan-mode filters

    // Predicates every asset table genuinely supports.
    const applyColumnFilters = (query) => {
      let out = query.eq('workspace_id', ws.id);
      if (q.campaign_id) out = out.eq('campaign_id', q.campaign_id);
      if (q.status) out = out.eq('status', q.status);
      if (q.favourite === 'true') out = out.eq('favourite', true);
      // Rows predating the archive column store NULL, which is not archived.
      out = q.archived === 'true' ? out.eq('archived', true) : out.or('archived.is.null,archived.eq.false');
      if (q.date_from) out = out.gte('created_at', q.date_from);
      if (q.date_to) out = out.lte('created_at', `${q.date_to}T23:59:59`);
      return out;
    };

    let items = [];
    let total = 0;
    let truncated = false;

    for (const table of wanted) {
      const cfg = TABLES[table];

      if (!needsScan) {
        // Exact count from the database — never derived from a fetched slice.
        const { count, error: countErr } = await applyColumnFilters(
          supabase.from(table).select('id', { count: 'exact', head: true })
        );
        if (countErr) continue; // missing table/column (migration pending) — skip
        total += count || 0;

        // Each table is ordered by created_at desc, so the globally newest
        // `page * per` rows are always contained in the first `page * per` rows
        // of each table. Fetching more than that cannot change this page.
        const needed = page * per;
        const { data, error } = await applyColumnFilters(supabase.from(table).select('*'))
          .order('created_at', { ascending: false })
          .range(0, needed - 1);
        if (error) continue;
        for (const row of data || []) items.push(normalize(table, cfg, row));
        continue;
      }

      // Scan mode: facet/search filters are evaluated in JS because the backing
      // column is not guaranteed to exist on every table.
      const { data, error } = await applyColumnFilters(supabase.from(table).select('*'))
        .order('created_at', { ascending: false })
        .range(0, SCAN_CAP - 1);
      if (error) continue;
      if ((data || []).length === SCAN_CAP) truncated = true;
      for (const row of data || []) {
        const n = normalize(table, cfg, row);
        // v5 Prompt 13: channel / language / product facets.
        if (q.platform && n.platform !== q.platform) continue;
        if (q.language && String(n.language || '').toLowerCase() !== String(q.language).toLowerCase()) continue;
        if (q.product && !String(n.product || '').toLowerCase().includes(String(q.product).toLowerCase())) continue;
        // Search title + full searchable content (not just the snippet).
        if (search) {
          const hay = `${n.title} ${cfg.searchFields.map((f) => row[f]).filter((v) => typeof v === 'string').join(' ')}`.toLowerCase();
          if (!hay.includes(search)) continue;
        }
        items.push(n);
        total += 1;
      }
    }

    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    items = items.slice((page - 1) * per, page * per);

    // `truncated` is true only when a scan hit its cap: the caller is told the
    // count is a floor rather than being handed a confidently wrong number.
    res.json({ items, total, page, per, truncated });
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
    // v9 SC-06: optimistic concurrency for the asset drawer's manual edits.
    // A stale expected_updated_at (edited elsewhere) is a conflict — reject with
    // 409 STALE and the current row instead of clobbering a newer version.
    if (b.expected_updated_at && row.updated_at && b.expected_updated_at !== row.updated_at) {
      return res.status(409).json({
        error: 'This asset was changed somewhere else. Reload it to get the latest version before saving.',
        code: 'STALE',
        asset: { ...row, table: req.params.table },
      });
    }
    const patch = {};
    // Library metadata
    if (typeof b.favourite === 'boolean') patch.favourite = b.favourite;
    if (typeof b.archived === 'boolean') patch.archived = b.archived;
    // v6 Prompt 24: acknowledging high-risk claims requires the actual proof
    // source (link or where the evidence lives) — a bare checkbox no longer
    // unlocks "ready". compliance_proof travels with compliance_ack.
    if (b.compliance_ack === true) {
      patch.compliance_ack = {
        acknowledged: true,
        proof_source: typeof b.compliance_proof === 'string' ? b.compliance_proof.trim().slice(0, 500) : '',
        at: new Date().toISOString(),
      };
    } else if (b.compliance_ack === false) patch.compliance_ack = { acknowledged: false, at: new Date().toISOString() };
    // v6 Prompt 25: researched keyword metrics are only stored with their
    // source AND date, recorded by the user — never by the generator.
    if (req.params.table === 'seo_assets' && ('metric_source' in b || 'metric_date' in b || 'metric_notes' in b)) {
      if (b.metric_source === null) { patch.metric_source = null; patch.metric_date = null; patch.metric_notes = null; }
      else {
        const src = typeof b.metric_source === 'string' ? b.metric_source.trim().slice(0, 300) : '';
        const date = typeof b.metric_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.metric_date) ? b.metric_date : '';
        if (!src || !date) {
          return res.status(400).json({ error: 'Keyword metrics need both a source and the date you looked them up.' });
        }
        patch.metric_source = src;
        patch.metric_date = date;
        if (typeof b.metric_notes === 'string') patch.metric_notes = b.metric_notes.slice(0, 1000);
      }
    }
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

    if (contentEdit) await snapshot(ws, req.params.table, row, { source: 'edit', author: req.userEmail }); // versions on content changes only

    const { data, error } = await supabase.from(req.params.table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id).select().single();
    if (error) throw new Error(error.message);

    // v8 LB-S01: server-confirmed deliverable progress — only after the user
    // moved an asset to ready/published (never fired from the client).
    if ((patch.status === 'ready' || patch.status === 'published') && row.status !== 'ready' && row.status !== 'published') {
      await trackDeliverableProgress({
        workspaceId: ws.id, userId: req.userId,
        campaignId: data.campaign_id, table: req.params.table, phase: 'ready',
      });
    }
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
    await snapshot(ws, req.params.table, row, { source: 'delete', author: req.userEmail }); // keep a last snapshot
    await supabase.from(req.params.table).delete().eq('id', row.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/assets/library/bulk
//   { action: 'archive'|'unarchive'|'status'|'campaign'|'delete', items: [{table,id}],
//     value?, campaign_id?, confirm? }
// Bulk permanent delete requires an explicit second confirmation (confirm: true).
router.post('/api/assets/library/bulk', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { action, items, value, campaign_id, confirm } = req.body || {};
    const ALLOWED = ['archive', 'unarchive', 'status', 'campaign', 'delete'];
    if (!ALLOWED.includes(action) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: `action (${ALLOWED.join('|')}) and items are required.` });
    }

    // Permanent delete is destructive — never without an explicit confirmation.
    if (action === 'delete' && confirm !== true) {
      return res.status(409).json({
        error: `Permanently delete ${items.length} asset(s)? This cannot be undone.`,
        code: 'CONFIRM_DELETE',
      });
    }

    // Validate a campaign belongs to this workspace before bulk-attaching.
    let campId = null;
    if (action === 'campaign' && campaign_id) {
      const { data: camp } = await supabase.from('campaigns')
        .select('id').eq('id', campaign_id).eq('workspace_id', ws.id).single();
      if (!camp) return res.status(404).json({ error: 'Campaign not found' });
      campId = camp.id;
    }

    let done = 0;
    for (const it of items.slice(0, 100)) {
      if (!TABLES[it.table]) continue;
      const row = await ownedAsset(ws, it.table, it.id);
      if (!row) continue;
      if (action === 'archive' || action === 'unarchive') {
        await supabase.from(it.table).update({ archived: action === 'archive' }).eq('id', row.id);
      } else if (action === 'status') {
        await supabase.from(it.table).update({ status: String(value || 'draft').slice(0, 30) }).eq('id', row.id);
      } else if (action === 'campaign') {
        await supabase.from(it.table).update({ campaign_id: campId }).eq('id', row.id);
      } else if (action === 'delete') {
        await snapshot(ws, it.table, row, { source: 'delete', author: req.userEmail });
        await supabase.from(it.table).delete().eq('id', row.id);
      }
      done++;
    }
    res.json({ ok: true, updated: done });
  } catch (err) {
    next(err);
  }
});

// v9 SC-06: GET /api/assets/library/:table/:id — full detail for the asset
// drawer, fetched on demand (the list stays bounded to snippets, no N+1). The
// editable text fields are named so the client can render + diff them.
router.get('/api/assets/library/:table/:id', requireAuth, async (req, res, next) => {
  try {
    const cfg = tableConfig(req.params.table, res);
    if (!cfg) return;
    const ws = await resolveWorkspace(req);
    const row = await ownedAsset(ws, req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Asset not found' });
    res.json({
      asset: { ...row, table: req.params.table, type_label: cfg.label },
      edit_fields: cfg.rewriteFields,
      title_field: cfg.titleField,
    });
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
      .from('asset_versions').select('id, created_at, snapshot, source, author_email')
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

    await snapshot(ws, req.params.table, row, { source: 'restore', author: req.userEmail }); // current state becomes a version too
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

    await snapshot(ws, req.params.table, row, { source: 'rewrite', author: req.userEmail });
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
