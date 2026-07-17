// ---------------------------------------------------------------------------
// v5 Prompt 4: deterministic Home recommendations. Pure functions, no imports
// — unit-tested from backend/tests/next-actions.test.js via dynamic import.
//
// homePlan() returns:
//   { primary: {to,label},  actions: [{to,label,reason}] (max 3),
//     usageLevel: 'ok'|'warn'|'over' }
// ---------------------------------------------------------------------------

const ESSENTIAL_PROFILE_FIELDS = ['brand_name', 'business_type', 'products', 'audience_segments', 'tone'];

export function profileMissing(profile) {
  const p = profile || {};
  return ESSENTIAL_PROFILE_FIELDS.filter((f) => {
    const v = p[f];
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

export function usageLevel(account) {
  const used = account?.usage?.ai_actions ?? 0;
  const limit = account?.limits?.ai_actions;
  if (limit == null || limit === 0) return used > 0 ? 'over' : 'ok';
  if (used >= limit) return 'over';
  if (used / limit >= 0.8) return 'warn';
  return 'ok';
}

/** Most recently updated unfinished (draft/edited) asset, or null. */
export function latestUnfinished(assets) {
  const drafts = (assets || []).filter((a) => !a.status || a.status === 'draft' || a.status === 'edited');
  if (!drafts.length) return null;
  return [...drafts].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
}

export function homePlan({ profile, campaigns, assets, kit, account, plan }) {
  const missing = profileMissing(profile);
  const activeCampaigns = (campaigns || []).filter((c) => c.status !== 'archived');
  const unfinished = latestUnfinished(assets);
  const level = usageLevel(account);
  const actions = [];

  // ── one context-aware primary action ──
  let primary;
  if (plan === 'free' || !plan) {
    primary = missing.length >= ESSENTIAL_PROFILE_FIELDS.length - 1
      ? { to: '/app/brand', label: 'Set up your Brand Profile' }
      : { to: '/app/create', label: 'Start your 3-day trial and generate' };
  } else if (level === 'over') {
    primary = { to: '/app/account', label: 'Review your plan and usage' };
  } else if (missing.length >= ESSENTIAL_PROFILE_FIELDS.length - 1) {
    primary = { to: '/app/brand', label: 'Set up your Brand Profile' };
  } else if (unfinished) {
    primary = { to: '/app/assets', label: `Continue “${unfinished.title || unfinished.type || 'your draft'}”` };
  } else if (!activeCampaigns.length) {
    primary = { to: '/app/campaigns', label: 'Create your first campaign' };
  } else {
    primary = { to: '/app/create', label: `Create assets for “${activeCampaigns[0].name}”` };
  }

  // ── up to three next best actions (never duplicating the primary) ──
  if (missing.length && primary.to !== '/app/brand') {
    actions.push({ to: '/app/brand', label: 'Complete your Brand Profile', reason: `${missing.length} essential field${missing.length === 1 ? '' : 's'} missing` });
  }
  if (!activeCampaigns.length && primary.to !== '/app/campaigns') {
    actions.push({ to: '/app/campaigns', label: 'Create your first campaign', reason: 'Campaigns keep every asset on one brief' });
  }
  for (const c of activeCampaigns) {
    if (actions.length >= 3) break;
    const assetCount = Object.values(c.asset_counts || {}).reduce((a, b) => a + b, 0);
    if (assetCount === 0 && primary.label.indexOf(c.name) === -1) {
      actions.push({ to: '/app/create', label: `Generate assets for “${c.name}”`, reason: 'This campaign has no assets yet' });
    }
  }
  if (unfinished && primary.to !== '/app/assets' && actions.length < 3) {
    actions.push({ to: '/app/assets', label: `Finish “${unfinished.title || 'your draft'}”`, reason: 'Unfinished draft' });
  }
  if (!kit && actions.length < 3 && plan && plan !== 'free') {
    actions.push({ to: '/app/campaigns', label: 'Run the Full launch campaign', reason: 'Positioning, offer and a complete launch kit' });
  }

  return { primary, actions: actions.slice(0, 3), usageLevel: level };
}
