import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { download } from '../lib/export';

// Prompt 12: Campaign Studio — the organizing layer. Define one brief, generate
// a strategy (1 AI action), approve it, then generate linked assets in the
// studios (they pick up campaign_id so everything stays consistent).
const CHANNELS = ['email', 'social', 'ads', 'landing'];

const EMPTY = {
  name: '', objective: '', audience: '', offer_summary: '', promo_terms: '',
  key_message: '', proof: '', restrictions: '', markets: '', language: '',
  start_date: '', end_date: '', deadline: '', channels: ['email', 'social'],
};

// v5 Prompt 6: campaign templates prefill the brief. "Full launch campaign"
// is the guided flow (positioning → offers → campaign package).
const TEMPLATES = [
  { key: 'launch', label: 'Product launch', brief: { objective: 'Launch a new product and drive first sales', channels: ['email', 'social', 'ads', 'landing'] } },
  { key: 'promo', label: 'Promotion', brief: { objective: 'Run a limited-time promotion', channels: ['email', 'social', 'ads'] } },
  { key: 'evergreen', label: 'Evergreen sales', brief: { objective: 'Steady sales content for the core offer', channels: ['email', 'social'] } },
  { key: 'leadgen', label: 'Lead generation', brief: { objective: 'Grow the email list with a lead magnet', channels: ['landing', 'social', 'ads'] } },
  { key: 'content', label: 'Content month', brief: { objective: 'A month of consistent audience-building content', channels: ['social', 'email'] } },
];

// Playbook v6 Prompt 18: the brief is a contract — these decisions must be
// present before assets can inherit a coherent campaign. Missing ones surface
// as human-readable "required decisions left".
const REQUIRED_DECISIONS = [
  ['objective', 'a goal'],
  ['audience', 'an audience'],
  ['offer_summary', 'an offer'],
  ['key_message', 'a key message'],
];
function missingDecisions(c) {
  return REQUIRED_DECISIONS.filter(([k]) => {
    const v = c[k];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
}
function hasNoDates(c) {
  return !c.start_date && !c.end_date && !c.deadline;
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

// v8 LB-S01: which deliverables a channel suggests — used only to prefill the
// plan as "Suggested"; the user decides, nothing is required by default.
const CHANNEL_SUGGESTS = {
  email: ['email_flow'],
  social: ['social_set'],
  ads: ['creative_brief'],
  landing: ['landing_page'],
};
const REQUIREMENT_OPTIONS = [
  ['required', 'Required'],
  ['optional', 'Optional'],
  ['not_needed', 'Not needed'],
];

// v8 LB-S01: per-campaign deliverable plan + gap map. Deterministic and free —
// states come from real asset data; no score, no invented deadlines.
function Deliverables({ campaign }) {
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
        <button className="account-link" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}

// v8 LB-S02: deterministic cross-channel consistency check. Free — no AI
// action. A clean result is "no issues detected by these checks", never
// "campaign approved".
const ACK_NOTE_OPTIONS = [
  ['intentional', 'Intentional — keep as is'],
  ['reviewed_ok', 'Reviewed — looks correct'],
  ['external_check_pending', 'Waiting on an external check'],
  ['other', 'Other reason'],
];

function Consistency({ campaign }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    setError(null);
    try { setResult(await api.campaignConsistency(campaign.id)); }
    catch (err) { setError(err.message); }
  }

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
        <button className="account-link" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}

// v8 LB-S03: brief-change impact review. Each affected asset is resolved
// independently — Keep snapshot (explicit, on record), edit manually, or
// regenerate in its studio (1 AI action, only on success). Never bulk.
const STUDIO_BY_TABLE = {
  website_pages: '/app/studio/website',
  email_assets: '/app/studio/email-flow',
  social_assets: '/app/studio/social',
  creative_assets: '/app/studio/creative',
  seo_assets: '/app/studio/seo',
};

function BriefImpact({ campaign }) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    setError(null);
    try { setImpact((await api.campaignBriefImpact(campaign.id)).impact); }
    catch (err) { setError(err.message); }
  }

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
        <button className="account-link" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}

