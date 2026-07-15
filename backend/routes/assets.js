// ---------------------------------------------------------------------------
// Upgrade Prompts 7-11: marketing-asset generation routes (the new studios).
// Mounted alongside routes/ai.js under /api/ai.
//
// POST /api/ai/generate-website-kit      { page_types, business_type, ... }
// POST /api/ai/generate-email-flow       { flow_types, business_type, ... }
// POST /api/ai/generate-campaign-emails  { campaign_theme, campaign_goal, ... }
// POST /api/ai/generate-social-assets    { platforms, content_goal, ... }
// POST /api/ai/generate-creative-assets  { platforms, creative_goal, ... }
//
// Every route is plan-gated on 'asset_generations', scoped to the caller's
// workspace, and verifies any offer_id / launch_kit_id belongs to that
// workspace before generating (service_role bypasses RLS, so the route IS the
// security boundary). Results are saved into the 004_marketing_assets tables.
// ---------------------------------------------------------------------------

const express = require('express');
const supabase = require('../lib/supabase');
const { planGate, usageFor } = require('../lib/plan-limits');
const { generateJson } = require('../lib/ai');
const { qualityWarnings } = require('../lib/quality-checks');
const {
  websiteKitSchema,
  emailFlowSchema,
  campaignEmailSchema,
  socialCaptionSchema,
  creativeIdeasSchema,
} = require('../lib/schemas');

const router = express.Router();
router.use(express.json({ limit: '16kb' }));

// ── shared context loaders (mirror routes/ai.js) ────────────────────────────

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
  if (!o) return '';
  return [
    `Skills: ${o.skills}`,
    `Interests: ${o.interests}`,
    o.audience_ideas ? `Audience ideas: ${o.audience_ideas}` : null,
    `Product type: ${o.product_type}`,
    `Main goal: ${o.main_goal}`,
    o.platforms?.length ? `Platforms: ${o.platforms.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

function positioningContext(p) {
  if (!p) return '';
  return [
    `Recommended niche: ${p.recommended_niche?.niche} — ${p.recommended_niche?.reason}`,
    `Ideal customer: ${p.ideal_customer?.description}`,
    `Their main pain: ${p.ideal_customer?.main_pain}`,
    `Desired outcome: ${p.ideal_customer?.desired_outcome}`,
    `Positioning statement: ${p.positioning_statement}`,
    `Transformation: ${p.desired_transformation}`,
  ].filter(Boolean).join('\n');
}

function offerContext(offer) {
  if (!offer) return '';
  return [
    `Offer name: ${offer.offer_name}`,
    `Offer type: ${offer.offer_type}`,
    `Promise: ${offer.promise}`,
    `Target customer: ${offer.target_customer}`,
    `What's included: ${(offer.what_is_included || []).join('; ')}`,
    `Price: ${offer.price_suggestion}`,
  ].filter(Boolean).join('\n');
}

/**
 * Loads brand context and verifies that any provided offer_id / launch_kit_id
 * belongs to this workspace. Returns { offer, positioning, onboarding } or a
 * { status, error } object the caller should return verbatim.
 */
async function loadScopedContext(ws, { offer_id, launch_kit_id }) {
  if (launch_kit_id) {
    const { data: kit } = await supabase
      .from('launch_kits')
      .select('id')
      .eq('id', launch_kit_id)
      .eq('workspace_id', ws.id)
      .single();
    if (!kit) return { status: 404, error: 'Launch kit not found' };
  }

  let offer = null;
  if (offer_id) {
    const { data } = await supabase
      .from('offers')
      .select('*')
      .eq('id', offer_id)
      .eq('workspace_id', ws.id)
      .single();
    if (!data) return { status: 404, error: 'Offer not found' };
    offer = data;
  }

  const [onboarding, positioning] = await Promise.all([
    latestOnboarding(ws.id),
    latestPositioning(ws.id),
  ]);
  return { offer, positioning, onboarding };
}

