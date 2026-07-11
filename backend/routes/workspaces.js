// ---------------------------------------------------------------------------
// Workspaces + onboarding answers.
//
// No Supabase Auth here (same as ConversionForge): the HMAC session email is
// the identity, so workspaces hang off user_email. MVP: one workspace per
// account, get-or-create on first touch.
// ---------------------------------------------------------------------------

const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

/** Get-or-create the caller's workspace. */
async function ensureWorkspace(email, name) {
  const { data: existing } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_email', email)
    .limit(1)
    .single();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('workspaces')
    .insert({ user_email: email, name: name || 'My business' })
    .select()
    .single();
  if (error) throw new Error('Failed to create workspace: ' + error.message);
  return created;
}

/** 404s unless the workspace exists and belongs to the caller. */
async function ownedWorkspace(workspaceId, email) {
  const { data } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .eq('user_email', email)
    .single();
  return data || null;
}

// GET /api/workspace — the caller's workspace + latest onboarding/positioning
router.get('/api/workspace', requireAuth, async (req, res, next) => {
  try {
    const ws = await ensureWorkspace(req.userEmail);
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
    const ws = await ensureWorkspace(req.userEmail);
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
    const ws = await ensureWorkspace(req.userEmail);
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
    const ws = await ensureWorkspace(req.userEmail);
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

// GET /api/workspace/launch-kits/:id — one full launch kit
router.get('/api/workspace/launch-kits/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await ensureWorkspace(req.userEmail);
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

module.exports = router;
module.exports.ensureWorkspace = ensureWorkspace;
module.exports.ownedWorkspace = ownedWorkspace;
