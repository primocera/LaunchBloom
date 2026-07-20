// ---------------------------------------------------------------------------
// v8 LB-S03: brief-change impact and stale-asset review.
//
// Turns brief snapshots into change control: a field-level diff of the CURRENT
// brief against each asset's generation-time snapshot, restricted to the
// fields that are material for that asset's studio. Pure functions — the
// campaigns route feeds rows and persists explicit "keep snapshot" decisions
// keyed by the diff fingerprint, so a further brief change reopens the review
// automatically. Diffing and reviewing never spend an AI action, and an
// unchanged snapshot is never claimed to be factually correct.
// ---------------------------------------------------------------------------

const { fingerprint } = require('./consistency');

// Version the field-dependency mapping so stored decisions can be interpreted.
const DEPENDENCIES_VERSION = 'v8.1';

// Which brief fields are material per studio table. Changes to other fields
// (e.g. internal name) are informational and do not mark assets stale.
const MATERIAL_FIELDS = {
  website_pages: ['offer_summary', 'promo_terms', 'key_message', 'audience', 'start_date', 'end_date', 'deadline', 'restrictions'],
  email_assets: ['offer_summary', 'promo_terms', 'key_message', 'audience', 'start_date', 'end_date', 'deadline', 'restrictions'],
  social_assets: ['offer_summary', 'promo_terms', 'key_message', 'audience', 'start_date', 'end_date', 'restrictions'],
  creative_assets: ['offer_summary', 'promo_terms', 'key_message', 'audience', 'restrictions'],
  seo_assets: ['offer_summary', 'key_message', 'audience'],
};

const FIELD_LABEL = {
  offer_summary: 'Offer',
  promo_terms: 'Promo terms',
  key_message: 'Key message',
  audience: 'Audience',
  start_date: 'Start date',
  end_date: 'End date',
  deadline: 'Deadline',
  restrictions: 'Restrictions',
};

const norm = (v) => (v == null ? '' : String(v).trim());

/** Field-level diff of the current brief vs one asset's snapshot (material
 *  fields for its table only). Assets without a snapshot cannot be diffed. */
function briefDiffForAsset(campaign, table, asset) {
  const snap = asset && asset.brief_snapshot;
  if (!snap) return [];
  const c = campaign || {};
  return (MATERIAL_FIELDS[table] || [])
    .filter((f) => norm(snap[f]) !== norm(c[f]))
    .map((f) => ({
      field: f,
      label: FIELD_LABEL[f] || f,
      old_value: norm(snap[f]) || '(empty)',
      new_value: norm(c[f]) || '(empty)',
    }));
}

/** Stable fingerprint of one asset's diff — a kept snapshot stays kept only
 *  while the diff is exactly this; any further brief change reopens review. */
function diffFingerprint(table, assetId, changed) {
  return fingerprint([
    DEPENDENCIES_VERSION, 'brief-diff', table, assetId,
    ...changed.map((ch) => `${ch.field}=${ch.old_value}→${ch.new_value}`),
  ]);
}

/**
 * Impact map for a whole campaign. reviews: persisted keep-snapshot decisions
 * [{asset_table, asset_id, diff_fingerprint, reviewed_at, reviewer}].
 * Every affected asset gets independent choices; nothing propagates silently.
 */
function campaignImpact(campaign, assetsByTable, reviews) {
  const reviewByAsset = new Map((reviews || []).map((r) => [`${r.asset_table}:${r.asset_id}`, r]));
  const affected = [];
  let reviewed = 0;

  for (const [table, rows] of Object.entries(assetsByTable || {})) {
    for (const asset of rows || []) {
      const changed = briefDiffForAsset(campaign, table, asset);
      if (!changed.length) continue;
      const fp = diffFingerprint(table, asset.id, changed);
      const review = reviewByAsset.get(`${table}:${asset.id}`);
      const kept = Boolean(review && review.diff_fingerprint === fp);
      if (kept) reviewed++;
      affected.push({
        table,
        id: asset.id,
        title: norm(asset.title || asset.subject_line || asset.hook || asset.h1 || asset.page_type || asset.flow_type) || 'Untitled',
        status: asset.status || 'draft',
        changed,
        diff_fingerprint: fp,
        // 'review_brief_changes' until the user decides; 'snapshot_kept' after
        // an explicit keep decision for exactly this diff. The customer-facing
        // asset status (Draft/Needs review/Ready/Published) is never rewritten.
        review_state: kept ? 'snapshot_kept' : 'review_brief_changes',
        reviewed_at: kept ? review.reviewed_at : null,
      });
    }
  }

  return {
    dependencies_version: DEPENDENCIES_VERSION,
    affected,
    open: affected.length - reviewed,
    kept: reviewed,
  };
}

module.exports = {
  DEPENDENCIES_VERSION,
  MATERIAL_FIELDS,
  briefDiffForAsset,
  diffFingerprint,
  campaignImpact,
};