/** Assemble the shared brand/offer block that every studio prompt shares. */
function brandBlock({ offer, positioning, onboarding }) {
  return [
    positioning ? `Brand positioning:\n${positioningContext(positioning)}` : '',
    offer ? `Offer/product:\n${offerContext(offer)}` : '',
    onboarding ? `About the business:\n${onboardingContext(onboarding)}` : '',
  ].filter(Boolean).join('\n\n');
}

function line(label, value) {
  return value ? `${label}: ${Array.isArray(value) ? value.join(', ') : value}` : null;
}

// ── 1. Website Studio (Prompt 7) ────────────────────────────────────────────

const WEBSITE_SYSTEM =
  'You are a senior conversion copywriter and ecommerce website strategist. Create website copy ' +
  'that is clear, practical, trustworthy and ready to paste into a website builder. You write for ' +
  'solo founders, creators, freelancers, small ecommerce brands and service providers. Do not invent ' +
  'testimonials, statistics, certifications or guarantees. Do not write legal terms, medical claims or ' +
  'unrealistic income promises. Every page must have a clear goal, clear CTA and copy that connects to ' +
  'the user\'s offer and ideal customer.\n\n' +
  'Page requirements:\n' +
  '- Home page: hero, problem, solution, benefits, how it works, offer/product section, trust, FAQ, final CTA.\n' +
  '- Product/service page: product promise, benefits, what is included, objections, FAQ, CTA.\n' +
  '- Cart page: reassurance, trust, shipping/returns microcopy, cross-sell ideas, empty cart copy.\n' +
  '- About us: human story, mission, values, why this brand exists, trust without hype.\n' +
  '- FAQ: practical buying objections and answers.\n' +
  '- Thank-you page: next step, expectation setting, email reminder, social follow CTA.\n' +
  'If information is missing, use a clear placeholder in brackets instead of inventing facts.';

// Prompts 12-14: page-type-specific section guidance. Each requested page type
// that needs deeper copy gets an explicit checklist of sections to produce
// inside that page's `sections` array. Everything is expressed within
// websiteKitSchema — no separate endpoints — and missing facts become
// bracketed placeholders rather than invented details.
const PAGE_GUIDANCE = {
  product:
    'For each product page, produce sections covering: above-the-fold product headline, product ' +
    'subtitle, 5 benefit bullets, short product description, long product description, what makes it ' +
    'different, how to use / how it works, trust/reassurance, upsell/cross-sell block, and image alt ' +
    'text ideas. Use only provided product facts; if a detail is missing write a placeholder like ' +
    '[Add material/specification here] instead of guessing. Give several CTA options.',
  cart:
    'For the cart page, produce sections covering: cart headline, empty cart message, free shipping ' +
    'bar copy, discount code microcopy, trust/reassurance copy, returns/shipping reassurance, ' +
    'checkout CTA options, cross-sell block headlines, honest (non-fake) urgency copy, support/help ' +
    'microcopy, and a note on the abandoned-cart email connection. Reduce friction — never use fake ' +
    'scarcity or false timers.',
  about:
    'For the about page, produce sections covering: brand story headline, founder/brand story body, ' +
    'mission, values, why we started, who we serve, trust, final CTA, and image suggestions. Do not ' +
    'invent founder facts — use only provided details and use fill-in placeholders where missing. ' +
    'Keep it warm and human, and remind the user to add real photos and founder details before publishing.',
};

