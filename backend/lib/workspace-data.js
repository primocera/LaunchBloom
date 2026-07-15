// ---------------------------------------------------------------------------
// Shared workspace-scoped data helpers (export + deletion). Used by the account
// routes (Prompt 14) and workspace deletion (Prompt 7) so the table list stays
// in one place.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

// Best-effort: a missing table (partially-migrated DB) is skipped rather than
// breaking the whole operation.
const WORKSPACE_TABLES = [
  'onboarding_answers',
  'positioning_outputs',
  'offers',
  'launch_kits',
  'content_items',
  'email_items',
  'ad_ideas',
  'seo_items',
  'weekly_tasks',
  'website_pages',
  'email_assets',
  'social_assets',
  'creative_assets',
  'seo_assets',
  'usage_events',
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
