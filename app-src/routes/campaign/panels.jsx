import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { download } from '../../lib/export';
import { CHANNEL_SUGGESTS, REQUIREMENT_OPTIONS, STUDIO_BY_TABLE } from './shared';

// ---------------------------------------------------------------------------
// v9 SC-01: the v8 campaign control panels, extracted verbatim from the old
// Campaigns.jsx monolith into reusable modules. Behaviour is unchanged; each
// now takes an optional `defaultOpen` so a dedicated workspace section can show
// it expanded instead of behind a toggle button. Export controls were pulled
// out of ReviewQueue into HandoffExports so the Handoff section owns export.
// ---------------------------------------------------------------------------

function useAutoOpen(defaultOpen, load) {
  useEffect(() => {
    if (defaultOpen) load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// v8 LB-S01: per-campaign deliverable plan + gap map. Deterministic and free.
export function Deliverables({ campaign, defaultOpen }) {
  const [open, setOpen] = useState(false);
  const [gap, setGap] = useState(null);
  const [draft, setDraft] = useState(null); // {code: requirement_state}
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    try {
      const { gap: g } = await api.campaignDeliverables(campaign.id);
      setGap(g);
      const suggested = (campaign.channels || []).flatMap((ch) => CHANNEL_SUGGESTS[ch] || []);
      const next = {};
      for (const d of g.deliverables) {
        next[d.code] = d.requirement !== 'unplanned' ? d.requirement
          : suggested.includes(d.code) ? 'optional' : 'not_needed';
      }
      setDraft(next);
    } catch (err) { setError(err.message); }
  }
  useAutoOpen(defaultOpen, load);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const list = Object.entries(draft).map(([code, requirement_state]) => ({ code, requirement_state }));
      const { gap: g } = await api.saveCampaignDeliverables(campaign.id, list);
      setGap(g);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  if (!open) {
    return (
      <button className="btn-secondary" onClick={load}>
        Campaign deliverables{campaign.deliverable_plan && campaign.deliverable_plan.length ? '' : ' · not planned yet'}
      </button>
    );
  }
  if (!gap || !draft) return <p className="muted">{error || 'Loading deliverables…'}</p>;

  return (
    <div className="campaign-deliverables">
      <h3 style={{ marginBottom: 4 }}>Campaign deliverables</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose what this campaign actually needs — a campaign with two required outcomes is complete
        without the other three.{!gap.plan_saved && ' Suggestions come from your selected channels; nothing is required until you save.'}
      </p>
      {gap.deliverables.map((d) => (
        <div key={d.code} className="confirm-row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ minWidth: 160 }}>{d.label}</strong>
          <select
            value={draft[d.code]}
            onChange={(e) => setDraft({ ...draft, [d.code]: e.target.value })}
            aria-label={`${d.label} requirement`}
          >
            {REQUIREMENT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}{d.requirement === 'unplanned' && draft[d.code] === v ? ' (suggested)' : ''}</option>
            ))}
          </select>
          <span className="muted">
            {d.state_label}{d.asset_count > 0 ? ` · ${d.asset_count} asset${d.asset_count === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      ))}
      {gap.deliverables.some((d) => d.requirement === 'required' && d.blockers.length > 0) && (
        <ul className="muted" style={{ marginTop: 6 }}>
          {gap.deliverables.filter((d) => d.requirement === 'required').flatMap((d) =>
            d.blockers.map((b, i) => <li key={d.code + i}><strong>{d.label}:</strong> {b}</li>))}
        </ul>
      )}
      {gap.plan_saved && gap.all_required_ready && (
        <p className="muted">All required deliverables are ready — review and export from the Library when you decide they’re final.</p>
      )}
      {error && <p className="login-err">{error}</p>}
      <div className="confirm-row">
        <button className="btn-secondary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button>
        {!defaultOpen && <button className="account-link" onClick={() => setOpen(false)}>Close</button>}
      </div>
    </div>
  );
}

// v8 LB-S03: brief-change impact review. Each affected asset resolved independently.
// (v9 SC-04: the standalone Consistency panel was folded into ReviewWorkbench —
// BriefImpact stays because the Brief section shows change impact inline.)
export function BriefImpact({ campaign, defaultOpen }) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    setError(null);
    try { setImpact((await api.campaignBriefImpact(campaign.id)).impact); }
    catch (err) { setError(err.message); }
  }
  useAutoOpen(defaultOpen, load);

  async function keep(a) {
    try { await api.keepAssetSnapshot(campaign.id, a.table, a.id); load(); }
    catch (err) { setError(err.message); }
  }

  if (!open) return <button className="btn-secondary" onClick={load}>Review brief changes · free</button>;
  if (!impact && !error) return <p className="muted">Comparing brief to asset snapshots…</p>;

  return (
    <div className="campaign-brief-impact">
      <h3 style={{ marginBottom: 4 }}>Brief changes</h3>
      {error && <p className="login-err">{error}</p>}
      {impact && impact.affected.length === 0 && (
        <p className="muted">Every asset matches the current brief. Assets without a snapshot cannot be compared.</p>
      )}
      {impact && impact.affected.map((a) => (
        <div key={a.table + a.id} className="account-section" style={{ padding: 10, marginBottom: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>{a.title}</strong>
            <span className="muted"> · {a.review_state === 'snapshot_kept' ? 'snapshot kept (your decision is on record)' : 'review brief changes'}</span>
          </p>
          <ul className="muted" style={{ margin: '4px 0' }}>
            {a.changed.map((ch) => (
              <li key={ch.field}><strong>{ch.label}:</strong> “{ch.old_value}” → “{ch.new_value}”</li>
            ))}
          </ul>
          {a.review_state !== 'snapshot_kept' && (
            <div className="confirm-row">
              <button className="btn-secondary" onClick={() => keep(a)} title="Keeps the asset as generated. Recorded with your email and time; a further brief change reopens this review.">
                Keep snapshot
              </button>
              <a className="btn-secondary" href="/app/assets">Edit manually</a>
              <a className="btn-secondary" href={`${STUDIO_BY_TABLE[a.table]}?campaign=${campaign.id}`} title="Regenerating creates a new version and uses 1 AI action only on success.">
                Open studio to regenerate
              </a>
            </div>
          )}
        </div>
      ))}
      <div className="confirm-row">
        <button className="btn-secondary" onClick={load}>Refresh</button>
        {!defaultOpen && <button className="account-link" onClick={() => setOpen(false)}>Close</button>}
      </div>
    </div>
  );
}

// v8 LB-S05: deterministic package preview — what the paid workflow assembles.
export function PackagePreview({ campaign, defaultOpen }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    try { setPreview((await api.campaignPackagePreview(campaign.id)).preview); }
    catch (err) { setError(err.message); }
  }
  useAutoOpen(defaultOpen, load);

  if (!open) return <button className="btn-secondary" onClick={load}>Preview campaign package</button>;
  if (!preview) return <p className="muted">{error || 'Assembling preview from your brief…'}</p>;

  const facts = Object.entries(preview.brief_facts).filter(([, v]) => v);
  return (
    <div className="campaign-package-preview">
      <h3 style={{ marginBottom: 4 }}>Campaign package preview</h3>
      <p className="muted" style={{ marginTop: 0 }}>{preview.honesty}</p>
      <p className="muted"><strong>From your brief:</strong> {facts.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</p>
      <ul className="muted">
        {preview.deliverables.map((d) => (
          <li key={d.code}>
            <strong>{d.label}</strong>
            {d.requirement !== 'unplanned' ? ` (${d.requirement.replace('_', ' ')})` : ''} — {d.output_structure}
          </li>
        ))}
      </ul>
      <p className="muted">
        Review checks that run on every campaign: {preview.review_checks.map((r) => r.code.replace(/_/g, ' ')).join(', ')}.
      </p>
      {!defaultOpen && <button className="account-link" onClick={() => setOpen(false)}>Close</button>}
    </div>
  );
}

// v9 SC-07 (ADR-001 preserved): the Handoff screen. Server-owned preview of the
// exact packet — readiness, included/excluded assets, unresolved items and
// evidence — before any download, with a deterministic fingerprint so a stale
// packet is visible after a material change. Export-only: no share links, no
// email, no client accounts. This is a Review record, never an approval.
export function HandoffExports({ campaign }) {
  const [h, setH] = useState(null);
  const [error, setError] = useState(null);
  const [confirmReminders, setConfirmReminders] = useState(false);
  const slug = (campaign.name || 'campaign').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'campaign';

  function load() {
    api.campaignHandoff(campaign.id).then((r) => setH(r.handoff)).catch((e) => setError(e.message));
  }
  useEffect(load, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function record(format) {
    try { await api.recordHandoff(campaign.id, h.fingerprint, format); load(); } catch { /* never blocks the download */ }
  }

  async function exportMd() {
    setError(null);
    try {
      const { packet_markdown } = await api.campaignReviewPacket(campaign.id);
      download(`${slug}-handoff-packet.md`, packet_markdown, 'text/markdown');
      record('md');
    } catch (err) { setError(err.message); }
  }

  async function exportJson() {
    setError(null);
    try {
      const { manifest } = await api.campaignHandoffManifest(campaign.id);
      download(`${slug}-handoff-manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
      record('json');
    } catch (err) { setError(err.message); }
  }

  if (error) return <p className="login-err">{error}</p>;
  if (!h) return <p className="muted">Assembling the handoff packet…</p>;

  const hasReminders = h.reminder_count > 0;
  const canExport = h.blocking_count === 0 && (!hasReminders || confirmReminders);

  return (
    <div className="campaign-handoff">
      <div className="brand-head" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Handoff packet</h3>
        {h.stale && <span className="campaign-badge">Packet is older than the current campaign</span>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{h.disclosure}</p>

      {/* Readiness + what the packet will and won't contain, before download. */}
      <div className="campaign-summary-grid">
        <div className="account-section campaign-readiness">
          <span className="muted">Readiness</span>
          <strong>{h.all_required_ready ? 'All required deliverables ready' : `${h.required_total} required planned`}</strong>
        </div>
        <div className="account-section campaign-readiness">
          <span className="muted">Included assets</span>
          <strong>{h.included_assets.length}</strong>
        </div>
        <div className={`account-section campaign-readiness ${h.blocking_count ? 'is-blocked' : ''}`}>
          <span className="muted">Hard blockers</span>
          <strong>{h.blocking_count}</strong>
        </div>
        <div className="account-section campaign-readiness">
          <span className="muted">Disclosed reminders</span>
          <strong>{h.reminder_count}</strong>
        </div>
      </div>

      {h.blocking_count > 0 && (
        <div className="account-section" role="alert">
          <strong>{h.blocking_count} hard blocker{h.blocking_count === 1 ? '' : 's'} must be resolved before export.</strong>
          <ul className="muted">
            {h.unresolved.blocking.map((b, i) => <li key={i}>{b.code.replace(/_/g, ' ')}: {b.assets.join(', ')}</li>)}
          </ul>
          <p className="muted">Resolve these in Review, then return here.</p>
        </div>
      )}

      {h.excluded_assets.length > 0 && (
        <p className="muted">Excluded (archived, disclosed): {h.excluded_assets.map((a) => a.title).join(', ')}.</p>
      )}

      {/* "What remains outside Scalvya" — prominent, never fine print. */}
      <div className="account-section">
        <strong>What remains outside Scalvya</strong>
        <ul className="muted" style={{ marginBottom: 0 }}>
          {h.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      {hasReminders && h.blocking_count === 0 && (
        <label className="consent" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={confirmReminders} onChange={(e) => setConfirmReminders(e.target.checked)} />
          <span>I understand this packet discloses {h.reminder_count} unresolved reminder{h.reminder_count === 1 ? '' : 's'} and export anyway.</span>
        </label>
      )}

      <div className="confirm-row" style={{ marginTop: 8 }}>
        <button className="btn-secondary" onClick={exportMd} disabled={!canExport}
          title="Human-readable Markdown packet: summary, assets, statuses, unresolved items, evidence and an owner checklist.">
          Export packet (Markdown)
        </button>
        <button className="btn-secondary" onClick={exportJson} disabled={!canExport}
          title="Deterministic JSON manifest of the same canonical packet.">
          Export manifest (JSON)
        </button>
        <a className={`btn-secondary${canExport ? '' : ' is-disabled'}`}
          href={canExport ? `/api/campaigns/${campaign.id}/review-packet?format=html` : undefined}
          onClick={() => canExport && record('html')}
          target="_blank" rel="noreferrer" aria-disabled={!canExport}
          title="Print-friendly HTML — use your browser's Print to save as PDF. This is a Word-compatible HTML view, not a .docx file.">
          Print view (HTML)
        </a>
      </div>
      {h.last_handoff_at && (
        <p className="muted" style={{ marginTop: 6 }}>
          Last exported {new Date(h.last_handoff_at).toLocaleString()}{h.last_handoff_format ? ` · ${h.last_handoff_format.toUpperCase()}` : ''}.
          {h.stale ? ' The campaign changed since — re-export for the current version.' : ' This matches the current campaign.'}
        </p>
      )}
    </div>
  );
}

// v8 LB-S06: save the current brief + deliverable plan as a reusable template.
const TEMPLATE_FIELDS = [
  ['objective', 'Objective'], ['audience', 'Audience'], ['offer_summary', 'Offer'],
  ['promo_terms', 'Promo terms'], ['key_message', 'Key message'], ['proof', 'Proof'],
  ['restrictions', 'Restrictions'], ['markets', 'Markets'], ['language', 'Language'], ['channels', 'Channels'],
];

export function SaveTemplate({ campaign, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [include, setInclude] = useState(['objective', 'audience', 'key_message', 'channels']);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.saveTemplate(campaign.id, name, include);
      setOpen(false);
      if (onSaved) onSaved();
    } catch (err) { setError(err.message); }
  }

  if (!open) return <button className="btn-secondary" onClick={() => { setOpen(true); setName(`${campaign.name} template`); }}>Save as template</button>;
  return (
    <form onSubmit={save} className="account-section" style={{ padding: 10 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose exactly which brief facts to reuse. Dates, approval, statuses and evidence are never copied.
      </p>
      <div className="brand-field">
        <label>Template name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="campaign-channels">
        {TEMPLATE_FIELDS.map(([f, label]) => (
          <label key={f} className="consent" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={include.includes(f)}
              onChange={(e) => setInclude(e.target.checked ? [...include, f] : include.filter((x) => x !== f))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {error && <p className="login-err">{error}</p>}
      <div className="confirm-row">
        <button className="btn-secondary" type="submit" disabled={!name.trim()}>Save template</button>
        <button className="account-link" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
