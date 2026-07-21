// ---------------------------------------------------------------------------
// v8 LB-S04: evidence locker. Reusable, user-recorded proof references —
// Scalvya never scrapes a source or asserts that it is true; the record
// keeps WHO checked WHAT and WHEN so review work is not repeated per asset.
// One evidence record can be linked to many assets without copying its text.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { resolveWorkspace } = require('./workspaces');
const { track } = require('../lib/analytics');
const { MATERIAL_FIELDS } = require('../lib/brief-impact');

router.use(express.json({ limit: '16kb' }));

const EVIDENCE_TYPES = ['review', 'testimonial', 'statistic', 'certification', 'press', 'internal_data', 'other'];

// Only plain http(s) URLs are stored; javascript:/data:/anything else is
// rejected so an exported manifest can never carry an executable link.
function sanitizeUrl(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  const s = String(raw).trim().slice(0, 500);
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false };
  }
}

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function evidencePatch(body) {
  const b = body || {};
  const patch = {};
  if (typeof b.type === 'string' && EVIDENCE_TYPES.includes(b.type)) patch.type = b.type;
  if (typeof b.label === 'string') patch.label = b.label.trim().slice(0, 200);
  if (typeof b.permitted_claim === 'string') patch.permitted_claim = b.permitted_claim.trim().slice(0, 1000);
  if (typeof b.source_ref === 'string') patch.source_ref = b.source_ref.trim().slice(0, 300);
  if ('source_url' in b) {
    const url = sanitizeUrl(b.source_url);
    if (!url.ok) return { error: 'source_url must be a plain http(s) URL.' };
    patch.source_url = url.value;
  }
  for (const k of ['checked_date', 'review_by_date']) {
    if (b[k] === null) patch[k] = null;
    else if (typeof b[k] === 'string' && DATE_RX.test(b[k])) patch[k] = b[k];
  }
  if (typeof b.archived === 'boolean') patch.archived = b.archived;
  return { patch };
}

// GET /api/evidence — workspace evidence with link counts.
router.get('/api/evidence', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { data: rows } = await supabase
      .from('evidence').select('*').eq('workspace_id', ws.id)
      .order('created_at', { ascending: false });
    const { data: links } = await supabase
      .from('asset_evidence_links').select('evidence_id, asset_table, asset_id, campaign_id')
      .eq('workspace_id', ws.id);
    const linksByEvidence = {};
    for (const l of links || []) (linksByEvidence[l.evidence_id] = linksByEvidence[l.evidence_id] || []).push(l);
    res.json({
      evidence: (rows || []).map((r) => ({ ...r, links: linksByEvidence[r.id] || [] })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/evidence — record a piece of evidence (user-checked, dated).
router.post('/api/evidence', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const { patch, error: perr } = evidencePatch(req.body);
    if (perr) return res.status(400).json({ error: perr });
    if (!patch.label) return res.status(400).json({ error: 'Give the evidence a label.' });
    if (!patch.type) patch.type = 'other';
    if (!patch.checked_date) return res.status(400).json({ error: 'Record the date you checked this evidence.' });

    const { data, error } = await supabase
      .from('evidence').insert({ workspace_id: ws.id, ...patch }).select().single();
    if (error) throw new Error('Failed to save evidence: ' + error.message);
    track('evidence_added', { userId: req.userId, workspaceId: ws.id, properties: { type: patch.type } });
    res.status(201).json({ evidence: data });
  } catch (err) {
    next(err);
  }
});

async function ownedEvidence(ws, id) {
  const { data } = await supabase.from('evidence').select('*').eq('id', id).eq('workspace_id', ws.id).single();
  return data || null;
}

// PATCH /api/evidence/:id — edit or archive (soft delete).
router.patch('/api/evidence/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const row = await ownedEvidence(ws, req.params.id);
    if (!row) return res.status(404).json({ error: 'Evidence not found' });
    const { patch, error: perr } = evidencePatch(req.body);
    if (perr) return res.status(400).json({ error: perr });
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    const { data, error } = await supabase
      .from('evidence').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ evidence: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/evidence/:id/link — link this evidence to one asset (reusable
// across many assets; evidence text is never copied into asset rows).
router.post('/api/evidence/:id/link', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const row = await ownedEvidence(ws, req.params.id);
    if (!row) return res.status(404).json({ error: 'Evidence not found' });

    const { asset_table, asset_id } = req.body || {};
    if (!MATERIAL_FIELDS[asset_table] || typeof asset_id !== 'string') {
      return res.status(400).json({ error: 'Send asset_table and asset_id.' });
    }
    const { data: asset } = await supabase
      .from(asset_table).select('id, campaign_id')
      .eq('id', asset_id).eq('workspace_id', ws.id).single();
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const { error } = await supabase.from('asset_evidence_links').upsert({
      workspace_id: ws.id, evidence_id: row.id,
      campaign_id: asset.campaign_id || null,
      asset_table, asset_id,
    }, { onConflict: 'evidence_id,asset_table,asset_id' });
    if (error) throw new Error('Failed to link evidence: ' + error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/evidence/:id/link — unlink from one asset.
router.delete('/api/evidence/:id/link', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const row = await ownedEvidence(ws, req.params.id);
    if (!row) return res.status(404).json({ error: 'Evidence not found' });
    const { asset_table, asset_id } = req.body || {};
    await supabase.from('asset_evidence_links').delete()
      .eq('workspace_id', ws.id).eq('evidence_id', row.id)
      .eq('asset_table', String(asset_table)).eq('asset_id', String(asset_id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.sanitizeUrl = sanitizeUrl;
