import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import AssetDrawer, { statusLabel } from '../../components/AssetDrawer';
import { blockersByAsset, isStale } from '../../lib/asset-rows';
import {
  SECTIONS, missingDecisions, hasNoDates, fmtDate, sectionPath,
} from './shared';
import { campaignSummary, campaignNextAction, readinessGroups } from '../../lib/campaign-next-action';
import { safeInternalPath } from '../../lib/safe-path';
import {
  Deliverables, BriefImpact, PackagePreview, HandoffExports, SaveTemplate,
} from './panels';
import { ReviewWorkbench } from './ReviewWorkbench';
import BriefEditor from './BriefEditor';

// ---------------------------------------------------------------------------
// v9 SC-01/02: the campaign workspace. One campaign, six focused sections
// (Overview / Brief / Deliverables / Assets / Review / Handoff) reachable in a
// single click from the campaign list. Overview's next action and readiness
// come from the shared pure lib/campaign-next-action service (SC-02) so the
// Dashboard and Overview always agree. Canonical statuses are unchanged; there
// is no synthetic percentage score.
// ---------------------------------------------------------------------------

const READINESS_MARK = { ready: '✓', attention: '!', blocked: '✕', incomplete: '○', unknown: '·' };

export default function CampaignWorkspace() {
  const { campaignId, section = 'overview' } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);

  // v10 SC-02: a detail route fetches the detail endpoint. This used to pull
  // the entire campaign list and .find() the one it wanted, so opening one
  // campaign cost every campaign in the workspace and grew with the account.
  function load() {
    setError(null);
    api.campaign(campaignId)
      .then(({ campaign: c }) => setCampaign(c || null))
      .catch((e) => {
        // 404 is "not in your workspace"; anything else is a recoverable error
        // and must not masquerade as a missing campaign.
        if (e.status === 404) { setCampaign(null); return; }
        setError(e.message);
        setCampaign(null);
      });
  }
  useEffect(load, [campaignId]);

  // Route-view analytics: section code + coarse state only, never names/content.
  useEffect(() => {
    if (campaign) {
      api.trackEvent('campaign_section_viewed', {
        section,
        state: campaign.brief_approved ? 'approved' : missingDecisions(campaign).length ? 'incomplete' : 'draft',
      });
    }
  }, [section, campaign?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (campaign === undefined) return <div className="campaigns-page"><p className="muted">Loading campaign…</p></div>;
  if (campaign === null) {
    return (
      <div className="campaigns-page">
        <div className="brand-head"><h1>Campaign not found</h1></div>
        <p className="muted">{error || 'This campaign doesn’t exist or isn’t in your workspace.'}</p>
        <Link className="btn-primary" to="/app/campaigns">Back to campaigns</Link>
      </div>
    );
  }

  const validSection = SECTIONS.some(([key]) => key === section) ? section : 'overview';
  const missing = missingDecisions(campaign);

  return (
    <div className="campaigns-page campaign-workspace">
      <div className="brand-head">
        <div>
          <Link className="account-link" to="/app/campaigns">← Campaigns</Link>
          <h1 style={{ margin: '4px 0' }}>{campaign.name}{campaign.archived ? ' · archived' : ''}</h1>
          <span className={`campaign-badge ${campaign.brief_approved ? 'is-ok' : ''}`}>
            {campaign.brief_approved
              ? `Brief v${campaign.brief_version || 1} approved${campaign.brief_approved_at ? ` · ${fmtDate(campaign.brief_approved_at)}` : ''}`
              : missing.length
                ? `Brief incomplete · ${missing.length} required decision${missing.length === 1 ? '' : 's'} left`
                : 'Draft brief'}
          </span>
        </div>
      </div>

      {/* Quiet secondary navigation across the six campaign jobs. */}
      <nav className="campaign-tabs" aria-label="Campaign sections">
        {SECTIONS.map(([key, label]) => (
          <NavLink
            key={key}
            to={sectionPath(campaign.id, key)}
            end={key === 'overview'}
            className={({ isActive }) => `campaign-tab${isActive || key === validSection ? ' is-active' : ''}`}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {error && <p className="login-err">{error}</p>}

      <div className="campaign-section">
        {validSection === 'overview' && <Overview campaign={campaign} navigate={navigate} />}
        {validSection === 'brief' && <BriefSection campaign={campaign} onChange={load} />}
        {validSection === 'deliverables' && <Deliverables campaign={campaign} defaultOpen />}
        {validSection === 'assets' && <AssetsSection campaign={campaign} />}
        {validSection === 'review' && <ReviewWorkbench campaign={campaign} />}
        {validSection === 'handoff' && (
          <>
            <PackagePreview campaign={campaign} defaultOpen />
            <HandoffExports campaign={campaign} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Overview: one trustworthy next action + transparent readiness groups ──
function Overview({ campaign, navigate }) {
  const [review, setReview] = useState(null);
  const lastAction = useRef(null);

  useEffect(() => {
    api.campaignReview(campaign.id).then((r) => setReview(r.review)).catch(() => setReview(null));
  }, [campaign.id]);

  // Derive everything from canonical rows via the shared pure service — the
  // same summary the Dashboard uses, so both surfaces agree on the next action.
  const summary = campaignSummary(campaign, review);
  const na = campaignNextAction(summary);
  const groups = readinessGroups(summary);
  // v13 SC-P0-06: the destination is data-derived; validate it centrally so no
  // value can ever drive an off-origin navigation through this sink.
  const destination = safeInternalPath(na.destination);
  const isRoute = destination.startsWith('/app/campaigns');

  // next_action_viewed on each new action_code; next_action_completed when the
  // previously-viewed action is no longer current after a summary reload (a
  // durable, server-confirmed state change advanced the campaign).
  useEffect(() => {
    const prev = lastAction.current;
    if (prev && prev !== na.action_code) {
      api.trackEvent('next_action_completed', { action_code: prev, next: na.action_code, evaluated: summary.review.evaluated });
    }
    if (prev !== na.action_code) {
      api.trackEvent('next_action_viewed', { action_code: na.action_code, severity: na.severity, evaluated: summary.review.evaluated });
    }
    lastAction.current = na.action_code;
  }, [na.action_code]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <p className="muted">
        {[campaign.objective, campaign.audience && `→ ${campaign.audience}`,
          campaign.start_date && `${campaign.start_date} → ${campaign.end_date || 'open'}`]
          .filter(Boolean).join(' · ') || 'No details yet.'}
      </p>
      {hasNoDates(campaign) && (
        <p className="muted">No fixed dates — urgency or deadline language will not be generated.</p>
      )}

      {/* One primary next action, announced accessibly. */}
      <div className="account-section campaign-next" role="status" aria-live="polite">
        <h2 style={{ marginTop: 0 }}>Next: {na.label}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{na.reason}</p>
        {isRoute
          ? <button className="btn-primary" onClick={() => navigate(destination)}>{na.label}</button>
          : <a className="btn-primary" href={destination}>{na.label}</a>}
      </div>

      {/* Transparent readiness — four groups with reasons, no synthetic score. */}
      <div className="campaign-summary-grid">
        {groups.map((g) => (
          <div className={`account-section campaign-readiness is-${g.state}`} key={g.key}>
            <span className="muted">{READINESS_MARK[g.state] || '·'} {g.label}</span>
            <ul className="campaign-readiness-reasons">
              {g.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {campaign.strategy && (
        <div className="campaign-strategy">
          <p><strong>Core message:</strong> {campaign.strategy.core_message}</p>
          <p><strong>CTA:</strong> {campaign.strategy.cta}</p>
        </div>
      )}
    </div>
  );
}

// ── Brief: guided editor (autosave) + approve/reopen + optional AI strategy ──
function BriefSection({ campaign, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const missing = missingDecisions(campaign);

  async function approve() {
    // v9 SC-03: reopening an approved brief is explicit about downstream impact
    // and is never triggered by autosave.
    if (campaign.brief_approved) {
      if (!window.confirm(
        'Reopen this brief? New generations will pause until you approve it again. ' +
        'Assets you already generated keep the snapshot they were created from.'
      )) return;
      api.trackEvent('approved_brief_reopened', { had_strategy: !!campaign.strategy });
    }
    setError(null);
    try { await api.updateCampaign(campaign.id, { brief_approved: !campaign.brief_approved }); onChange(); }
    catch (err) { setError(err.message); }
  }

  async function strategy() {
    setBusy(true); setError(null);
    try { await api.generateCampaignStrategy(campaign.id); onChange(); }
    catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div>
      <BriefEditor campaign={campaign} onSaved={onChange} />

      {!campaign.brief_approved && (
        <p className="muted">
          Approving locks in what new generations inherit: your offer, audience, key message, terms and restrictions.
          Existing assets are unaffected. Approval is a human decision — it does not mean legally approved or fact-checked.
        </p>
      )}
      {error && <p className="login-err">{error}</p>}
      <div className="confirm-row">
        <button className="btn-secondary" onClick={approve} disabled={!campaign.brief_approved && missing.length > 0}
          title={!campaign.brief_approved && missing.length > 0 ? `Add ${missing.map(([, l]) => l).join(', ')} first` : undefined}>
          {campaign.brief_approved ? 'Reopen brief' : 'Approve brief and start creating'}
        </button>
        <button className="btn-secondary" onClick={strategy} disabled={busy}>
          {campaign.strategy ? 'Regenerate strategy · 1 AI action' : 'Generate strategy (optional) · 1 AI action'}
        </button>
        <SaveTemplate campaign={campaign} />
      </div>

      <div style={{ marginTop: 12 }}>
        <BriefImpact campaign={campaign} />
      </div>
    </div>
  );
}

// ── Assets: a complete working surface inside the campaign ──
// v10 SC-02: this used to be a dead-end list whose only real action was "open
// the global Library". It now carries the state a reviewer needs per row and
// opens the SAME shared drawer the Library uses — edit, rewrite, versions,
// diff, restore and export all happen here, in campaign context.
//
// Blockers are surfaced, never enforced as status: canonical statuses stay
// Draft / Needs review / Ready to export / Published and are only changed by an
// explicit user action. There is deliberately no bulk Ready/Published control
// and no share link.

function AssetsSection({ campaign }) {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);

  // Deep-linkable: ?asset=<table>:<id> keeps campaign context in the URL, so
  // Back closes the drawer and returns to this tab rather than leaving the
  // campaign entirely.
  const openParam = params.get('asset');
  const openAsset = openParam && openParam.includes(':')
    ? { table: openParam.split(':')[0], id: openParam.split(':').slice(1).join(':') }
    : null;
  const setOpenAsset = (a) => {
    const next = new URLSearchParams(params);
    if (a) next.set('asset', `${a.table}:${a.id}`); else next.delete('asset');
    setParams(next, { replace: !a });
  };

  function load() {
    setError(null);
    api.library({ campaign_id: campaign.id, per: 100 })
      .then((d) => setItems(d.items || []))
      .catch((e) => { setItems([]); setError(e.message); });
  }
  useEffect(load, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.campaignReview(campaign.id).then((r) => setReview(r.review)).catch(() => setReview(null));
  }, [campaign.id]);

  const blockers = blockersByAsset(review);

  return (
    <div>
      <div className="brand-head">
        <h2 style={{ margin: 0 }}>Assets</h2>
        <Link className="btn-primary" to={`/app/create?campaign=${campaign.id}`}>Create assets</Link>
      </div>

      {error && (
        <div className="account-section" role="alert">
          <p className="login-err" style={{ marginTop: 0 }}>{error}</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing was lost. <button className="account-link" onClick={load}>Try again</button>
          </p>
        </div>
      )}

      {items === null && <p className="muted">Loading assets…</p>}
      {items && items.length === 0 && !error && (
        <p className="muted">No assets linked to this campaign yet. Create the first one so it inherits the approved brief.</p>
      )}

      {(items || []).map((it) => {
        const key = `${it.table}:${it.id}`;
        const blocker = blockers[key];
        const stale = isStale(it, campaign);
        return (
          <div className="account-section campaign-asset-row" key={key}>
            <div className="library-title">
              <button className="library-open-link" onClick={() => setOpenAsset(it)}>
                {it.title || 'Untitled asset'}
              </button>
              <span className="campaign-badge">{it.type_label || it.table}</span>
              <span className="campaign-badge">{statusLabel(it)}</span>
            </div>
            <p className="muted" style={{ margin: '4px 0' }}>
              {[
                it.brief_version != null ? `Brief v${it.brief_version}${stale ? ` · campaign is on v${campaign.brief_version}` : ''}` : null,
                it.updated_at ? `Last edit ${fmtDate(it.updated_at)}` : null,
              ].filter(Boolean).join(' · ') || 'No edit history yet.'}
            </p>
            {blocker && (
              <p className="muted" style={{ margin: '4px 0' }}>
                <span className="campaign-badge">{blocker.label}</span> {blocker.detail}
              </p>
            )}
            <div className="confirm-row">
              <button className="btn-secondary" onClick={() => setOpenAsset(it)}>
                {blocker ? 'Open and resolve' : 'Open'}
              </button>
              {blocker && <Link className="account-link" to={sectionPath(campaign.id, 'review')}>Review queue →</Link>}
            </div>
          </div>
        );
      })}

      {items && items.length > 0 && (
        <p className="muted">
          <Link className="account-link" to={`/app/assets?campaign_id=${campaign.id}`}>
            Open these in the full Library →
          </Link>
        </p>
      )}

      {openAsset && (
        <AssetDrawer
          table={openAsset.table} id={openAsset.id}
          onClose={() => setOpenAsset(null)} onChanged={load} onError={setError}
        />
      )}
    </div>
  );
}
