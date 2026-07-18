import { useEffect, useState } from 'react';
import { api } from '../lib/api';

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
// is the guided flow (positioning → offers → launch kit).
const TEMPLATES = [
  { key: 'launch', label: 'Product launch', brief: { objective: 'Launch a new product and drive first sales', channels: ['email', 'social', 'ads', 'landing'] } },
  { key: 'promo', label: 'Promotion', brief: { objective: 'Run a limited-time promotion', channels: ['email', 'social', 'ads'] } },
  { key: 'evergreen', label: 'Evergreen sales', brief: { objective: 'Steady sales content for the core offer', channels: ['email', 'social'] } },
  { key: 'leadgen', label: 'Lead generation', brief: { objective: 'Grow the email list with a lead magnet', channels: ['landing', 'social', 'ads'] } },
  { key: 'content', label: 'Content month', brief: { objective: 'A month of consistent audience-building content', channels: ['social', 'email'] } },
];

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState(null);
  const [form, setForm] = useState(null); // null = closed, object = create form
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
          {form ? 'Cancel' : '+ New campaign'}
        </button>
      </div>
      <p className="muted">
        One brief per campaign. Generate the strategy first, approve it, then create emails, captions,
        ads and landing copy from it in the studios — they'll stay consistent on offer, dates and CTA.
      </p>

      {/* v5 Prompt 3: the full launch workflow is a campaign template, not a
          competing top-level product. */}
      <div className="account-section campaign-template">
        <h2>Full launch campaign</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          The guided template: positioning → 3 offer options → a full campaign asset set (website
          copy, a 30-day content plan, emails, ad ideas, SEO ideas and a weekly action plan).
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
        <div className="account-section"><p className="muted">No campaigns yet. Create your first one.</p></div>
      )}

      {(campaigns || []).filter((c) => !c.archived).map((c) => (
        <div className="account-section" key={c.id}>
          <div className="campaign-row-head">
            <h2>{c.name}</h2>
            <span className={`campaign-badge ${c.brief_approved ? 'is-ok' : ''}`}>
              {c.brief_approved ? 'Brief approved' : 'Draft brief'}
            </span>
          </div>
          <p className="muted">
            {[c.objective, c.audience && `→ ${c.audience}`, c.start_date && `${c.start_date} → ${c.end_date || 'open'}`]
              .filter(Boolean).join(' · ') || 'No details yet.'}
          </p>

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

          <div className="confirm-row">
            <button className="btn-secondary" onClick={() => strategy(c)} disabled={busyId === c.id}>
              {busyId === c.id ? 'Generating…' : c.strategy ? 'Regenerate strategy (1 action)' : 'Generate strategy (1 action)'}
            </button>
            {c.strategy && (
              <button className="btn-secondary" onClick={() => approve(c)}>
                {c.brief_approved ? 'Unapprove' : 'Approve brief'}
              </button>
            )}
            <a className="btn-secondary" href={`/app/create?campaign=${c.id}`}>Create assets</a>
            <button className="btn-secondary" onClick={() => duplicate(c)}>Duplicate</button>
            <button className="btn-secondary" onClick={() => archive(c)}>{c.archived ? 'Unarchive' : 'Archive'}</button>
            <button className="btn-secondary" onClick={() => remove(c)}>Delete</button>
          </div>
        </div>
      ))}

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
