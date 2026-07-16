import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Prompt 12: Campaign Studio — the organizing layer. Define one brief, generate
// a strategy (1 AI action), approve it, then generate linked assets in the
// studios (they pick up campaign_id so everything stays consistent).
const CHANNELS = ['email', 'social', 'ads', 'landing'];

const EMPTY = { name: '', objective: '', audience: '', offer_summary: '', promo_terms: '', start_date: '', end_date: '', channels: ['email', 'social'] };

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
    try { await api.deleteCampaign(c.id); load(); } catch (err) { setError(err.message); }
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
          The guided template: positioning → 3 offers → a complete launch kit (landing copy, content
          plan, emails, ads, SEO and a weekly plan).
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
          <div className="brand-field campaign-dates">
            <label>Dates</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <span> → </span>
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
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

      {(campaigns || []).map((c) => (
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
            <button className="btn-secondary" onClick={() => remove(c)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
