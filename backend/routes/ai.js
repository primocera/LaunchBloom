// ---------------------------------------------------------------------------
// OfferFlow AI generation routes — the product's brain.
//
// POST /api/ai/generate-positioning   { }            plan-limited
// POST /api/ai/generate-offers        { }            plan-limited
// POST /api/ai/generate-launch-kit    { offer_id }   plan-limited
// POST /api/ai/regenerate-section     { launch_kit_id, section }
//
// Limits come from lib/plan-limits.js (Prompt 25): free = lifetime totals
// and a 7-day content plan; paid plans reset monthly. Flow:
// onboarding_answers → positioning_outputs → offers (pick one) →
// launch_kits (sections as jsonb + exploded item rows). Everything stays
// tied to the caller's workspace; ownership is enforced here because the
// service_role client bypasses RLS.
// ---------------------------------------------------------------------------

const express = require('express');
const supabase = require('../lib/supabase');
const { planGate, limitsFor, usageFor } = require('../lib/plan-limits');
const { generateJson } = require('../lib/ai');
const {
  positioningSchema,
  offersSchema,
  launchSummarySchema,
  SECTION_SCHEMAS,
} = require('../lib/schemas');

const router = express.Router();
router.use(express.json({ limit: '16kb' }));

// ── shared context loaders ─────────────────────────────────────────────────

