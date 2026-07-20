// ---------------------------------------------------------------------------
// v8 LB-S01: server-confirmed deliverable progress events. Fired only after a
// successful save/status change (never from the client), with categorical
// properties only — no content. Failures never break the request (track()
// already swallows errors; the lookup here is also best-effort).
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const { track } = require('./analytics');
const { DELIVERABLES } = require('./deliverables');

const CODE_BY_TABLE = Object.fromEntries(DELIVERABLES.map((d) => [d.table, d.code]));

/**
 * If `table`'s deliverable is marked required in this campaign's plan, emit
 * required_deliverable_started (phase 'started', after a successful asset
 * save) or required_deliverable_ready (phase 'ready', after a user status
 * change to ready). No-op when there is no campaign or no saved plan.
 */
async function trackDeliverableProgress({ workspaceId, userId, campaignId, table, phase }) {
  try {
    const code = CODE_BY_TABLE[table];
    if (!code || !campaignId) return;
    const { data } = await supabase
      .from('campaign_deliverables').select('requirement_state')
      .eq('workspace_id', workspaceId).eq('campaign_id', campaignId)
      .eq('deliverable_code', code).single();
    if (!data || data.requirement_state !== 'required') return;
    await track(phase === 'ready' ? 'required_deliverable_ready' : 'required_deliverable_started', {
      userId,
      workspaceId,
      properties: { deliverable: code },
    });
  } catch (err) {
    console.error('[deliverables] progress track failed', err.message);
  }
}

module.exports = { trackDeliverableProgress };
