// ---------------------------------------------------------------------------
// v9 SC-01: shared campaign constants + pure helpers. One source of truth for
// the campaign list (Campaigns.jsx) and the campaign workspace sections —
// no component re-derives status or brief rules on its own.
// ---------------------------------------------------------------------------

export const CHANNELS = ['email', 'social', 'ads', 'landing'];

export const EMPTY_BRIEF = {
  name: '', objective: '', audience: '', offer_summary: '', promo_terms: '',
  key_message: '', proof: '', restrictions: '', markets: '', language: '',
  start_date: '', end_date: '', deadline: '', channels: ['email', 'social'],
};

// v5 Prompt 6: campaign templates prefill the brief.
export const TEMPLATES = [
  { key: 'launch', label: 'Product launch', brief: { objective: 'Launch a new product and drive first sales', channels: ['email', 'social', 'ads', 'landing'] } },
  { key: 'promo', label: 'Promotion', brief: { objective: 'Run a limited-time promotion', channels: ['email', 'social', 'ads'] } },
  { key: 'evergreen', label: 'Evergreen sales', brief: { objective: 'Steady sales content for the core offer', channels: ['email', 'social'] } },
  { key: 'leadgen', label: 'Lead generation', brief: { objective: 'Grow the email list with a lead magnet', channels: ['landing', 'social', 'ads'] } },
  { key: 'content', label: 'Content month', brief: { objective: 'A month of consistent audience-building content', channels: ['social', 'email'] } },
];

// Playbook v6 Prompt 18: the brief is a contract — these decisions must be
// present before assets can inherit a coherent campaign.
export const REQUIRED_DECISIONS = [
  ['objective', 'a goal'],
  ['audience', 'an audience'],
  ['offer_summary', 'an offer'],
  ['key_message', 'a key message'],
];

export function missingDecisions(c) {
  return REQUIRED_DECISIONS.filter(([k]) => {
    const v = c[k];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
}

export function hasNoDates(c) {
  return !c.start_date && !c.end_date && !c.deadline;
}

export function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

export function totalAssets(c) {
  return Object.values(c?.asset_counts || {}).reduce((a, b) => a + b, 0);
}

// v8 LB-S03 (fixed in v9 SC-01): asset table → the real studio route. The old
// map pointed at /app/studio/* which never existed in App.jsx and 404'd.
export const STUDIO_BY_TABLE = {
  website_pages: '/app/website',
  email_assets: '/app/email-studio',
  social_assets: '/app/social',
  creative_assets: '/app/creative',
  seo_assets: '/app/seo',
};

// v8 LB-S01: which deliverables a channel suggests — prefill only.
export const CHANNEL_SUGGESTS = {
  email: ['email_flow'],
  social: ['social_set'],
  ads: ['creative_brief'],
  landing: ['landing_page'],
};

export const REQUIREMENT_OPTIONS = [
  ['required', 'Required'],
  ['optional', 'Optional'],
  ['not_needed', 'Not needed'],
];

// v9 SC-01: the six campaign jobs, each with exactly one destination.
export const SECTIONS = [
  ['overview', 'Overview'],
  ['brief', 'Brief'],
  ['deliverables', 'Deliverables'],
  ['assets', 'Assets'],
  ['review', 'Review'],
  ['handoff', 'Handoff'],
];

export function sectionPath(campaignId, section) {
  return `/app/campaigns/${campaignId}${section && section !== 'overview' ? `/${section}` : ''}`;
}