async function latestOnboarding(workspaceId) {
  const { data } = await supabase
    .from('onboarding_answers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

async function latestPositioning(workspaceId) {
  const { data } = await supabase
    .from('positioning_outputs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

function onboardingContext(o) {
  return [
    `Skills: ${o.skills}`,
    `Interests: ${o.interests}`,
    o.experience ? `Experience: ${o.experience}` : null,
    o.audience_ideas ? `Audience ideas: ${o.audience_ideas}` : null,
    `Product type they want: ${o.product_type}`,
    `Current stage: ${o.current_stage}`,
    `Main goal: ${o.main_goal}`,
    `Weekly time available: ${o.weekly_time_available}`,
    `Biggest challenge: ${o.biggest_challenge}`,
    o.platforms?.length ? `Platforms: ${o.platforms.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

function positioningContext(p) {
  return [
    `Recommended niche: ${p.recommended_niche?.niche} — ${p.recommended_niche?.reason}`,
    `Ideal customer: ${p.ideal_customer?.description}`,
    `Their main pain: ${p.ideal_customer?.main_pain}`,
    `Desired outcome: ${p.ideal_customer?.desired_outcome}`,
    `Positioning statement: ${p.positioning_statement}`,
    `Transformation: ${p.desired_transformation}`,
    `Content pillars: ${(p.content_pillars || []).map((c) => c.pillar).join(', ')}`,
  ].join('\n');
}

function offerContext(offer) {
  return [
    `Offer name: ${offer.offer_name}`,
    `Offer type: ${offer.offer_type}`,
    `Promise: ${offer.promise}`,
    `Target customer: ${offer.target_customer}`,
    `What's included: ${(offer.what_is_included || []).join('; ')}`,
    `Delivery format: ${offer.delivery_format}`,
    `Price: ${offer.price_suggestion}`,
    `Bonuses: ${(offer.bonuses || []).join('; ')}`,
    `CTA: ${offer.cta}`,
  ].join('\n');
}

// ── 1. Positioning ─────────────────────────────────────────────────────────

router.post('/generate-positioning', planGate('positioning'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const onboarding = await latestOnboarding(ws.id);
    if (!onboarding) {
      return res.status(400).json({ error: 'Complete onboarding first.', code: 'NO_ONBOARDING' });
    }

    const result = await generateJson({
      system:
        'You are doing the positioning step: turn raw onboarding answers into clear market positioning. ' +
        'Niches must be specific (audience + problem), realistic for this person\'s actual skills and available time, ' +
        'and reachable on the platforms they already use.',
      prompt:
        `Create positioning for this person based on their onboarding answers:\n\n${onboardingContext(onboarding)}`,
      schema: positioningSchema,
    });

    const { data: saved, error } = await supabase
      .from('positioning_outputs')
      .insert({ workspace_id: ws.id, ...result })
      .select()
      .single();
    if (error) throw new Error('Failed to save positioning: ' + error.message);

    res.json({ ok: true, positioning: saved, plan: req.userPlan, usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

// ── 2. Offers (3 options) ──────────────────────────────────────────────────

router.post('/generate-offers', planGate('offer_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const [onboarding, positioning] = await Promise.all([
      latestOnboarding(ws.id),
      latestPositioning(ws.id),
    ]);
    if (!positioning) {
      return res.status(400).json({ error: 'Generate positioning first.', code: 'NO_POSITIONING' });
    }

    const result = await generateJson({
      system:
        'You are doing the offer design step: turn positioning into three distinct, monetizable offer options. ' +
        'Make them genuinely different (e.g. different price points, formats, or depth) - not three flavors of the same thing. ' +
        'Each must be deliverable by one person with their stated weekly time. Price suggestions are ranges, not promises.',
      prompt:
        `Design 3 offer options for this person.\n\nPositioning:\n${positioningContext(positioning)}\n\n` +
        (onboarding ? `Onboarding answers:\n${onboardingContext(onboarding)}` : ''),
      schema: offersSchema,
    });

    const rows = result.offers.map((o) => ({ workspace_id: ws.id, status: 'draft', ...o }));
    const { data: saved, error } = await supabase.from('offers').insert(rows).select();
    if (error) throw new Error('Failed to save offers: ' + error.message);

    res.json({ ok: true, offers: saved, plan: req.userPlan, usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

// ── 3. Launch kit (all sections) ───────────────────────────────────────────

const SECTION_SYSTEMS = {
  landing_page:
    'Write landing page copy for this offer. Benefit-led, specific, calm confidence - no hype. ' +
    'The testimonial note must tell the user to add real testimonials later, never invented ones.',
  content_plan:
    'Create a 30-day content plan promoting this offer on the user\'s platforms. Mix content types ' +
    '(value, story, proof, offer). Hooks must be specific to the niche, not generic. Number days 1-30.',
  email_sequence:
    'Create a 7-email launch sequence for this offer. Human, warm, not spammy. Classic arc: ' +
    'welcome/story → problem → transformation → offer reveal → objections → social proof angle → last call. Number 1-7.',
  ads_kit:
    'Create Meta ad starter ideas for this offer. Cover all four ad types: at least one "hook" (scroll-stopping opener), ' +
    'one "static" (image ad concept), one "video" (short video concept), and one "ugc" (creator-style brief). ' +
    'Hooks stop the scroll without clickbait. Primary text follows hook → empathy → mechanism → CTA. ' +
    'Visual directions must be shootable by one person with a phone.',
  seo_kit:
    'Create an SEO starter plan for this offer: realistic long-tail keywords a small new site can rank for, ' +
    'with page-ready titles and meta descriptions (under 160 chars).',
  weekly_plan:
    'Create the first weekly action plan to launch this offer, sized to the user\'s stated weekly time. ' +
    'Concrete tasks with clear outcomes, highest-leverage first.',
};

/** Content plan length is plan-dependent (free: 7 days, paid: 30). */
function schemaFor(section, days) {
  const schema = SECTION_SCHEMAS[section];
  if (section !== 'content_plan' || !days || days === 30) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      items: { ...schema.properties.items, minItems: days, maxItems: days },
    },
  };
}

async function generateSection(section, ctx, days) {
  const prompt =
    section === 'content_plan' && days && days !== 30
      ? ctx + `\n\nCreate a ${days}-day content plan (days 1-${days}).`
      : ctx;
  return generateJson({
    system: SECTION_SYSTEMS[section],
    prompt,
    schema: schemaFor(section, days),
    maxTokens: section === 'content_plan' ? 16000 : 8000,
  });
}

/** Explode a section's items into its per-item table for granular editing. */
async function explodeItems(section, data, launchKitId, workspaceId) {
  const tableFor = {
    content_plan: 'content_items',
    email_sequence: 'email_items',
    ads_kit: 'ad_ideas',
    seo_kit: 'seo_items',
    weekly_plan: 'weekly_tasks',
  };
  const table = tableFor[section];
  if (!table || !Array.isArray(data.items)) return;

  await supabase.from(table).delete().eq('launch_kit_id', launchKitId);
  const rows = data.items.map((item) => ({
    launch_kit_id: launchKitId,
    workspace_id: workspaceId,
    ...item,
    // email body_outline is jsonb in the item table; arrays pass through as-is
  }));
  const { error } = await supabase.from(table).insert(rows);
  if (error) console.error(`explodeItems(${section}) failed:`, error.message);
}

router.post('/generate-launch-kit', planGate('launch_kits'), async (req, res, next) => {
  try {
    const { offer_id } = req.body || {};
    if (!offer_id) return res.status(400).json({ error: 'offer_id is required' });

    const ws = req.workspace;
    const { data: offer } = await supabase
      .from('offers')
      .select('*')
      .eq('id', offer_id)
      .eq('workspace_id', ws.id)
      .single();
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    const [onboarding, positioning] = await Promise.all([
      latestOnboarding(ws.id),
      latestPositioning(ws.id),
    ]);

    const ctx =
      `Offer:\n${offerContext(offer)}\n\n` +
      (positioning ? `Positioning:\n${positioningContext(positioning)}\n\n` : '') +
      (onboarding ? `About the person:\n${onboardingContext(onboarding)}` : '');

    // All six sections in parallel — each is an independent structured call.
    const contentDays = req.planLimits.content_plan_days;
    const sections = Object.keys(SECTION_SYSTEMS);
    const [results, summary] = await Promise.all([
      Promise.all(sections.map((s) => generateSection(s, ctx, contentDays))),
      generateJson({
        system: 'Write a short launch kit title, a 2-3 sentence summary, and a practical launch checklist for this offer.',
        prompt: ctx,
        schema: launchSummarySchema,
        maxTokens: 2000,
      }),
    ]);

    const bySection = Object.fromEntries(sections.map((s, i) => [s, results[i]]));

    const { data: kit, error } = await supabase
      .from('launch_kits')
      .insert({
        workspace_id: ws.id,
        offer_id: offer.id,
        title: summary.title,
        summary: summary.summary,
        launch_checklist: summary.launch_checklist,
        landing_page: bySection.landing_page,
        content_plan: bySection.content_plan,
        email_sequence: bySection.email_sequence,
        ads_kit: bySection.ads_kit,
        seo_kit: bySection.seo_kit,
        weekly_plan: bySection.weekly_plan,
      })
      .select()
      .single();
    if (error) throw new Error('Failed to save launch kit: ' + error.message);

    // Mark the chosen offer as active
    await supabase.from('offers').update({ status: 'active' }).eq('id', offer.id);

    // Explode editable sections into item tables (best-effort)
    await Promise.all(
      ['content_plan', 'email_sequence', 'ads_kit', 'seo_kit', 'weekly_plan'].map((s) =>
        explodeItems(s, bySection[s], kit.id, ws.id)
      )
    );

    res.json({ ok: true, launch_kit: kit, plan: req.userPlan, usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

// ── 4. Regenerate one section ──────────────────────────────────────────────

router.post('/regenerate-section', planGate('regenerate_section'), async (req, res, next) => {
  try {
    const { launch_kit_id, section, feedback } = req.body || {};
    if (!launch_kit_id) return res.status(400).json({ error: 'launch_kit_id is required' });
    if (!SECTION_SCHEMAS[section]) {
      return res.status(400).json({
        error: 'section must be one of: ' + Object.keys(SECTION_SCHEMAS).join(', '),
      });
    }

    const ws = req.workspace;
    const { data: kit } = await supabase
      .from('launch_kits')
      .select('*')
      .eq('id', launch_kit_id)
      .eq('workspace_id', ws.id)
      .single();
    if (!kit) return res.status(404).json({ error: 'Launch kit not found' });

    const { data: offer } = await supabase
      .from('offers')
      .select('*')
      .eq('id', kit.offer_id)
      .eq('workspace_id', ws.id)
      .single();
    const positioning = await latestPositioning(ws.id);

    const ctx =
      (offer ? `Offer:\n${offerContext(offer)}\n\n` : '') +
      (positioning ? `Positioning:\n${positioningContext(positioning)}\n\n` : '') +
      (feedback ? `The user asked for this change: ${String(feedback).slice(0, 1000)}\n\n` : '') +
      `Regenerate the ${section.replace(/_/g, ' ')} from scratch — a fresh take, not a copy of the previous version.`;

    const data = await generateSection(section, ctx, req.planLimits.content_plan_days);

    const { error } = await supabase
      .from('launch_kits')
      .update({ [section]: data })
      .eq('id', kit.id);
    if (error) throw new Error('Failed to save section: ' + error.message);

    await explodeItems(section, data, kit.id, ws.id);

    res.json({ ok: true, section, data, plan: req.userPlan });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
