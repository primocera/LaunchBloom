import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { CopyBtn } from './common';
import { AssetField, FormField, StatusPill } from './generator';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Upgrade Prompt 17: Email Studio — three tabs (Lifecycle Flows, Campaign
// Emails, Saved Emails) over the shared email_assets table. Per-field copy
// (subject / preheader / body / CTA) plus a "Copy full email" button.
// ---------------------------------------------------------------------------

const LIFECYCLE_FIELDS = [
  {
    name: 'flow_types', label: 'Flow types', type: 'checkboxes', required: true,
    options: [
      { value: 'welcome', label: 'Welcome' },
      { value: 'abandon_cart', label: 'Abandon Cart' },
      { value: 'browse_abandon', label: 'Browse Abandon' },
      { value: 'post_purchase', label: 'Post Purchase' },
      { value: 'review_request', label: 'Review Request' },
      { value: 'winback', label: 'Winback' },
    ],
  },
  {
    name: 'business_type', label: 'Business type', type: 'select',
    options: [
      { value: 'service', label: 'Service' },
      { value: 'digital_product', label: 'Digital product' },
      { value: 'ecommerce', label: 'Ecommerce' },
      { value: 'creator', label: 'Creator' },
      { value: 'coaching', label: 'Coaching' },
    ],
  },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'campaign_goal', label: 'Campaign goal (optional)', type: 'text' },
  { name: 'extra_context', label: 'Product / offer details (optional)', type: 'textarea' },
];

const CAMPAIGN_FIELDS = [
  { name: 'campaign_theme', label: 'Campaign theme', type: 'text', required: true },
  { name: 'campaign_goal', label: 'Campaign goal', type: 'text', required: true },
  { name: 'start_date', label: 'Start date', type: 'text', placeholder: 'e.g. 2026-08-01' },
  { name: 'end_date', label: 'End date', type: 'text', placeholder: 'e.g. 2026-08-07' },
  { name: 'discount_or_offer', label: 'Discount / offer', type: 'text' },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Products / context', type: 'textarea' },
];

function emailFull(e) {
  return [
    `Subject: ${e.subject_line || ''}`,
    `Preheader: ${e.preheader || ''}`,
    e.headline ? `Headline: ${e.headline}` : null,
    '',
    e.body_copy || '',
    '',
    `CTA: ${e.cta || ''}`,
    e.design_notes ? `Design notes: ${e.design_notes}` : null,
  ].filter((x) => x !== null).join('\n');
}

function EmailCard({ item, onChange }) {
  return (
    <div className="flow-card gen-card">
      <div className="gen-card-head">
        <StatusPill table="email_assets" item={item} onChange={onChange} />
        <div className="studio-item-actions">
          <span className="kit-item-meta">
            {item.flow_type}{item.segment ? ` · ${item.segment}` : ''}{item.send_timing ? ` · ${item.send_timing}` : ''}
          </span>
          <CopyBtn text={() => emailFull(item)} label="Copy full email" />
        </div>
      </div>
      <AssetField label="Subject line" value={item.subject_line} copy />
      <AssetField label="Preheader" value={item.preheader} copy />
      <AssetField label="Headline" value={item.headline} copy />
      <AssetField label="Body" value={item.body_copy} copy />
      <AssetField label="CTA" value={item.cta} copy />
      <AssetField label="Design notes" value={item.design_notes} />
    </div>
  );
}

/** A generate form for one tab. Returns generated emails up to the parent. */
function EmailForm({ fields, initial, generate, onGenerated }) {
  const [values, setValues] = useState(initial || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const [warnings, setWarnings] = useState([]);

  const missing = fields.some(
    (f) => f.required && (values[f.name] == null || values[f.name] === '' || (Array.isArray(values[f.name]) && !values[f.name].length))
  );

  async function run() {
    setBusy(true); setError(null); setUpgrade(false); setWarnings([]);
    try {
      const res = await generate(values);
      setWarnings(res.quality_warnings || []);
      onGenerated(res.emails || []);
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') setUpgrade(true);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow-card gen-form">
      {fields.map((f) => (
        <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))} />
      ))}
      <div className="flow-row">
        <button className="flow-btn" disabled={busy || missing} onClick={run}>
          {busy ? 'Generating…' : 'Generate emails'}
        </button>
      </div>
      {error && <p className="flow-err">{error}</p>}
      {upgrade && (
        <p className="flow-err">
          You've hit your plan limit for generations. <Link to="/#pricing">Upgrade your plan</Link> to keep going.
        </p>
      )}
      {warnings.length > 0 && (
        <div className="gen-warnings">
          <strong>Quality checks ({warnings.length})</strong>
          <ul>{warnings.map((wm, i) => <li key={i}>{wm}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

const TABS = ['Lifecycle Flows', 'Campaign Emails', 'Saved Emails'];

export default function EmailFlowStudio() {
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState([]); // generated/saved email_assets

  useEffect(() => {
    api.assets('email_assets').then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, []);

  function prepend(fresh) {
    setItems((prev) => [...fresh, ...prev]);
  }
  function updateItem(u) {
    setItems((xs) => xs.map((x) => (x.id === u.id ? u : x)));
  }

  const campaignEmails = items.filter((i) => i.flow_type === 'campaign');
  const lifecycleEmails = items.filter((i) => i.flow_type !== 'campaign');

  return (
    <div className="flow">
      <main className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>Email Studio</h2>
            <p className="flow-muted">Generate lifecycle flows and campaign emails with subject line, preheader, body and CTA.</p>
          </div>
        </div>

        <div className="gen-tabs">
          {TABS.map((t, i) => (
            <button key={t} className={tab === i ? 'gen-tab is-on' : 'gen-tab'} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>

        {tab === 0 && (
          <>
            <EmailForm
              fields={LIFECYCLE_FIELDS}
              initial={{ target_language: 'English', flow_types: ['welcome'] }}
              generate={(v) => api.generateEmailFlow(v)}
              onGenerated={prepend}
            />
            <div className="gen-results">
              {lifecycleEmails.map((i) => <EmailCard key={i.id} item={i} onChange={updateItem} />)}
            </div>
          </>
        )}

        {tab === 1 && (
          <>
            <EmailForm
              fields={CAMPAIGN_FIELDS}
              initial={{ target_language: 'English' }}
              generate={(v) => api.generateCampaignEmails(v)}
              onGenerated={prepend}
            />
            <div className="gen-results">
              {campaignEmails.map((i) => <EmailCard key={i.id} item={i} onChange={updateItem} />)}
            </div>
          </>
        )}

        {tab === 2 && (
          <div className="gen-results">
            {items.length === 0 && <div className="flow-card"><p className="flow-muted">No saved emails yet.</p></div>}
            {items.map((i) => <EmailCard key={i.id} item={i} onChange={updateItem} />)}
          </div>
        )}
      </main>
    </div>
  );
}
