import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  SECTIONS, missingDecisions, hasNoDates, fmtDate, totalAssets, sectionPath,
} from './shared';
import {
  Deliverables, Consistency, BriefImpact, ReviewQueue,
  PackagePreview, HandoffExports, SaveTemplate,
} from './panels';
import BriefEditor from './BriefEditor';

// ---------------------------------------------------------------------------
// v9 SC-01: the campaign workspace. One campaign, six focused sections
// (Overview / Brief / Deliverables / Assets / Review / Handoff) reachable in a
// single click from the campaign list. Replaces the old Campaigns.jsx monolith
// where every tool was stacked on one card. Canonical statuses are unchanged;
// there is no synthetic percentage score.
// ---------------------------------------------------------------------------

/** Deterministic single next action for a campaign. SC-02 will formalise this
 *  into a shared pure service; this keeps Overview honest in the meantime. */
function nextAction(campaign) {
  const missing = missingDecisions(campaign);
  if (missing.length) {
    return { to: 'brief', label: 'Complete the campaign brief', reason: `${missing.length} required decision${missing.length === 1 ? '' : 's'} left` };
  }
  if (!campaign.brief_approved) {
    return { to: 'brief', label: 'Approve the brief and start creating', reason: 'The brief is complete but not approved' };
  }
  const required = (campaign.deliverable_plan || []).filter((r) => r.requirement_state === 'required');
  if (!campaign.deliverable_plan || campaign.deliverable_plan.length === 0) {
    return { to: 'deliverables', label: 'Plan the deliverables', reason: 'Choose what this campaign needs' };
  }
  if (totalAssets(campaign) === 0 && required.length) {
    return { to: 'assets', label: 'Create the required assets', reason: `${required.length} required deliverable${required.length === 1 ? '' : 's'} planned`, href: `/app/create?campaign=${campaign.id}` };
  }
  return { to: 'review', label: 'Review the campaign', reason: 'Check consistency and brief changes before handoff' };
}

export default function CampaignWorkspace() {
  const { campaignId, section = 'overview' } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);

  function load() {
    api.campaigns()
      .then(({ campaigns }) => {
        const c = (campaigns || []).find((x) => String(x.id) === String(campaignId));
        setCampaign(c || null);
      })
      .catch((e) => { setError(e.message); setCampaign(null); });
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
        {validSection === 'review' && (
          <>
            <Consistency campaign={campaign} defaultOpen />
            <BriefImpact campaign={campaign} defaultOpen />
            <ReviewQueue campaign={campaign} defaultOpen />
          </>
        )}
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

// ── Overview: status, blockers and one primary next action ──
function Overview({ campaign, navigate }) {
  const [review, setReview] = useState(null);
  const na = nextAction(campaign);

  useEffect(() => {
    api.campaignReview(campaign.id).then((r) => setReview(r.review)).catch(() => setReview(null));
  }, [campaign.id]);

  const required = (campaign.deliverable_plan || []).filter((r) => r.requirement_state === 'required');
  const highMed = review ? (review.blocking?.length || 0) + (review.findings?.length || 0) : null;

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

      {/* One primary next action. */}
      <div className="account-section campaign-next">
        <h2 style={{ marginTop: 0 }}>Next: {na.label}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{na.reason}</p>
        {na.href
          ? <a className="btn-primary" href={na.href}>{na.label}</a>
          : <button className="btn-primary" onClick={() => navigate(sectionPath(campaign.id, na.to))}>{na.label}</button>}
      </div>

      {/* Readiness summary — real counts, no synthetic score. */}
      <div className="campaign-summary-grid">
        <SummaryCard label="Required deliverables" value={`${required.length} planned`} />
        <SummaryCard label="Linked assets" value={`${totalAssets(campaign)}`} />
        <SummaryCard label="Open review items" value={highMed == null ? '—' : `${highMed}`} />
        <SummaryCard label="Brief changes to review" value={review ? `${review.stale?.length || 0}` : '—'} />
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

function SummaryCard({ label, value }) {
  return (
    <div className="account-section campaign-summary-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
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

// ── Assets: campaign-filtered library items (compact) ──
function AssetsSection({ campaign }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.library({ campaign_id: campaign.id, per: 100 })
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message));
  }, [campaign.id]);

  return (
    <div>
      <div className="brand-head">
        <h2 style={{ margin: 0 }}>Assets</h2>
        <a className="btn-primary" href={`/app/create?campaign=${campaign.id}`}>Create assets</a>
      </div>
      {error && <p className="login-err">{error}</p>}
      {items === null && <p className="muted">Loading assets…</p>}
      {items && items.length === 0 && (
        <p className="muted">No assets linked to this campaign yet. Create the first one so it inherits the approved brief.</p>
      )}
      {items && items.map((it) => (
        <div className="account-section" key={`${it.table}:${it.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{it.title || it.type_label || 'Untitled asset'}</span>
          <span className="campaign-badge">{it.type_label || it.table}</span>
        </div>
      ))}
      {items && items.length > 0 && (
        <p className="muted"><a className="account-link" href="/app/assets">Open the full Library →</a></p>
      )}
    </div>
  );
}
