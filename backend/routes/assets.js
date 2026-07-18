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
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { planGate, usageFor } = require('../lib/plan-limits');
const { idempotent } = require('../lib/idempotency');
const { generateJson, AI_PROMPT_VERSION } = require('../lib/ai');
const { brandContextFor } = require('../lib/brand-profile');
const { buildSequence } = require('../lib/email-blueprints');
const { campaignContext } = require('./campaigns');
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
  '- Collection/category page: category promise, what is inside, buying guidance, filters/sorting hints, SEO intro.\n' +
  '- Contact page: how to reach the brand, what to expect, response time, form field suggestions.\n' +
  'For every page, first produce three distinct hero directions — direct_response (offer/benefit-led), ' +
  'brand_led (story/identity-led) and problem_aware (starts from the reader\'s pain) — then write the ' +
  'full page using the strongest one for hero_headline/hero_subheadline. Write natively in the target ' +
  'language and keep product and brand names exactly as given — never translate or alter them. Only give ' +
  'a secondary CTA when a second action genuinely helps; otherwise return an empty string.\n' +
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
  collection:
    'For the collection/category page, produce sections covering: category headline, short intro that ' +
    'sets expectations, what is in the collection, how to choose (buying guidance), and an SEO intro ' +
    'paragraph. Do not invent product counts or prices.',
  contact:
    'For the contact page, produce sections covering: contact headline, ways to reach the brand, what ' +
    'to expect and typical response time, and suggested form fields. Use placeholders for real email/' +
    'phone/hours instead of inventing them.',
  landing:
    'For the landing page, produce a single-goal, conversion-focused page: one hero, problem, solution, ' +
    'benefits, proof/reassurance, objection handling, and one repeated primary CTA. Keep it to one goal.',
};

// P8: ecommerce product-page facts the user can supply so the AI never invents
// variants, shipping terms or proof. All optional; missing → bracket placeholder.
const ECOM_FIELDS = ['product_facts', 'benefits', 'objections', 'usage', 'variants', 'shipping_returns', 'proof', 'free_shipping_threshold'];