// v8 LB-S04: one review queue per campaign + evidence locker + manifest
// export. The manifest is a handoff record — never an approval or compliance
// certificate, and unresolved items are disclosed, never erased.
const EVIDENCE_TYPES = ['review', 'testimonial', 'statistic', 'certification', 'press', 'internal_data', 'other'];
const EMPTY_EVIDENCE = { type: 'review', label: '', source_url: '', checked_date: '', permitted_claim: '' };

function ReviewQueue({ campaign }) {
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

  async function addEvidence(e) {
    e.preventDefault();
    setError(null);
    try {
      const { evidence } = await api.addEvidence(ev);
      setEv(null);
      // Link straight to an asset if one was chosen in the form.
      if (ev._link) {
        const [table, id] = ev._link.split(':');
        await api.linkEvidence(evidence.id, table, id);
      }
      load();
    } catch (err) { setError(err.message); }
  }

  async function exportManifest() {
    setError(null);
    try {
      const { manifest_markdown } = await api.campaignReviewManifest(campaign.id);
      download(`${campaign.name.replace(/[^a-z0-9]+/gi, '-')}-review-manifest.md`, manifest_markdown, 'text/markdown');
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
            <button className="btn-secondary" onClick={exportManifest}
              title="A handoff record listing assets, statuses, unresolved items and evidence — not an approval or compliance certificate.">
              Export review manifest{q.blocking.length ? ` (${q.blocking.length} unresolved disclosed)` : ''}
            </button>
            <button className="btn-secondary" onClick={load}>Refresh</button>
            <button className="account-link" onClick={() => setOpen(false)}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}

// v8 LB-S05: deterministic package preview — what the paid workflow will
// assemble from this brief. No AI call, no fabricated draft.
function PackagePreview({ campaign }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setOpen(true);
    try { setPreview((await api.campaignPackagePreview(campaign.id)).preview); }
    catch (err) { setError(err.message); }
  }

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
      <button className="account-link" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}

// v8 LB-S05: the create-campaign form survives auth/paywall/checkout detours.
const DRAFT_KEY = 'campaign_form_draft';
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; }
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState(null);
  // v8 LB-S05: restore an interrupted draft (auth/paywall/checkout detours).
  const [form, setFormState] = useState(loadDraft); // null = closed, object = create form
  const setForm = (next) => {
    setFormState(next);
    try {
      if (next) localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* storage unavailable — draft just won't survive a reload */ }
  };
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.campaigns().then(({ campaigns: list }) => setCampaigns(list)).catch(() => setCampaigns([]));
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createCampaign(form);
      setForm(null);
      load();
    } catch (err) { setError(err.message); }
  }

  async function strategy(c) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.generateCampaignStrategy(c.id);
      load();
    } catch (err) { setError(err.message); }
    setBusyId(null);
  }

  async function approve(c) {
    // v7 LB-04: reopening is explicit about what changes downstream. Approval
    // is a human decision — it does not mean legally approved or fact-checked.
    if (c.brief_approved && !window.confirm(
      'Reopen this brief? New generations will pause until you approve it again. ' +
      'Assets you already generated keep the snapshot they were created from.'
    )) return;
    try { await api.updateCampaign(c.id, { brief_approved: !c.brief_approved }); load(); }
    catch (err) { setError(err.message); }
  }

  async function remove(c) {
    if (!window.confirm(`Delete campaign "${c.name}"? Generated assets are kept.`)) return;
    try {
      await api.deleteCampaign(c.id);
      load();
    } catch (err) {
      // v5 P6: the backend refuses when linked assets exist unless confirmed.
      if (err.code === 'CONFIRM_DELETE') {
        if (window.confirm(`${err.message}\n\nDelete anyway?`)) {
          try { await api.deleteCampaign(c.id, true); load(); } catch (e2) { setError(e2.message); }
        }
      } else setError(err.message);
    }
  }

  async function archive(c) {
    try { await api.updateCampaign(c.id, { archived: !c.archived }); load(); }
    catch (err) { setError(err.message); }
  }

  async function duplicate(c) {
    try { await api.duplicateCampaign(c.id); load(); } catch (err) { setError(err.message); }
  }

  const totalAssets = (c) => Object.values(c.asset_counts || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="campaigns-page">
      <div className="brand-head">
        <h1>Campaigns</h1>
        <button className="btn-primary" onClick={() => setForm(form ? null : { ...EMPTY })}>
          {form ? 'Cancel' : 'Create campaign'}
        </button>
      </div>
      <p className="muted">
        Keep the offer, audience, goal, dates, channels and CTA consistent across every asset.
      </p>

      {/* v5 Prompt 3: the full launch workflow is a campaign template, not a
          competing top-level product. */}
      <div className="account-section campaign-template">
        <h2>Full launch campaign</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Website, email, social, ads and SEO ideas from one brief — the guided template that starts
          with positioning and three offer options. Each generation step (positioning, offers,
          campaign package) uses 1 AI action, and the package counts as 1 full launch campaign.
        </p>
        <a className="btn-primary" href="/app/flow" style={{ display: 'inline-block', marginTop: 8 }}>
          Start full launch campaign
        </a>
      </div>

      {form && (
        <form className="account-section" onSubmit={create}>
          <h2>New campaign</h2>
          <div className="brand-field">
            <label>Template</label>
            <div className="campaign-channels">
              {TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  className="gen-chip"
                  onClick={() => setForm({ ...form, ...t.brief })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="brand-field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Summer Sale 2026" required />
          </div>
          <div className="brand-field">
            <label>Objective</label>
            <input value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="e.g. Sell out the summer collection" />
          </div>
          <div className="brand-field">
            <label>Audience</label>
            <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="Who this campaign targets" />
          </div>
          <div className="brand-field">
            <label>Offer</label>
            <textarea rows={2} value={form.offer_summary} onChange={(e) => setForm({ ...form, offer_summary: e.target.value })} placeholder="What's on offer (product, bundle, discount)…" />
          </div>
          <div className="brand-field">
            <label>Promo terms</label>
            <input value={form.promo_terms} onChange={(e) => setForm({ ...form, promo_terms: e.target.value })} placeholder='e.g. "20% off with code SUMMER20, ends July 31"' />
          </div>
          <div className="brand-field">
            <label>Key message</label>
            <input value={form.key_message} onChange={(e) => setForm({ ...form, key_message: e.target.value })} placeholder="The one thing every asset should say" />
          </div>
          <div className="brand-field">
            <label>Proof</label>
            <input value={form.proof} onChange={(e) => setForm({ ...form, proof: e.target.value })} placeholder="Real reviews, numbers or results to use" />
          </div>
          <div className="brand-field">
            <label>Restrictions</label>
            <input value={form.restrictions} onChange={(e) => setForm({ ...form, restrictions: e.target.value })} placeholder="Claims to avoid, compliance rules" />
          </div>
          <div className="brand-field campaign-dates">
            <label>Markets / language</label>
            <input value={form.markets} onChange={(e) => setForm({ ...form, markets: e.target.value })} placeholder="e.g. US" />
            <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="e.g. English" />
          </div>
          <div className="brand-field campaign-dates">
            <label>Dates</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <span> → </span>
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div className="brand-field campaign-dates">
            <label>Real deadline</label>
            <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <div className="brand-field">
            <label>Channels</label>
            <div className="campaign-channels">
              {CHANNELS.map((ch) => (
                <label key={ch} className="consent" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={form.channels.includes(ch)}
                    onChange={(e) => setForm({
                      ...form,
                      channels: e.target.checked ? [...form.channels, ch] : form.channels.filter((x) => x !== ch),
                    })}
                  />
                  <span>{ch}</span>
                </label>
              ))}
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={!form.name.trim()}>Create campaign</button>
        </form>
      )}

      {error && <p className="login-err">{error}</p>}

      {campaigns === null && <p className="muted">Loading…</p>}
      {campaigns && campaigns.length === 0 && !form && (
        <div className="account-section"><p className="muted">No campaigns yet. Create one before generating so every asset has a clear purpose.</p></div>
      )}

      {(campaigns || []).filter((c) => !c.archived).map((c) => {
        const missing = missingDecisions(c);
        return (
        <div className="account-section" key={c.id}>
          <div className="campaign-row-head">
            <h2>{c.name}</h2>
            <span className={`campaign-badge ${c.brief_approved ? 'is-ok' : ''}`}>
              {c.brief_approved
                ? `Brief v${c.brief_version || 1} approved`
                : missing.length
                  ? `Brief incomplete · ${missing.length} required decision${missing.length === 1 ? '' : 's'} left`
                  : 'Draft brief'}
            </span>
          </div>
          <p className="muted">
            {[c.objective, c.audience && `→ ${c.audience}`, c.start_date && `${c.start_date} → ${c.end_date || 'open'}`]
              .filter(Boolean).join(' · ') || 'No details yet.'}
          </p>
          {missing.length > 0 && (
            <p className="muted">Add {missing.map(([, label]) => label).join(', ')} to complete the brief.</p>
          )}
          {c.brief_approved && (
            <p className="muted">
              Brief approved{c.brief_approved_at ? ` on ${fmtDate(c.brief_approved_at)}` : ''}. Changes will
              apply to new generations; existing assets keep their original snapshot.
            </p>
          )}
          {hasNoDates(c) && (
            <p className="muted">No fixed dates — do not generate urgency or deadline language.</p>
          )}

          {c.strategy && (
            <div className="campaign-strategy">
              <p><strong>Core message:</strong> {c.strategy.core_message}</p>
              <p><strong>CTA:</strong> {c.strategy.cta}</p>
              {Array.isArray(c.strategy.calendar) && (
                <ul className="campaign-calendar">
                  {c.strategy.calendar.map((item, i) => (
                    <li key={i}><strong>{item.day}</strong> · {item.channel} — {item.action}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="muted">{totalAssets(c)} linked asset{totalAssets(c) === 1 ? '' : 's'}</p>

          <Deliverables campaign={c} />
          <Consistency campaign={c} />
          <BriefImpact campaign={c} />
          <ReviewQueue campaign={c} />
          <PackagePreview campaign={c} />

          <div className="confirm-row">
            <button className="btn-secondary" onClick={() => strategy(c)} disabled={busyId === c.id}>
              {busyId === c.id ? 'Generating…' : c.strategy ? 'Regenerate strategy · 1 AI action' : 'Generate strategy (optional) · 1 AI action'}
            </button>
            {/* v7 LB-04: a complete manual brief can be approved without paying
                for AI strategy — strategy is optional, approval is the gate. */}
            <button
              className="btn-secondary"
              onClick={() => approve(c)}
              disabled={!c.brief_approved && missing.length > 0}
              title={!c.brief_approved && missing.length > 0
                ? `Add ${missing.map(([, label]) => label).join(', ')} first`
                : undefined}
            >
              {c.brief_approved ? 'Reopen brief' : 'Approve brief and start creating'}
            </button>
            <a className="btn-secondary" href={`/app/create?campaign=${c.id}`}>Create assets</a>
            <button className="btn-secondary" onClick={() => duplicate(c)} title="Copies the brief as a new draft campaign — linked assets are not copied">Duplicate</button>
            <button className="btn-secondary" onClick={() => archive(c)}>{c.archived ? 'Unarchive' : 'Archive'}</button>
            <button className="btn-secondary" onClick={() => remove(c)}>Delete</button>
          </div>
        </div>
        );
      })}

      {(campaigns || []).some((c) => c.archived) && (
        <div className="account-section">
          <h2>Archived</h2>
          {(campaigns || []).filter((c) => c.archived).map((c) => (
            <p className="muted" key={c.id}>
              {c.name} · {totalAssets(c)} asset{totalAssets(c) === 1 ? '' : 's'} preserved{' '}
              <button className="account-link" onClick={() => archive(c)}>Unarchive</button>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
