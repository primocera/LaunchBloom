// ---------------------------------------------------------------------------
// v8 LB-S05: first-value activation checklist. Four states DERIVED from real
// server data — never a second manually-maintained completion flag. Each step
// resumes safely at its route. Pure function; the workspaces route feeds it.
//
// Steps: Brand baseline → Campaign Brief → First asset → Review/export.
// ---------------------------------------------------------------------------

// Server-side mirror of app-src/lib/next-actions.js minimumViableProfile():
// business/brand + a product + an audience + a language.
function profileBaselineComplete(profile) {
  const p = profile || {};
  const hasBusiness = Boolean(p.business_type || p.brand_name);
  const hasProduct = (Array.isArray(p.products_list) && p.products_list.some((r) => r && r.name)) || Boolean(p.products);
  const hasAudience = (Array.isArray(p.audiences) && p.audiences.some((r) => r && r.name)) ||
    (Array.isArray(p.audience_segments) && p.audience_segments.length > 0);
  const hasLanguage = (Array.isArray(p.languages) && p.languages.length > 0) || Boolean(p.language);
  return hasBusiness && hasProduct && hasAudience && hasLanguage;
}

/**
 * Derive the 4-step activation state.
 *   profile: brand_profiles row (or null)
 *   campaigns: [{brief_approved, archived}]
 *   assetCount: total saved assets across the five tables
 *   reviewedCount: assets with status ready/published (user-declared)
 */
function deriveActivation({ profile, campaigns, assetCount, reviewedCount }) {
  const steps = [
    {
      key: 'brand_baseline',
      label: 'Brand baseline',
      done: profileBaselineComplete(profile),
      to: '/app/brand',
      hint: 'Business, one product, one audience, a language — reused by every generation.',
    },
    {
      key: 'campaign_brief',
      label: 'Campaign Brief approved',
      done: (campaigns || []).some((c) => c.brief_approved && !c.archived),
      to: '/app/campaigns',
      hint: 'One approved brief keeps every asset on the same offer, dates and CTA.',
    },
    {
      key: 'first_asset',
      label: 'First asset generated',
      done: (assetCount || 0) > 0,
      to: '/app/create',
      hint: 'One focused asset first — the campaign system reveals itself after.',
    },
    {
      key: 'review_export',
      label: 'Reviewed and exported',
      done: (reviewedCount || 0) > 0,
      to: '/app/assets',
      hint: 'Resolve warnings, mark it Ready to export — the decision stays yours.',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  // Resume at the first incomplete step.
  const next = steps.find((s) => !s.done) || null;
  return { steps, done: doneCount, total: steps.length, next };
}

module.exports = { deriveActivation, profileBaselineComplete };