router.post('/generate-website-kit', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, business_type, target_language,
      page_types, website_goal, products, extra_context,
    } = req.body || {};

    if (!Array.isArray(page_types) || page_types.length === 0) {
      return res.status(400).json({ error: 'page_types must be a non-empty array' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    // Page-type-specific guidance for any requested pages that need it.
    const guidance = page_types
      .map((t) => (PAGE_GUIDANCE[t] ? `${t} page — ${PAGE_GUIDANCE[t]}` : null))
      .filter(Boolean)
      .join('\n\n');

    const prompt = [
      'Create website copy for this brand.',
      brandBlock(ctx),
      line('Business type', business_type),
      line('Target language', target_language || 'English'),
      line('Page types needed', page_types),
      line('Website goal', website_goal),
      products ? `Product details (use only these facts; bracket anything missing):\n${JSON.stringify(products).slice(0, 3000)}` : null,
      guidance ? `Page-specific requirements:\n${guidance}` : null,
      line('Extra context', extra_context),
      'Return structured JSON with a pages array covering the requested page types.',
    ].filter(Boolean).join('\n\n');

    const result = await generateJson({ system: WEBSITE_SYSTEM, prompt, schema: websiteKitSchema, maxTokens: 12000 });

    const rows = (result.pages || []).map((p) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      page_type: p.page_type,
      title: p.h1 || p.hero_headline || p.page_type,
      seo_title: p.seo_title,
      meta_description: p.meta_description,
      sections: p, // full structured page kept losslessly in the jsonb column
      cta: p.primary_cta,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('website_pages').insert(rows).select();
    if (error) throw new Error('Failed to save website pages: ' + error.message);

    res.json({
      ok: true,
      pages: saved,
      quality_warnings: qualityWarnings('website', result),
      plan: req.userPlan,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── 2. Email Flow Studio (Prompt 8) ─────────────────────────────────────────

const EMAIL_FLOW_SYSTEM =
  'You are a senior email marketing copywriter for small ecommerce brands, creators, freelancers and ' +
  'digital product sellers. Generate practical email copy with subject line, preheader and CTA. Write ' +
  'emails that feel human, clear and useful, not spammy. Every email must have a purpose: welcome, ' +
  'educate, reduce objections, recover lost intent, encourage purchase, ask for review or bring back ' +
  'inactive subscribers. Do not overpromise. Do not invent testimonials or fake urgency.\n\n' +
  'Required output rules:\n' +
  '- Every email must include subject_line, preheader, headline, body_copy, cta, send_timing, segment and design_notes.\n' +
  '- Subject lines should be short and mobile-friendly.\n' +
  '- Preheaders should complete the subject line, not repeat it.\n' +
  '- CTA should be specific, not always "Shop now".\n' +
  '- Include design notes such as hero image idea, product block idea or plain-text style.';

router.post('/generate-email-flow', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, flow_types, business_type,
      target_language, campaign_goal, products, extra_context,
    } = req.body || {};

    if (!Array.isArray(flow_types) || flow_types.length === 0) {
      return res.status(400).json({ error: 'flow_types must be a non-empty array' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const prompt = [
      'Create email flow copy.',
      brandBlock(ctx),
      line('Business type', business_type),
      line('Flow types', flow_types),
      line('Target language', target_language || 'English'),
      line('Campaign goal', campaign_goal),
      products ? `Products:\n${JSON.stringify(products).slice(0, 2000)}` : null,
      line('Extra context', extra_context),
      'Return a JSON items array of emails. Preheader must not repeat the subject line.',
    ].filter(Boolean).join('\n\n');

    const result = await generateJson({ system: EMAIL_FLOW_SYSTEM, prompt, schema: emailFlowSchema, maxTokens: 12000 });

    const rows = (result.items || []).map((e) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      flow_type: e.flow_type,
      email_order: e.email_order,
      subject_line: e.subject_line,
      preheader: e.preheader,
      headline: e.headline,
      body_copy: e.body_copy,
      cta: e.cta,
      send_timing: e.send_timing,
      segment: e.segment,
      design_notes: e.design_notes,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('email_assets').insert(rows).select();
    if (error) throw new Error('Failed to save emails: ' + error.message);

    res.json({
      ok: true,
      emails: saved,
      quality_warnings: qualityWarnings('email', result, { hasDeadline: false }),
      plan: req.userPlan,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── 3. Campaign Email Generator (Prompt 9) ──────────────────────────────────

const CAMPAIGN_SYSTEM =
  'You are an ecommerce and creator-brand campaign email strategist. Create a complete campaign email ' +
  'sequence that can be used for a launch, seasonal promotion, product focus, bundle push, sale, ' +
  'newsletter or last-chance campaign.\n\n' +
  'Each email must include email_type, send_day, subject_line, preheader, body_copy, cta and design_notes.\n\n' +
  'Campaign sequence logic:\n' +
  '- Start with value or problem awareness, not immediate pressure.\n' +
  '- Introduce the offer/product clearly.\n' +
  '- Include one education/problem email.\n' +
  '- Include one proof/trust angle, but do not invent testimonials.\n' +
  '- Include one objection/FAQ email.\n' +
  '- Include one reminder or last-chance email if the campaign has an end date.\n' +
  '- Keep copy clear and mobile-first. Avoid fake scarcity.';

router.post('/generate-campaign-emails', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, campaign_theme, campaign_goal, target_language,
      start_date, end_date, discount_or_offer, products, tone, extra_context,
    } = req.body || {};

    if (!campaign_theme || !campaign_goal) {
      return res.status(400).json({ error: 'campaign_theme and campaign_goal are required' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const hasDeadline = Boolean(end_date);
    const prompt = [
      'Create a campaign email sequence.',
      brandBlock(ctx),
      line('Campaign theme', campaign_theme),
      line('Campaign goal', campaign_goal),
      line('Start date', start_date),
      line('End date', end_date),
      line('Discount/offer', discount_or_offer),
      line('Tone', tone),
      line('Target language', target_language || 'English'),
      products ? `Products:\n${JSON.stringify(products).slice(0, 2000)}` : null,
      line('Extra context', extra_context),
      hasDeadline
        ? 'This campaign has an end date, so include a reminder or last-chance email.'
        : 'This campaign has no end date, so do not invent a deadline or fake scarcity.',
    ].filter(Boolean).join('\n\n');

    const result = await generateJson({ system: CAMPAIGN_SYSTEM, prompt, schema: campaignEmailSchema, maxTokens: 10000 });

    // Campaign emails live in email_assets with flow_type='campaign'; the
    // specific campaign email_type (teaser/offer/…) is kept in the segment column.
    const rows = (result.items || []).map((e, i) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      flow_type: 'campaign',
      email_order: i + 1,
      subject_line: e.subject_line,
      preheader: e.preheader,
      body_copy: e.body_copy,
      cta: e.cta,
      send_timing: e.send_day,
      segment: e.email_type,
      design_notes: e.design_notes,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('email_assets').insert(rows).select();
    if (error) throw new Error('Failed to save campaign emails: ' + error.message);

    res.json({
      ok: true,
      campaign_theme: result.campaign_theme,
      campaign_goal: result.campaign_goal,
      emails: saved,
      quality_warnings: qualityWarnings('email', result, { hasDeadline }),
      plan: req.userPlan,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── 4. Social Caption Studio (Prompt 10) ────────────────────────────────────

const SOCIAL_SYSTEM =
  'You are a social content strategist for creators, freelancers, solo founders and small ecommerce ' +
  'brands. Create captions and content ideas that connect to the user\'s offer and help move followers ' +
  'toward trust, leads or sales. Avoid generic captions. Every caption must have a specific hook, body ' +
  'angle, CTA and visual direction.\n\n' +
  'Include a mix of: educational, myth-busting, personal/story, proof/trust, offer/sales, ' +
  'objection-handling and behind-the-scenes captions, plus carousel outlines, reel/TikTok scripts and ' +
  'story sequences.\n\n' +
  'Special caption rules:\n' +
  '- Write like a real human, not corporate marketing.\n' +
  '- Keep hooks short and scroll-stopping.\n' +
  '- CTA should match the goal: comment, save, DM, click, join waitlist, shop, book call.\n' +
  '- If target_language is Slovenian, Croatian, German or English, write natively in that language.\n' +
  '- Do not use exaggerated promises.';

router.post('/generate-social-assets', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, target_language, platforms,
      content_goal, content_style, number_of_items, extra_context,
    } = req.body || {};

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms must be a non-empty array' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const count = Math.max(10, Math.min(30, Number(number_of_items) || 12));
    const prompt = [
      'Create social content assets.',
      brandBlock(ctx),
      line('Platforms', platforms),
      line('Content goal', content_goal),
      line('Content style', content_style),
      line('Target language', target_language || 'English'),
      `Number of items: ${count}`,
      line('Extra context', extra_context),
      'Return a JSON items array with a mix of educational, story, proof, objection, soft-sell and offer posts.',
    ].filter(Boolean).join('\n\n');

    const result = await generateJson({ system: SOCIAL_SYSTEM, prompt, schema: socialCaptionSchema, maxTokens: 12000 });

    const rows = (result.items || []).map((s) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      platform: s.platform,
      content_type: s.content_type,
      hook: s.hook,
      caption: s.caption,
      cta: s.cta,
      visual_direction: s.visual_direction,
      hashtags: s.hashtags,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('social_assets').insert(rows).select();
    if (error) throw new Error('Failed to save social assets: ' + error.message);

    res.json({
      ok: true,
      items: saved,
      quality_warnings: qualityWarnings('social', result),
      plan: req.userPlan,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── 5. Ads & Creative Studio (Prompt 11) ────────────────────────────────────

const CREATIVE_SYSTEM =
  'You are a senior paid social creative strategist. Generate ad ideas for Meta, TikTok, Google and ' +
  'Pinterest that a solo founder or small brand can realistically create. Focus on hooks, image ideas, ' +
  'video ideas, UGC briefs, text overlays, primary text, headlines and testing angles.\n\n' +
  'For each creative, include platform, creative_type, hook, headline, primary_text, visual_direction, ' +
  'shot_list, text_overlays, cta and testing_angle.\n\n' +
  'Creative rules:\n' +
  '- Visual ideas must be shootable with a phone, simple props and real products/screens.\n' +
  '- Do not require expensive production.\n' +
  '- Use clear before/after or problem/solution angles without unrealistic claims.\n' +
  '- For ecommerce, include product-focused static, lifestyle, comparison, bundle and social-proof angles.\n' +
  '- For services/digital products, include problem-aware, founder-led, screen-recording, ' +
  'testimonial-placeholder and educational angles.\n' +
  '- For video, include first 3-second hook, scene-by-scene shots, on-screen text and CTA.';

router.post('/generate-creative-assets', planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, target_language, platforms,
      creative_goal, formats, budget_level, extra_context,
    } = req.body || {};

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms must be a non-empty array' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const prompt = [
      'Create ad creative ideas.',
      brandBlock(ctx),
      line('Platforms', platforms),
      line('Creative goal', creative_goal),
      line('Formats', formats),
      line('Budget level', budget_level),
      line('Target language', target_language || 'English'),
      line('Extra context', extra_context),
      'Return a JSON items array. For video ideas include the first 3-second hook, scenes, text overlays and CTA.',
    ].filter(Boolean).join('\n\n');

    const result = await generateJson({ system: CREATIVE_SYSTEM, prompt, schema: creativeIdeasSchema, maxTokens: 12000 });

    const rows = (result.items || []).map((c) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      platform: c.platform,
      creative_type: c.creative_type,
      hook: c.hook,
      headline: c.headline,
      primary_text: c.primary_text,
      visual_direction: c.visual_direction,
      shot_list: c.shot_list,
      text_overlays: c.text_overlays,
      cta: c.cta,
      testing_angle: c.testing_angle,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('creative_assets').insert(rows).select();
    if (error) throw new Error('Failed to save creative assets: ' + error.message);

    res.json({
      ok: true,
      items: saved,
      quality_warnings: qualityWarnings('creative', result),
      plan: req.userPlan,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