router.post('/generate-website-kit', idempotent('generate-website-kit'), planGate('asset_generations'), async (req, res, next) => {
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
      (() => {
        const ecom = ECOM_FIELDS
          .map((k) => ((req.body || {})[k] ? line(k.replace(/_/g, ' '), (req.body || {})[k]) : null))
          .filter(Boolean);
        return ecom.length
          ? `Ecommerce product facts (use verbatim; never invent variants, shipping terms, discounts or proof — bracket what is missing):\n${ecom.join('\n')}`
          : null;
      })(),
      guidance ? `Page-specific requirements:\n${guidance}` : null,
      line('Extra context', extra_context),
      'Return structured JSON with a pages array covering the requested page types.',
    ].filter(Boolean).join('\n\n');

    const camp = await campaignContext(ws, (req.body || {}).campaign_id);
    if (camp.error) return res.status(camp.status).json({ error: camp.error });
    const brand = await brandContextFor(ws.id);
    const result = await generateJson({ system: WEBSITE_SYSTEM, prompt: brand.text + camp.text + prompt, schema: websiteKitSchema, maxTokens: 12000 });
    req.usageInfo = result.__meta;
    const runId = crypto.randomUUID();

    const rows = (result.pages || []).map((p) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      campaign_id: camp.campaign ? camp.campaign.id : null,
      brief_snapshot: camp.snapshot || null,
      prompt_version: AI_PROMPT_VERSION,
      generation_run_id: runId,
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
      context_used: brand.summary,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── 2. Email Flow Studio (Prompt 8) ─────────────────────────────────────────

const EMAIL_FLOW_SYSTEM =
  'You are a senior email marketing copywriter for small ecommerce brands, creators, freelancers and ' +
  'digital product sellers. You are given an EXACT email blueprint (how many emails, and each email\'s ' +
  'objective, timing and segment). Fill copy into that structure — do NOT add, remove or reorder emails.\n\n' +
  'Per-email rules:\n' +
  '- subject_line: under 50 characters where the language allows; specific, not clickbait.\n' +
  '- subject_options: 2-3 distinct, honest subject lines (include subject_line); never deceptive (no fake "Re:", no false "you won").\n' +
  '- preheader: under 90 characters; completes the subject line, never repeats it.\n' +
  '- body_copy: complete, send-ready copy — never an outline or bullet skeleton.\n' +
  '- objective: restate the email\'s single purpose from the blueprint.\n' +
  '- body_copy: scannable — short paragraphs or bullets, one idea per block.\n' +
  '- cta: one specific primary CTA (not always "Shop now"); secondary_cta only if useful, else "".\n' +
  '- personalization_tokens: list any tokens used (e.g. {{first_name}}); [] if none.\n' +
  '- exclusions: who to exclude (e.g. already purchased); "" if none.\n' +
  '- design_notes: hero image idea, product block idea, or plain-text style.\n' +
  'Never invent testimonials, statistics or fake urgency. Honour any incentive/deadline/compliance notes given.';

router.post('/generate-email-flow', idempotent('generate-email-flow'), planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, flow_types, business_type,
      target_language, campaign_goal, campaign_count, products, extra_context,
      tone, email_length, incentive, deadline, compliance_notes,
    } = req.body || {};

    if (!Array.isArray(flow_types) || flow_types.length === 0) {
      return res.status(400).json({ error: 'flow_types must be a non-empty array' });
    }

    // Deterministic sequence: the flow type fixes the email count + objectives.
    const seq = buildSequence(flow_types, { campaignCount: campaign_count });
    if (seq.total === 0) {
      return res.status(400).json({ error: 'No known flow types selected.' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const prompt = [
      `Write copy for EXACTLY these ${seq.total} emails, following the blueprint precisely:`,
      seq.structureText,
      brandBlock(ctx),
      line('Business type', business_type),
      line('Target language', target_language || 'English'),
      line('Tone', tone),
      line('Email length', email_length),
      line('Campaign goal', campaign_goal),
      line('Incentive', incentive),
      line('Deadline', deadline),
      line('Compliance / claims to avoid', compliance_notes),
      products ? `Product facts (use only these; bracket anything missing):\n${JSON.stringify(products).slice(0, 2000)}` : null,
      line('Extra context', extra_context),
      `Return a JSON items array with exactly ${seq.total} emails matching the blueprint order and flow_type/email_order.`,
    ].filter(Boolean).join('\n\n');

    const camp = await campaignContext(ws, (req.body || {}).campaign_id);
    if (camp.error) return res.status(camp.status).json({ error: camp.error });
    const brand = await brandContextFor(ws.id);
    const result = await generateJson({ system: EMAIL_FLOW_SYSTEM, prompt: brand.text + camp.text + prompt, schema: emailFlowSchema, maxTokens: 14000 });
    req.usageInfo = result.__meta;
    const runId = crypto.randomUUID();

    const rows = (result.items || []).map((e, i) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      campaign_id: camp.campaign ? camp.campaign.id : null,
      brief_snapshot: camp.snapshot || null,
      prompt_version: AI_PROMPT_VERSION,
      generation_run_id: runId,
      flow_type: e.flow_type || (seq.emails[i] && seq.emails[i].flow_type),
      email_order: e.email_order || (seq.emails[i] && seq.emails[i].email_order),
      objective: e.objective || (seq.emails[i] && seq.emails[i].objective),
      subject_line: e.subject_line,
      subject_options: Array.isArray(e.subject_options) ? e.subject_options : null,
      preheader: e.preheader,
      headline: e.headline,
      body_copy: e.body_copy,
      cta: e.cta,
      secondary_cta: e.secondary_cta || null,
      personalization_tokens: Array.isArray(e.personalization_tokens) ? e.personalization_tokens : null,
      send_timing: e.send_timing || (seq.emails[i] && seq.emails[i].send_timing),
      segment: e.segment || (seq.emails[i] && seq.emails[i].segment),
      exclusions: e.exclusions || null,
      design_notes: e.design_notes,
      email_length: email_length || null,
      tone: tone || null,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('email_assets').insert(rows).select();
    if (error) throw new Error('Failed to save emails: ' + error.message);

    res.json({
      ok: true,
      emails: saved,
      quality_warnings: qualityWarnings('email', result, { hasDeadline: false }),
      plan: req.userPlan,
      context_used: brand.summary,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

// ── Email section-level edits (Prompt 11) ───────────────────────────────────

/** Load an email_assets row the caller owns, or send a 404. */
async function ownedEmail(ws, id, res) {
  const { data } = await supabase.from('email_assets').select('*').eq('id', id).eq('workspace_id', ws.id).single();
  if (!data) { res.status(404).json({ error: 'Email not found' }); return null; }
  return data;
}

const subjectSchema = {
  type: 'object',
  properties: {
    subject_line: { type: 'string', description: 'Under 50 characters where possible.' },
    preheader: { type: 'string', description: 'Under 90 characters; completes, never repeats, the subject.' },
  },
  required: ['subject_line', 'preheader'],
  additionalProperties: false,
};

// POST /api/ai/email/:id/subject — regenerate subject + preheader only.
router.post('/email/:id/subject', planGate('regenerate_section'), async (req, res, next) => {
  try {
    const email = await ownedEmail(req.workspace, req.params.id, res);
    if (!email) return;
    const brand = await brandContextFor(req.workspace.id);
    const result = await generateJson({
      system: EMAIL_FLOW_SYSTEM,
      prompt: brand.text + `Rewrite ONLY the subject line and preheader for this email.\nObjective: ${email.objective || ''}\nHeadline: ${email.headline || ''}\nBody:\n${(email.body_copy || '').slice(0, 1500)}`,
      schema: subjectSchema,
      maxTokens: 800,
    });
    req.usageInfo = result.__meta;
    const { data: saved } = await supabase.from('email_assets')
      .update({ subject_line: result.subject_line, preheader: result.preheader })
      .eq('id', email.id).select().single();
    res.json({ ok: true, email: saved, usage: await usageFor(req.workspace.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

const bodySchema = {
  type: 'object',
  properties: { headline: { type: 'string' }, body_copy: { type: 'string' }, cta: { type: 'string' } },
  required: ['headline', 'body_copy', 'cta'],
  additionalProperties: false,
};

// POST /api/ai/email/:id/body — rewrite the body (optional instruction).
router.post('/email/:id/body', planGate('regenerate_section'), async (req, res, next) => {
  try {
    const email = await ownedEmail(req.workspace, req.params.id, res);
    if (!email) return;
    const instruction = String((req.body || {}).instruction || '').slice(0, 500);
    const brand = await brandContextFor(req.workspace.id);
    const result = await generateJson({
      system: EMAIL_FLOW_SYSTEM,
      prompt: brand.text + `Rewrite ONLY the headline, body and primary CTA for this email. Keep the same objective and subject.\nObjective: ${email.objective || ''}\nSubject: ${email.subject_line || ''}\nCurrent body:\n${(email.body_copy || '').slice(0, 2000)}` + (instruction ? `\n\nApply this instruction: ${instruction}` : ''),
      schema: bodySchema,
      maxTokens: 3000,
    });
    req.usageInfo = result.__meta;
    const { data: saved } = await supabase.from('email_assets')
      .update({ headline: result.headline, body_copy: result.body_copy, cta: result.cta })
      .eq('id', email.id).select().single();
    res.json({ ok: true, email: saved, usage: await usageFor(req.workspace.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

const variantsSchema = {
  type: 'object',
  properties: {
    variants: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: { subject_line: { type: 'string' }, preheader: { type: 'string' }, body_copy: { type: 'string' } },
        required: ['subject_line', 'preheader', 'body_copy'],
        additionalProperties: false,
      },
    },
  },
  required: ['variants'],
  additionalProperties: false,
};

// POST /api/ai/email/:id/variants — 3 alternative versions (not saved).
router.post('/email/:id/variants', planGate('regenerate_section'), async (req, res, next) => {
  try {
    const email = await ownedEmail(req.workspace, req.params.id, res);
    if (!email) return;
    const brand = await brandContextFor(req.workspace.id);
    const result = await generateJson({
      system: EMAIL_FLOW_SYSTEM,
      prompt: brand.text + `Produce 3 distinct variants (different angle each) of this email — subject, preheader and body.\nObjective: ${email.objective || ''}\nCurrent subject: ${email.subject_line || ''}\nCurrent body:\n${(email.body_copy || '').slice(0, 1500)}`,
      schema: variantsSchema,
      maxTokens: 4000,
    });
    req.usageInfo = result.__meta;
    res.json({ ok: true, variants: result.variants, usage: await usageFor(req.workspace.id, req.userPlan, req.userEmail, req.userId) });
  } catch (err) {
    next(err);
  }
});

// ── 3. Campaign Email Generator (Prompt 9) ──────────────────────────────────

const CAMPAIGN_SYSTEM =
  'You are an ecommerce and creator-brand campaign email strategist. Create a complete campaign email ' +
  'sequence that can be used for a launch, seasonal promotion, product focus, bundle push, sale, ' +
  'newsletter or last-chance campaign.\n\n' +
  'Each email must include email_type, send_day, objective, subject_line, subject_options (2-3 distinct, ' +
  'non-deceptive), preheader, headline, full send-ready body_copy (never an outline), cta, secondary_cta ' +
  '(only when justified, else ""), segment, exclusions and design_notes.\n\n' +
  'Campaign sequence logic:\n' +
  '- Start with value or problem awareness, not immediate pressure.\n' +
  '- Introduce the offer/product clearly.\n' +
  '- Include one education/problem email.\n' +
  '- Include one proof/trust angle, but do not invent testimonials.\n' +
  '- Include one objection/FAQ email.\n' +
  '- Include one reminder or last-chance email ONLY if the campaign has a real end date from the brief.\n' +
  '- Every date/deadline you reference must come from the provided promotion window — never invent urgency.\n' +
  '- Use the real discount, code, minimum spend and exclusions exactly as given; bracket anything missing.\n' +
  '- Keep copy clear and mobile-first. Avoid fake scarcity and deceptive subject lines.';

router.post('/generate-campaign-emails', idempotent('generate-campaign-emails'), planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, campaign_theme, campaign_goal, campaign_type, target_language,
      start_date, end_date, timezone, discount_or_offer, discount_code, minimum_spend,
      promo_exclusions, products, tone, email_length, extra_context,
    } = req.body || {};

    if (!campaign_theme || !campaign_goal) {
      return res.status(400).json({ error: 'campaign_theme and campaign_goal are required' });
    }

    const ctx = await loadScopedContext(ws, { offer_id, launch_kit_id });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const hasDeadline = Boolean(end_date);
    const promoDetails = {
      discount: discount_or_offer || null, code: discount_code || null,
      minimum_spend: minimum_spend || null, exclusions: promo_exclusions || null,
      start_date: start_date || null, end_date: end_date || null, timezone: timezone || null,
    };
    const prompt = [
      'Create a campaign email sequence.',
      brandBlock(ctx),
      line('Campaign theme', campaign_theme),
      line('Campaign goal', campaign_goal),
      line('Campaign type', campaign_type),
      line('Tone', tone),
      line('Email length', email_length),
      line('Target language', target_language || 'English'),
      'Promotion details (use verbatim; never invent any of these):',
      line('  Discount / offer', discount_or_offer),
      line('  Discount code', discount_code),
      line('  Minimum spend', minimum_spend),
      line('  Exclusions', promo_exclusions),
      line('  Start date', start_date),
      line('  End date', end_date),
      line('  Timezone', timezone),
      products ? `Products:\n${JSON.stringify(products).slice(0, 2000)}` : null,
      line('Extra context', extra_context),
      hasDeadline
        ? `This campaign ends on ${end_date}${timezone ? ` (${timezone})` : ''}, so include a reminder or last-chance email tied to that exact date.`
        : 'This campaign has no end date, so do not invent a deadline or fake scarcity.',
    ].filter(Boolean).join('\n\n');

    const camp = await campaignContext(ws, (req.body || {}).campaign_id);
    if (camp.error) return res.status(camp.status).json({ error: camp.error });
    const brand = await brandContextFor(ws.id);
    const result = await generateJson({ system: CAMPAIGN_SYSTEM, prompt: brand.text + camp.text + prompt, schema: campaignEmailSchema, maxTokens: 10000 });
    req.usageInfo = result.__meta;
    const runId = crypto.randomUUID();

    // Campaign emails live in email_assets with flow_type='campaign'; the
    // specific campaign email_type (teaser/offer/…) is kept in the segment column.
    const rows = (result.items || []).map((e, i) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      campaign_id: camp.campaign ? camp.campaign.id : null,
      brief_snapshot: camp.snapshot || null,
      prompt_version: AI_PROMPT_VERSION,
      generation_run_id: runId,
      flow_type: 'campaign',
      campaign_type: result.campaign_type || campaign_type || null,
      email_order: i + 1,
      objective: e.objective || null,
      subject_line: e.subject_line,
      subject_options: Array.isArray(e.subject_options) ? e.subject_options : null,
      preheader: e.preheader,
      headline: e.headline || null,
      body_copy: e.body_copy,
      cta: e.cta,
      secondary_cta: e.secondary_cta || null,
      send_timing: e.send_day,
      segment: e.segment || e.email_type,
      exclusions: e.exclusions || null,
      design_notes: e.design_notes,
      promo_details: promoDetails,
      email_length: email_length || null,
      tone: tone || null,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('email_assets').insert(rows).select();
    if (error) throw new Error('Failed to save campaign emails: ' + error.message);

    res.json({
      ok: true,
      campaign_theme: result.campaign_theme,
      campaign_goal: result.campaign_goal,
      campaign_type: result.campaign_type,
      emails: saved,
      quality_warnings: qualityWarnings('email', result, { hasDeadline }),
      plan: req.userPlan,
      context_used: brand.summary,
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
  'Produce a balanced mix across five content pillars — education, proof, objection-handling, community ' +
  'and sales — weighted toward the stated goal.\n\n' +
  'Channel-aware format rules (use only the fields each format needs):\n' +
  '- carousel: fill the slides array slide-by-slide (heading + body + visual per slide); keep video_script empty.\n' +
  '- reel / short_video / TikTok video: fill video_script (hook, spoken_script, on_screen_text, shot_list, ' +
  'b_roll, cta); keep slides empty.\n' +
  '- caption / story / post / pin: hook + caption + visual_direction; slides empty and video_script fields empty.\n' +
  'Set each item\'s pillar field to the pillar it serves.\n\n' +
  'Special rules:\n' +
  '- Write like a real human, not corporate marketing. Keep hooks short and scroll-stopping.\n' +
  '- CTA should match the goal: comment, save, DM, click, join waitlist, shop, book call.\n' +
  '- Respect the awareness stage, creator/product availability, filming location and production level given — ' +
  'never propose shoots the user cannot realistically produce.\n' +
  '- Write natively in the target language.\n' +
  '- Hashtags are optional and platform-appropriate; never imply they guarantee growth. An empty list is fine.\n' +
  '- Do not use exaggerated promises.';

router.post('/generate-social-assets', idempotent('generate-social-assets'), planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, target_language, platforms, formats,
      content_goal, content_style, number_of_items, extra_context,
      content_pillars, awareness_stage, creator_available, product_available,
      filming_location, production_level,
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
      line('Formats to include', formats),
      line('Content goal', content_goal),
      line('Content style', content_style),
      line('Content pillars', content_pillars),
      line('Audience awareness stage', awareness_stage),
      line('Creator available on camera', creator_available),
      line('Product available to show', product_available),
      line('Filming location', filming_location),
      line('Production level', production_level),
      line('Target language', target_language || 'English'),
      `Number of items: ${count}`,
      line('Extra context', extra_context),
      'Return a JSON items array with a balanced mix across education, proof, objection, community and sales, ' +
      'each in the format that fits its platform (fill slides for carousels, video_script for reels/short video).',
    ].filter(Boolean).join('\n\n');

    const camp = await campaignContext(ws, (req.body || {}).campaign_id);
    if (camp.error) return res.status(camp.status).json({ error: camp.error });
    const brand = await brandContextFor(ws.id);
    const result = await generateJson({ system: SOCIAL_SYSTEM, prompt: brand.text + camp.text + prompt, schema: socialCaptionSchema, maxTokens: 12000 });
    req.usageInfo = result.__meta;
    const runId = crypto.randomUUID();

    const rows = (result.items || []).map((s) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      campaign_id: camp.campaign ? camp.campaign.id : null,
      brief_snapshot: camp.snapshot || null,
      prompt_version: AI_PROMPT_VERSION,
      generation_run_id: runId,
      platform: s.platform,
      content_type: s.content_type,
      pillar: s.pillar || null,
      hook: s.hook,
      caption: s.caption,
      cta: s.cta,
      visual_direction: s.visual_direction,
      slides: Array.isArray(s.slides) && s.slides.length ? s.slides : null,
      video_script: s.video_script && s.video_script.spoken_script ? s.video_script : null,
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
      context_used: brand.summary,
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
  'Generate genuinely DISTINCT concepts — each must differ by angle AND mechanism, never a minor headline ' +
  'variant. Set the angle field to that distinct mechanism.\n\n' +
  'Fill only the fields each format needs:\n' +
  '- static: angle, hook, headline, primary_text, visual_direction, designer_notes, text_overlays, cta.\n' +
  '- video / ugc: fill video_timeline (first_frame_hook, duration_seconds, scene-by-scene scenes with ' +
  'timecode/visual/spoken_script/on_screen_text, b_roll, product_moments, audio_direction, cta_end_card).\n' +
  '- carousel: fill slides (a cover slide, story slides, and a final CTA slide via the role field).\n' +
  '- search_ad: fill search_ad with headlines (each ≤30 characters), descriptions (each ≤90 characters) ' +
  'and keyword_groups grouped by search intent.\n' +
  'Every creative includes a test object: one major variable, hypothesis, control and success_metric — ' +
  'change ONE major variable per test.\n' +
  'Populate compliance_flags with any high-risk claims (guarantees, proof, urgency) that the user must ' +
  'verify; empty array if none.\n\n' +
  'Creative rules:\n' +
  '- Visual ideas must be shootable with the stated production constraints and props.\n' +
  '- Respect mandatory elements and never use prohibited claims.\n' +
  '- Use clear before/after or problem/solution angles without unrealistic claims or invented proof.\n' +
  '- Match funnel stage and audience temperature (cold vs warm vs hot).';

router.post('/generate-creative-assets', idempotent('generate-creative-assets'), planGate('asset_generations'), async (req, res, next) => {
  try {
    const ws = req.workspace;
    const {
      offer_id, launch_kit_id, target_language, platforms,
      creative_goal, formats, budget_level, extra_context,
      objective, funnel_stage, audience_temperature, placement, offer, proof,
      mandatory_elements, prohibited_claims, production_constraints,
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
      line('Objective', objective),
      line('Funnel stage', funnel_stage),
      line('Audience temperature', audience_temperature),
      line('Placement', placement),
      line('Formats', formats),
      line('Offer', offer),
      line('Proof available (use only this — never invent)', proof),
      line('Mandatory elements', mandatory_elements),
      line('Prohibited claims', prohibited_claims),
      line('Production constraints', production_constraints),
      line('Budget level', budget_level),
      line('Target language', target_language || 'English'),
      line('Extra context', extra_context),
      'Return a JSON items array of genuinely distinct concepts, each with its format-specific fields, a test object and compliance_flags.',
    ].filter(Boolean).join('\n\n');

    const camp = await campaignContext(ws, (req.body || {}).campaign_id);
    if (camp.error) return res.status(camp.status).json({ error: camp.error });
    const brand = await brandContextFor(ws.id);
    const result = await generateJson({ system: CREATIVE_SYSTEM, prompt: brand.text + camp.text + prompt, schema: creativeIdeasSchema, maxTokens: 12000 });
    req.usageInfo = result.__meta;
    const runId = crypto.randomUUID();

    const rows = (result.items || []).map((c) => ({
      workspace_id: ws.id,
      launch_kit_id: launch_kit_id || null,
      offer_id: offer_id || null,
      campaign_id: camp.campaign ? camp.campaign.id : null,
      brief_snapshot: camp.snapshot || null,
      prompt_version: AI_PROMPT_VERSION,
      generation_run_id: runId,
      platform: c.platform,
      creative_type: c.creative_type,
      angle: c.angle || null,
      hook: c.hook,
      headline: c.headline,
      primary_text: c.primary_text,
      visual_direction: c.visual_direction,
      designer_notes: c.designer_notes || null,
      shot_list: c.shot_list,
      text_overlays: c.text_overlays,
      video_timeline: c.video_timeline && c.video_timeline.first_frame_hook ? c.video_timeline : null,
      slides: Array.isArray(c.slides) && c.slides.length ? c.slides : null,
      search_ad: c.search_ad && Array.isArray(c.search_ad.headlines) && c.search_ad.headlines.length ? c.search_ad : null,
      cta: c.cta,
      testing_angle: c.testing_angle,
      test_matrix: c.test && c.test.variable ? c.test : null,
      compliance_flags: Array.isArray(c.compliance_flags) && c.compliance_flags.length ? c.compliance_flags : null,
      status: 'draft',
    }));
    const { data: saved, error } = await supabase.from('creative_assets').insert(rows).select();
    if (error) throw new Error('Failed to save creative assets: ' + error.message);

    res.json({
      ok: true,
      items: saved,
      quality_warnings: qualityWarnings('creative', result),
      plan: req.userPlan,
      context_used: brand.summary,
      usage: await usageFor(ws.id, req.userPlan, req.userEmail, req.userId),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
