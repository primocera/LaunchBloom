// ---------------------------------------------------------------------------
// v10 SC-02: what a campaign asset row shows without opening the asset.
//
// Pure, so it can be unit-tested without a browser — signed-in Playwright
// journeys need live Supabase Auth, which the credential-free E2E harness
// deliberately does not have. Keeping the decisions here (rather than inline
// in CampaignWorkspace) is how the rest of this codebase gets coverage on
// logic that lives behind a login.
//
// Blockers are SURFACED, never enforced: nothing here changes a canonical
// status (Draft / Needs review / Ready to export / Published). Those change
// only by an explicit user action.
// ---------------------------------------------------------------------------

// Higher rank wins when one asset has several open items against it.
const RANK = { blocking: 3, stale: 2, decision: 1 };

/**
 * Map "<table>:<id>" → the highest unresolved blocker for that asset, derived
 * from the campaign review payload. Acknowledged findings are resolved and are
 * deliberately not blockers.
 */
export function blockersByAsset(review) {
  const map = {};
  const put = (table, id, blocker, rank) => {
    if (!table || id == null) return;
    const key = `${table}:${id}`;
    if (!map[key] || rank > map[key].rank) map[key] = { ...blocker, rank };
  };

  for (const f of (review && review.findings) || []) {
    if (f.status === 'acknowledged') continue;
    const high = f.severity === 'high';
    for (const a of f.assets || []) {
      put(a.table, a.id, {
        label: high ? 'Blocks export' : 'Needs a decision',
        detail: f.why || String(f.code || '').replace(/_/g, ' '),
      }, high ? RANK.blocking : RANK.decision);
    }
  }
  for (const a of (review && review.stale) || []) {
    put(a.table, a.id, {
      label: 'Brief changed since generated',
      detail: 'Keep its snapshot on record or update it.',
    }, RANK.stale);
  }
  for (const a of (review && review.needs_review_assets) || []) {
    put(a.table, a.id, {
      label: 'Edited since generated',
      detail: 'Confirm it is ready or keep reviewing.',
    }, RANK.decision);
  }
  return map;
}

/**
 * True when an asset was generated from an older brief than the campaign now
 * carries. Unknown versions are never guessed at — an absent version is not
 * evidence of staleness.
 */
export function isStale(item, campaign) {
  if (!item || !campaign) return false;
  if (item.brief_version == null || campaign.brief_version == null) return false;
  return Number(item.brief_version) < Number(campaign.brief_version);
}
