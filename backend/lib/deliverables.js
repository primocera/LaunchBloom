// ---------------------------------------------------------------------------
// v8 LB-S01: campaign deliverable plan + gap map.
//
// A campaign declares which outcomes it actually needs (required / optional /
// not needed) instead of an implied five-of-five checklist. States are derived
// purely from stored selections + real asset rows — never an opaque score.
// Pure functions: no supabase, no AI, no quota. Consumed by the campaigns
// routes and unit-tested directly.
// ---------------------------------------------------------------------------

// One deliverable per canonical Create path; the asset table each maps to is
// the same table the studios already save into (004/018-021 migrations).
const DELIVERABLES = [
  { code: 'landing_page', label: 'Landing page', table: 'website_pages', studio: '/app/studio/website' },
  { code: 'email_flow', label: 'Launch email flow', table: 'email_assets', studio: '/app/studio/email-flow' },
  { code: 'social_set', label: 'Social launch set', table: 'social_assets', studio: '/app/studio/social' },
  { code: 'creative_brief', label: 'Ad creative brief', table: 'creative_assets', studio: '/app/studio/creative' },
  { code: 'seo_ideas', label: 'SEO research ideas', table: 'seo_assets', studio: '/app/studio/seo' },
];

const DELIVERABLE_CODES = DELIVERABLES.map((d) => d.code);
const REQUIREMENT_STATES = ['required', 'optional', 'not_needed'];

// Brief fields a required deliverable depends on before generation makes sense
// (mirrors REQUIRED_DECISIONS in app-src/routes/Campaigns.jsx).
const REQUIRED_BRIEF_FIELDS = [
  ['objective', 'a goal'],
  ['audience', 'an audience'],
  ['offer_summary', 'an offer'],
  ['key_message', 'a key message'],
];

/** Missing required brief decisions, as human labels. Pure. */
function missingBriefFields(campaign) {
  const c = campaign || {};
  return REQUIRED_BRIEF_FIELDS
    .filter(([k]) => c[k] == null || (typeof c[k] === 'string' && c[k].trim() === ''))
    .map(([, label]) => label);
}

/**
 * Derive one deliverable's state from its requirement + its campaign assets.
 * assets: [{ status }] rows from the deliverable's table for this campaign.
 * Returns one of: 'excluded' | 'not_planned' | 'in_progress' | 'needs_review'
 * | 'ready'. "Ready" means at least one asset the user marked ready/published;
 * it is a user decision, never something LaunchBloom published.
 */
function deliverableState(requirement, assets) {
  if (requirement === 'not_needed') return 'excluded';
  const list = assets || [];
  if (list.length === 0) return 'not_planned';
  if (list.some((a) => a.status === 'ready' || a.status === 'published')) return 'ready';
  if (list.some((a) => a.status === 'edited')) return 'needs_review';
  return 'in_progress';
}

const STATE_LABEL = {
  excluded: 'Excluded from this campaign',
  not_planned: 'Not started',
  in_progress: 'In progress',
  needs_review: 'Needs review',
  ready: 'Ready',
};

/**
 * Build the campaign gap map. Every row explains its state from real data and
 * lists transparent blockers (no percentage score, no invented deadline).
 *
 * planRows:      saved campaign_deliverables rows [{deliverable_code, requirement_state}]
 * assetsByTable: { website_pages: [{status}], ... } scoped to this campaign
 */
function campaignGap(campaign, planRows, assetsByTable) {
  const plan = new Map((planRows || []).map((r) => [r.deliverable_code, r.requirement_state]));
  const briefMissing = missingBriefFields(campaign);
  const planSaved = plan.size > 0;

  const rows = DELIVERABLES.map((d) => {
    // Backfill semantics: campaigns without a saved plan are "unplanned" —
    // we never infer that every channel is required.
    const requirement = plan.get(d.code) || 'unplanned';
    const assets = (assetsByTable && assetsByTable[d.table]) || [];
    const state = requirement === 'unplanned'
      ? deliverableState('optional', assets)
      : deliverableState(requirement, assets);

    const blockers = [];
    if (requirement === 'required') {
      if (briefMissing.length) blockers.push(`Complete the brief first: add ${briefMissing.join(', ')}.`);
      if (assets.length === 0) blockers.push('No asset generated or added yet.');
      if (state === 'needs_review') blockers.push('An asset still needs your review before it can be exported.');
    }

    return {
      code: d.code,
      label: d.label,
      studio: d.studio,
      table: d.table,
      requirement,
      state,
      state_label: STATE_LABEL[state],
      asset_count: assets.length,
      blockers,
    };
  });

  const required = rows.filter((r) => r.requirement === 'required');
  return {
    plan_saved: planSaved,
    deliverables: rows,
    required_total: required.length,
    required_ready: required.filter((r) => r.state === 'ready').length,
    // A campaign with two required channels is complete without the other
    // three; no plan means we simply don't claim completeness either way.
    all_required_ready: planSaved && required.length > 0 && required.every((r) => r.state === 'ready'),
    brief_missing: briefMissing,
  };
}

/** Validate a client-submitted plan; returns {ok, error?, rows?}. */
function validatePlan(body) {
  const list = body && Array.isArray(body.deliverables) ? body.deliverables : null;
  if (!list) return { ok: false, error: 'Send { deliverables: [{ code, requirement_state }] }.' };
  const rows = [];
  for (const item of list) {
    const code = item && item.code;
    const state = item && item.requirement_state;
    if (!DELIVERABLE_CODES.includes(code)) return { ok: false, error: `Unknown deliverable code: ${String(code).slice(0, 40)}` };
    if (!REQUIREMENT_STATES.includes(state)) return { ok: false, error: `Unknown requirement state: ${String(state).slice(0, 40)}` };
    if (rows.some((r) => r.deliverable_code === code)) return { ok: false, error: `Duplicate deliverable code: ${code}` };
    rows.push({ deliverable_code: code, requirement_state: state });
  }
  if (rows.length === 0) return { ok: false, error: 'Choose at least one deliverable state.' };
  return { ok: true, rows };
}

module.exports = {
  DELIVERABLES,
  DELIVERABLE_CODES,
  REQUIREMENT_STATES,
  STATE_LABEL,
  missingBriefFields,
  deliverableState,
  campaignGap,
  validatePlan,
};
