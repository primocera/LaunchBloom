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

// v8 LB-S02: deterministic cross-channel consistency check. Free — no AI action.
const ACK_NOTE_OPTIONS = [
  ['intentional', 'Intentional — keep as is'],
  ['reviewed_ok', 'Reviewed — looks correct'],
  ['external_check_pending', 'Waiting on an external check'],
  ['other', 'Other reason'],
];

export function Consistency({ campaign, defaultOpen }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    setError(null);
    try { setResult(await api.campaignConsistency(campaign.id)); }
    catch (err) { setError(err.message); }
  }
  useAutoOpen(defaultOpen, load);

  async function ack(f, note) {
    try {
      await api.ackConsistencyFinding(campaign.id, f.fingerprint, note);
      load();
    } catch (err) { setError(err.message); }
  }

  if (!open) return <button className="btn-secondary" onClick={load}>Check consistency · free</button>;
  if (!result && !error) return <p className="muted">Checking…</p>;

  return (
    <div className="campaign-consistency">
      <h3 style={{ marginBottom: 4 }}>Consistency check</h3>
      {error && <p className="login-err">{error}</p>}
      {result && result.findings.length === 0 && (
        <p className="muted">{result.clean_message}</p>
      )}
      {result && result.findings.map((f) => (
        <div key={f.fingerprint} className="account-section" style={{ padding: 10, marginBottom: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>{f.severity === 'high' ? 'High' : 'Medium'} · {f.code.replace(/_/g, ' ')}</strong>
            {f.status === 'acknowledged' && <span className="muted"> · acknowledged</span>}
          </p>
          <p className="muted" style={{ margin: '4px 0' }}>
            {f.why}{' '}
            {f.assets.map((a) => a.title).join(', ')}
            {f.expected ? ` — brief says: “${f.expected}”` : ''}
            {f.observed ? ` — found: “${f.observed}”` : ''}
          </p>
          <p className="muted" style={{ margin: '4px 0' }}>Detection: {f.detection}. {f.resolution}</p>
          {f.ackable && f.status !== 'acknowledged' && (
            <select defaultValue="" onChange={(e) => e.target.value && ack(f, e.target.value)} aria-label="Acknowledge finding">
              <option value="" disabled>Acknowledge (keeps the finding on record)…</option>
              {ACK_NOTE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </div>
      ))}
      <div className="confirm-row">
        <button className="btn-secondary" onClick={load}>Re-check</button>
        {!defaultOpen && <button className="account-link" onClick={() => setOpen(false)}>Close</button>}
      </div>
    </div>
  );
}

// v8 LB-S03: brief-change impact review. Each affected asset resolved independently.
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

// v8 LB-S04: one review queue per campaign + evidence locker.
const EVIDENCE_TYPES = ['review', 'testimonial', 'statistic', 'certification', 'press', 'internal_data', 'other'];
const EMPTY_EVIDENCE = { type: 'review', label: '', source_url: '', checked_date: '', permitted_claim: '' };

export function ReviewQueue({ campaign, defaultOpen }) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [ev, setEv] = useState(null); // null = form closed

  async function load() {
    setOpen(true);
    setError(null);
    try { setReview((await api.campaignReview(campaign.id)).review); }
    catch (err) { setError(err.message); }
  }
  useAutoOpen(defaultOpen, load);

  async function addEvidence(e) {
    e.preventDefault();
    setError(null);
    try {
      const { evidence } = await api.addEvidence(ev);
      setEv(null);
      if (ev._link) {
        const [table, id] = ev._link.split(':');
        await api.linkEvidence(evidence.id, table, id);
      }
      load();
    } catch (err) { setError(err.message); }
  }

  if (!open) return <button className="btn-secondary" onClick={load}>Review queue</button>;
  if (!review && !error) return <p className="muted">Building the review queue…</p>;

  const q = review;
  return (
    <div className="campaign-review">
      <h3 style={{ marginBottom: 4 }}>Review queue</h3>
      {error && <p className="login-err">{error}</p>}
      {q && (
        <>
          {q.blocking.length > 0 && (
            <p><strong>{q.blocking.length} blocking item{q.blocking.length === 1 ? '' : 's'}</strong> — high-severity conflicts to resolve before handoff.</p>
          )}
          {q.findings.length > 0 && (
            <p className="muted">Consistency: {q.findings.length} finding{q.findings.length === 1 ? '' : 's'} (open the consistency check to resolve).</p>
          )}
          {q.stale.length > 0 && (
            <p className="muted">Brief changes: {q.stale.length} asset{q.stale.length === 1 ? '' : 's'} to review (open “Review brief changes”).</p>
          )}
          {q.needs_review_assets.length > 0 && (
            <p className="muted">
              Needs review: {q.needs_review_assets.map((a) => a.title).join(', ')} —{' '}
              <a className="account-link" href="/app/assets">open Library</a>
            </p>
          )}
          {q.evidence_reminders.length > 0 && (
            <p className="muted">Evidence to re-check: {q.evidence_reminders.map((e) => e.label).join(', ')}</p>
          )}
          {q.findings.length === 0 && q.stale.length === 0 && q.needs_review_assets.length === 0 && (
            <p className="muted">No open review items detected by these checks. This is not an approval — the final call stays with you.</p>
          )}

          <h4 style={{ marginBottom: 2 }}>Evidence</h4>
          {q.evidence.length === 0 && <p className="muted">No evidence linked to this campaign yet. Record real proof once, reuse it across assets.</p>}
          {q.evidence.map((e) => (
            <p className="muted" key={e.id} style={{ margin: '2px 0' }}>
              {e.label} ({e.type}) · checked {e.checked_date}
              {e.source_url && <> · <a className="account-link" href={e.source_url} target="_blank" rel="noreferrer">source</a></>}
              {' '}· linked to {q.evidence_links.filter((l) => l.evidence_id === e.id).length} asset(s)
            </p>
          ))}
          {ev ? (
            <form onSubmit={addEvidence} className="account-section" style={{ padding: 10 }}>
              <div className="brand-field">
                <label>Type</label>
                <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })}>
                  {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="brand-field">
                <label>Label</label>
                <input value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} placeholder='e.g. "Trustpilot 4.8 rating"' required />
              </div>
              <div className="brand-field">
                <label>Source URL</label>
                <input value={ev.source_url} onChange={(e) => setEv({ ...ev, source_url: e.target.value })} placeholder="https://…" />
              </div>
              <div className="brand-field">
                <label>Date you checked it</label>
                <input type="date" value={ev.checked_date} onChange={(e) => setEv({ ...ev, checked_date: e.target.value })} required />
              </div>
              <div className="brand-field">
                <label>Permitted claim</label>
                <input value={ev.permitted_claim} onChange={(e) => setEv({ ...ev, permitted_claim: e.target.value })} placeholder="The exact claim this evidence supports" />
              </div>
              {q.assets.length > 0 && (
                <div className="brand-field">
                  <label>Link to asset (optional)</label>
                  <select value={ev._link || ''} onChange={(e) => setEv({ ...ev, _link: e.target.value })}>
                    <option value="">—</option>
                    {q.assets.map((a) => <option key={a.table + a.id} value={`${a.table}:${a.id}`}>{a.title}</option>)}
                  </select>
                </div>
              )}
              <div className="confirm-row">
                <button className="btn-secondary" type="submit">Save evidence</button>
                <button className="account-link" type="button" onClick={() => setEv(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <button className="btn-secondary" onClick={() => setEv({ ...EMPTY_EVIDENCE })}>Add evidence</button>
          )}

          <div className="confirm-row" style={{ marginTop: 8 }}>
            <button className="btn-secondary" onClick={load}>Refresh</button>
            {!defaultOpen && <button className="account-link" onClick={() => setOpen(false)}>Close</button>}
          </div>
        </>
      )}
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

// v8 LB-S07 (ADR-001): export-only handoff. Extracted from ReviewQueue in v9
// SC-01 so the Handoff section owns manifest/packet/export.
export function HandoffExports({ campaign }) {
  const [error, setError] = useState(null);
  const [blocking, setBlocking] = useState(null);
  const slug = (campaign.name || 'campaign').replace(/[^a-z0-9]+/gi, '-');

  useEffect(() => {
    api.campaignReview(campaign.id)
      .then((r) => setBlocking(r.review?.blocking?.length || 0))
      .catch(() => setBlocking(null));
  }, [campaign.id]);

  async function exportPacket() {
    setError(null);
    try {
      const { packet_markdown } = await api.campaignReviewPacket(campaign.id);
      download(`${slug}-review-packet.md`, packet_markdown, 'text/markdown');
    } catch (err) { setError(err.message); }
  }

  async function exportManifest() {
    setError(null);
    try {
      const { manifest_markdown } = await api.campaignReviewManifest(campaign.id);
      download(`${slug}-review-manifest.md`, manifest_markdown, 'text/markdown');
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="campaign-handoff-exports">
      <h3 style={{ marginBottom: 4 }}>Export handoff</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        A complete handoff record for a client or channel operator: summary, assets, statuses,
        unresolved items and evidence. This is a review record, not an approval or compliance certificate —
        publishing remains with you.
      </p>
      {error && <p className="login-err">{error}</p>}
      <div className="confirm-row">
        <button className="btn-secondary" onClick={exportPacket}
          title="Summary, assets, statuses, unresolved items, evidence and an owner checklist.">
          Export review packet
        </button>
        <a className="btn-secondary" href={`/api/campaigns/${campaign.id}/review-packet?format=html`} target="_blank" rel="noreferrer"
          title="Print-friendly version — use your browser's Print to save as PDF.">
          Print view
        </a>
        <button className="btn-secondary" onClick={exportManifest}
          title="A handoff record listing assets, statuses, unresolved items and evidence.">
          Export review manifest{blocking ? ` (${blocking} unresolved disclosed)` : ''}
        </button>
      </div>
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
