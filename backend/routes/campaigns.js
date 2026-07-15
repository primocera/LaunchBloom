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

router.use(express.json({ limit: '16kb' }));

const ASSET_TABLES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];

async function ownedCampaign(ws, id) {
  const { data } = await supabase.from('campaigns').select('*').eq('id', id).eq('workspace_id', ws.id).single();
  return data || null;
}

function briefPatch(body) {
  const patch = {};
  const b = body || {};
  const strings = ['name', 'objective', 'audience', 'offer_summary', 'products', 'promo_terms', 'status'];
  for (const k of strings) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, k === 'name' ? 120 : 4000);
  for (const k of ['start_date', 'end_date']) if (typeof b[k] === 'string') patch[k] = b[k] || null;
  if (Array.isArray(b.channels)) patch.channels = b.channels.map(String).slice(0, 8);
  if (typeof b.brief_approved === 'boolean') patch.brief_approved = b.brief_approved;
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

    const withCounts = await Promise.all((campaigns || []).map(async (c) => {
      const counts = {};
      await Promise.all(ASSET_TABLES.map(async (t) => {
        const { count, error } = await supabase
          .from(t).select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws.id).eq('campaign_id', c.id);
        counts[t] = error ? 0 : (count || 0);
      }));
      return { ...c, asset_counts: counts };
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

// PATCH /api/campaigns/:id — edit the brief / approve / change status.
router.patch('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const patch = briefPatch(req.body);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('campaigns').update(patch).eq('id', campaign.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ campaign: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id — assets keep existing (campaign_id set null by FK).
router.delete('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const ws = await resolveWorkspace(req);
    const campaign = await ownedCampaign(ws, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    await supabase.from('campaigns').delete().eq('id', campaign.id);
    res.json({ ok: true });
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
      campaign.start_date ? `Dates: ${campaign.start_date} → ${campaign.end_date || 'open'}` : null,
      s.core_message ? `Core message: ${s.core_message}` : null,
      s.message_hierarchy ? `Message hierarchy: ${s.message_hierarchy.join(' | ')}` : null,
      s.cta ? `Primary CTA: ${s.cta}` : null,
    ].filter(Boolean).join('\n') + '\n\n';

  return { text, campaign };
}

module.exports = router;
module.exports.campaignContext = campaignContext;
