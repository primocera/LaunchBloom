import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { EMPTY_BRIEF as EMPTY, TEMPLATES, missingDecisions, totalAssets, sectionPath } from './campaign/shared';

// ---------------------------------------------------------------------------
// v9 SC-01: Campaigns is now the campaign list + create surface only. Each
// campaign opens into its own workspace (/app/campaigns/:id) with focused
// Overview / Brief / Deliverables / Assets / Review / Handoff sections — the
// v8 control tools that used to be stacked on every card live there now.
// ---------------------------------------------------------------------------

// v8 LB-S06: first-party playbooks — versioned workflow structure, previewed
// before applying. Applying always creates a NEW draft campaign.
function Playbooks({ onCreated }) {
  const [playbooks, setPlaybooks] = useState(null);
  const [sel, setSel] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.playbooks().then((r) => setPlaybooks(r.playbooks)).catch(() => setPlaybooks([]));
  }, []);

  function preview(p) {
    setSel(p);
    setName('');
    api.trackEvent('playbook_previewed', { playbook_id: p.id });
  }

  async function apply(e) {
    e.preventDefault();
    setError(null);
    try {
      const { campaign } = await api.applyPlaybook(sel.id, name);
      setSel(null);
      onCreated(campaign);
    } catch (err) { setError(err.message); }
  }

  if (!playbooks || playbooks.length === 0) return null;
  return (
    <div className="account-section">
      <h2>Playbooks</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Proven campaign structure — objective, deliverable plan and the brief questions to answer.
        No benchmarks or invented outcomes; your facts stay yours to verify.
      </p>
      <div className="campaign-channels">
        {playbooks.map((p) => (
          <button type="button" key={p.id} className="gen-chip" onClick={() => preview(p)}>{p.label}</button>
        ))}
      </div>
      {sel && (
        <form onSubmit={apply} style={{ marginTop: 8 }}>
          <p className="muted"><strong>{sel.label}</strong> (v{sel.version}) — {sel.description}</p>
          <p className="muted">Will set: objective “{sel.suggested_objective}”, channels {sel.channels.join(', ')}, and this deliverable plan:</p>
          <ul className="muted">
            {Object.entries(sel.deliverables).map(([code, st]) => (
              <li key={code}>{code.replace(/_/g, ' ')}: {st.replace('_', ' ')}</li>
            ))}
          </ul>
          <p className="muted">Brief questions you’ll answer (nothing is prefilled):</p>
          <ul className="muted">{sel.brief_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          <div className="brand-field">
            <label>Campaign name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the new draft campaign" required />
          </div>
          {error && <p className="login-err">{error}</p>}
          <div className="confirm-row">
            <button className="btn-primary" type="submit" disabled={!name.trim()}>Create draft campaign from playbook</button>
            <button className="account-link" type="button" onClick={() => setSel(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// v8 LB-S06: apply/delete saved workspace templates.
function Templates({ onCreated }) {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(null);

  function load() { api.templates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([])); }
  useEffect(load, []);

  async function apply(t) {
    const name = window.prompt(`New campaign name (from template “${t.name}”):`, t.name.replace(/ template$/i, ''));
    if (!name) return;
    try { const { campaign } = await api.applyTemplate(t.id, name); onCreated(campaign); }
    catch (err) { setError(err.message); }
  }

  async function remove(t) {
    if (!window.confirm(`Delete template “${t.name}”?`)) return;
    try { await api.deleteTemplate(t.id); load(); } catch (err) { setError(err.message); }
  }

  if (!templates || templates.length === 0) return null;
  return (
    <div className="account-section">
      <h2>Your templates</h2>
      {error && <p className="login-err">{error}</p>}
      {templates.map((t) => (
        <p className="muted" key={t.id} style={{ margin: '4px 0' }}>
          {t.name} · reuses {Object.keys(t.data?.brief || {}).length} brief field(s) + deliverable plan{' '}
          <button className="account-link" onClick={() => apply(t)}>Create campaign</button>{' '}
          <button className="account-link" onClick={() => remove(t)}>Delete</button>
        </p>
      ))}
    </div>
  );
}

// v8 LB-S05: the create-campaign form survives auth/paywall/checkout detours.
const DRAFT_KEY = 'campaign_form_draft';
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; }
}

// A quiet overflow menu keeps archive/delete/duplicate off the main work path.
function CampaignMenu({ campaign, onArchive, onDuplicate, onRemove }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="campaign-menu">
      <button className="btn-secondary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="campaign-menu-pop" role="menu">
          <button role="menuitem" className="account-link" onClick={() => { setOpen(false); onDuplicate(campaign); }}>Duplicate</button>
          <button role="menuitem" className="account-link" onClick={() => { setOpen(false); onArchive(campaign); }}>{campaign.archived ? 'Unarchive' : 'Archive'}</button>
          <button role="menuitem" className="account-link" onClick={() => { setOpen(false); onRemove(campaign); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState(null);
  const [form, setFormState] = useState(loadDraft); // null = closed, object = create form
  const setForm = (next) => {
    setFormState(next);
    try {
      if (next) localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* storage unavailable — draft just won't survive a reload */ }
  };
  const [error, setError] = useState(null);

  function load() {
    api.campaigns().then(({ campaigns: list }) => setCampaigns(list)).catch(() => setCampaigns([]));
  }
  useEffect(load, []);

  // v9 SC-03: creating a campaign is one decision (name, optional template).
  // The full brief is then filled in the workspace Brief editor, so a new
  // campaign always opens straight into the guided brief with nothing lost.
  function openWorkspace(campaign) {
    setForm(null);
    navigate(sectionPath(campaign.id, 'brief'));
  }

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const { campaign } = await api.createCampaign(form);
      openWorkspace(campaign);
    } catch (err) { setError(err.message); }
  }

  async function remove(c) {
    if (!window.confirm(`Delete campaign "${c.name}"? Generated assets are kept.`)) return;
    try {
      await api.deleteCampaign(c.id);
      load();
    } catch (err) {
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

  return (
    <div className="campaigns-page">
      <div className="brand-head">
        <h1>Campaigns</h1>
        <button className="btn-primary" onClick={() => setForm(form ? null : { ...EMPTY })}>
          {form ? 'Cancel' : 'Create campaign'}
        </button>
      </div>
      <p className="muted">
        Keep the offer, audience, goal, dates, channels and CTA consistent across every asset. Open a campaign to plan, create, review and hand it off.
      </p>

      <Playbooks onCreated={openWorkspace} />
      <Templates onCreated={openWorkspace} />

      {/* v5 Prompt 3: the full launch workflow is a campaign template. */}
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
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Summer Sale 2026" required autoFocus />
          </div>
          <div className="brand-field">
            <label>Start from a template (optional)</label>
            <div className="campaign-channels">
              {TEMPLATES.map((t) => (
                <button type="button" key={t.key} className="gen-chip" onClick={() => setForm({ ...form, ...t.brief })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">
            Name it now — you’ll fill in the objective, offer, audience, key message, dates and channels in the
            campaign’s guided Brief, which opens next. Nothing is generated and no AI action is used.
          </p>
          <button className="btn-primary" type="submit" disabled={!form.name.trim()}>Create and open brief</button>
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
          <div className="account-section campaign-list-row" key={c.id}>
            <div className="campaign-row-head">
              <h2>
                <Link to={sectionPath(c.id, 'overview')} className="account-link">{c.name}</Link>
              </h2>
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
            <p className="muted">{totalAssets(c)} linked asset{totalAssets(c) === 1 ? '' : 's'}</p>
            <div className="confirm-row">
              <Link className="btn-primary" to={sectionPath(c.id, 'overview')}>Open campaign</Link>
              <CampaignMenu campaign={c} onArchive={archive} onDuplicate={duplicate} onRemove={remove} />
            </div>
          </div>
        );
      })}

      {(campaigns || []).some((c) => c.archived) && (
        <div className="account-section">
          <h2>Archived</h2>
          {(campaigns || []).filter((c) => c.archived).map((c) => (
            <p className="muted" key={c.id}>
              <Link className="account-link" to={sectionPath(c.id, 'overview')}>{c.name}</Link> · {totalAssets(c)} asset{totalAssets(c) === 1 ? '' : 's'} preserved{' '}
              <button className="account-link" onClick={() => archive(c)}>Unarchive</button>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
