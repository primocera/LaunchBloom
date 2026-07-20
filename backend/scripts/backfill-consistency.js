#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v8 LB-S10 — safe, resumable recompute of derived consistency findings.
//
// Why: the consistency engine (backend/lib/consistency.js) is normally run
// on demand per campaign. After a rules-version bump or a bulk import, findings
// on disk can lag reality. This job recomputes and RECONCILES findings the same
// way the live endpoint does — additive/upsert only, never a destructive rebuild.
// Source assets and snapshots stay authoritative; this touches only the derived
// consistency_findings lifecycle table. It consumes NO AI actions.
//
// Safety features (all required by the LB-S10 contract):
//   --dry-run            compute + report, write nothing (default is DRY-RUN)
//   --apply              actually upsert/resolve findings
//   --batch=N            workspaces per batch (default 25)
//   --since=<ISO>        checkpoint: only workspaces created/updated at/after
//   --workspace=<id>     limit to one workspace
//   BACKFILL_KILL=1      env kill switch — aborts before any write
//
// Idempotent: reconciliation is by fingerprint, so re-running converges to the
// same state and never double-writes.
// ---------------------------------------------------------------------------

const supabase = require('../lib/supabase');
const { runConsistencyChecks, RULES_VERSION } = require('../lib/consistency');

const ASSET_TABLES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function fullAssetsByTable(wsId, campaignId) {
  const out = {};
  for (const t of ASSET_TABLES) {
    const { data } = await supabase.from(t).select('*').eq('workspace_id', wsId).eq('campaign_id', campaignId);
    out[t] = data || [];
  }
  return out;
}

async function reconcileCampaign(wsId, campaign, apply) {
  const computed = runConsistencyChecks(campaign, await fullAssetsByTable(wsId, campaign.id));
  const { data: persisted } = await supabase
    .from('consistency_findings').select('fingerprint, status')
    .eq('workspace_id', wsId).eq('campaign_id', campaign.id);
  const byFp = new Map((persisted || []).map((r) => [r.fingerprint, r]));
  const currentFps = new Set(computed.map((f) => f.fingerprint));
  const now = new Date().toISOString();

  let resolved = 0;
  if (apply && computed.length) {
    const { error } = await supabase.from('consistency_findings').upsert(
      computed.map((f) => {
        const prev = byFp.get(f.fingerprint);
        const status = prev && prev.status === 'acknowledged' ? 'acknowledged' : 'open';
        return {
          workspace_id: wsId, campaign_id: campaign.id, fingerprint: f.fingerprint,
          code: f.code, severity: f.severity, rule_version: f.rule_version,
          status, last_seen_at: now, resolved_at: null,
        };
      }),
      { onConflict: 'campaign_id,fingerprint' }
    );
    if (error) throw new Error(`upsert failed for campaign ${campaign.id}: ${error.message}`);
  }
  const upserted = computed.length;

  for (const row of persisted || []) {
    if (row.status !== 'resolved' && !currentFps.has(row.fingerprint)) {
      resolved++;
      if (apply) {
        await supabase.from('consistency_findings').update({ status: 'resolved', resolved_at: now })
          .eq('campaign_id', campaign.id).eq('fingerprint', row.fingerprint);
      }
    }
  }
  return { upserted, resolved };
}

async function main() {
  const apply = hasFlag('apply');
  const dryRun = !apply;
  const batch = Math.max(1, parseInt(arg('batch', '25'), 10) || 25);
  const since = arg('since', null);
  const onlyWs = arg('workspace', null);

  if (process.env.BACKFILL_KILL === '1') {
    console.error('Kill switch active (BACKFILL_KILL=1) — aborting before any write.');
    process.exit(2);
  }

  console.log(`Consistency backfill — mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}, rules ${RULES_VERSION}, batch ${batch}` +
    (since ? `, since ${since}` : '') + (onlyWs ? `, workspace ${onlyWs}` : ''));

  let wsQuery = supabase.from('workspaces').select('id').order('created_at', { ascending: true });
  if (onlyWs) wsQuery = wsQuery.eq('id', onlyWs);
  const { data: workspaces, error } = await wsQuery;
  if (error) throw new Error('workspace query failed: ' + error.message);

  const totals = { workspaces: 0, campaigns: 0, upserted: 0, resolved: 0 };
  for (let i = 0; i < (workspaces || []).length; i += batch) {
    if (process.env.BACKFILL_KILL === '1') { console.error('Kill switch tripped mid-run — stopping.'); break; }
    const slice = workspaces.slice(i, i + batch);
    for (const ws of slice) {
      let cQuery = supabase.from('campaigns').select('*').eq('workspace_id', ws.id);
      if (since) cQuery = cQuery.gte('updated_at', since);
      const { data: campaigns } = await cQuery;
      if (!campaigns || !campaigns.length) continue;
      totals.workspaces++;
      for (const c of campaigns) {
        const r = await reconcileCampaign(ws.id, c, apply);
        totals.campaigns++;
        totals.upserted += r.upserted;
        totals.resolved += r.resolved;
      }
    }
    console.log(`  checkpoint: processed ${Math.min(i + batch, workspaces.length)}/${workspaces.length} workspaces`);
  }

  console.log(`\n${dryRun ? 'Would upsert' : 'Upserted'} ${totals.upserted} finding(s), ` +
    `${dryRun ? 'would resolve' : 'resolved'} ${totals.resolved} stale finding(s) across ` +
    `${totals.campaigns} campaign(s) in ${totals.workspaces} workspace(s).`);
  if (dryRun) console.log('Dry run — nothing written. Re-run with --apply to persist.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('backfill failed:', e.message); process.exit(1); });
}

module.exports = { reconcileCampaign };
