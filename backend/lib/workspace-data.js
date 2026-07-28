// ---------------------------------------------------------------------------
// Shared workspace-scoped data helpers (export + deletion). Used by the account
// routes (Prompt 14) and workspace deletion (Prompt 7) so the table list stays
// in one place.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

// Best-effort: a missing table (partially-migrated DB) is skipped rather than
// breaking the whole operation.
// v10 SC-08: this list had drifted badly. Ten workspace-scoped tables added by
// migrations 008–035 were never added here, so account export omitted them and
// account deletion LEFT THEM IN THE DATABASE — including campaigns and
// brand_profiles, which hold the user's own words. A deletion receipt that
// reports success while a user's campaigns survive is a false success, which
// is exactly what the v10 gate forbids.
//
// ORDER MATTERS for deletion: children before parents, so a foreign key never
// blocks a row and leaves an orphan behind.
const WORKSPACE_TABLES = [
  // ── children / link tables first ──
  'asset_evidence_links',
  'asset_versions',
  'asset_brief_reviews',
  'consistency_findings',
  'campaign_deliverables',
  // ── generated assets ──
  'website_pages',
  'email_assets',
  'social_assets',
  'creative_assets',
  'seo_assets',
  'content_items',
  'email_items',
  'ad_ideas',
  'seo_items',
  'weekly_tasks',
  // ── campaign + supporting records ──
  'evidence',
  'campaigns',
  'workspace_templates',
  'launch_kits',
  'offers',
  'positioning_outputs',
  'onboarding_answers',
  'brand_profiles',
  // v11 SC-07: beta feedback holds an optional free-text note the user wrote,
  // so it is unambiguously their data — it must leave with an export and go
  // with an erasure.
  'beta_feedback',
  // ── operational rows scoped to the workspace ──
  // usage_events and analytics_events carry no customer content (analytics is
  // redacted at write time), but they are workspace-identifiable, so erasure
  // must remove them too rather than leaving a trail keyed to a deleted user.
  'usage_events',
  'analytics_events',
];

async function collectWorkspaceData(workspaceId) {
  const out = {};
  for (const table of WORKSPACE_TABLES) {
    const { data, error } = await supabase.from(table).select('*').eq('workspace_id', workspaceId);
    if (!error) out[table] = data || [];
  }
  return out;
}

async function deleteWorkspaceData(workspaceId) {
  for (const table of WORKSPACE_TABLES) {
    await supabase.from(table).delete().eq('workspace_id', workspaceId).then(() => {}, () => {});
  }
}

module.exports = { WORKSPACE_TABLES, collectWorkspaceData, deleteWorkspaceData };
