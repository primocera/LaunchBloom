import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { download } from '../../lib/export';
import { promoWindow, emailPlainText, emailMarkdown, emailsMarkdown } from '../../lib/email-preview';
import TrialPaywall from '../../components/TrialPaywall';
import { CopyBtn } from './common';
import { AssetField, FormField, StatusPill } from './generator';
import '../../flow.css';

const TONE_FIELD = {
  name: 'tone', label: 'Tone', type: 'select',
  options: ['Friendly', 'Professional', 'Playful', 'Urgent (honest)', 'Warm', 'Minimal'],
};
const LENGTH_FIELD = {
  name: 'email_length', label: 'Length', type: 'select',
  options: [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }],
};

// ---------------------------------------------------------------------------
// Upgrade Prompt 17: Email Studio — three tabs (Lifecycle Flows, Campaign
// Emails, Saved Emails) over the shared email_assets table. Per-field copy
// (subject / preheader / body / CTA) plus a "Copy full email" button.
// ---------------------------------------------------------------------------

const LIFECYCLE_FIELDS = [
  {
    name: 'flow_types', label: 'Flow types', type: 'checkboxes', required: true,
    options: [
      { value: 'welcome', label: 'Welcome (3–5)' },
      { value: 'abandon_cart', label: 'Abandoned cart (3)' },
      { value: 'browse_abandon', label: 'Browse abandonment (2)' },
      { value: 'post_purchase', label: 'Post-purchase (3)' },
      { value: 'winback', label: 'Win-back (3)' },
      { value: 'review_request', label: 'Review request (2)' },
      { value: 'back_in_stock', label: 'Back-in-stock (2)' },
      { value: 'sunset', label: 'Sunset / re-engagement (2)' },
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
  TONE_FIELD,
  LENGTH_FIELD,
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'campaign_goal', label: 'Campaign goal (optional)', type: 'text' },
  { name: 'extra_context', label: 'Product / offer details (optional)', type: 'textarea' },
];

const CAMPAIGN_FIELDS = [
  { name: 'campaign_theme', label: 'Campaign theme', type: 'text', required: true },
  { name: 'campaign_goal', label: 'Campaign goal', type: 'text', required: true },
  {
    name: 'campaign_type', label: 'Campaign type', type: 'select', required: true,
    options: [
      { value: 'promotion', label: 'Promotion' },
      { value: 'product_launch', label: 'Product launch' },
      { value: 'educational', label: 'Educational' },
      { value: 'seasonal', label: 'Seasonal' },
      { value: 'newsletter', label: 'Newsletter' },
      { value: 'flash_offer', label: 'Flash offer' },
      { value: 'last_chance', label: 'Last chance' },
      { value: 'restock', label: 'Restock' },
      { value: 'announcement', label: 'Announcement' },
    ],
  },
  TONE_FIELD,
  LENGTH_FIELD,
  // Real promotion details — used verbatim, never invented. Leave blank to skip.
  { name: 'discount_or_offer', label: 'Discount / offer', type: 'text', placeholder: 'e.g. 20% off sitewide' },
  { name: 'discount_code', label: 'Discount code', type: 'text', placeholder: 'e.g. SUMMER20' },
  { name: 'minimum_spend', label: 'Minimum spend', type: 'text', placeholder: 'e.g. $50' },
  { name: 'promo_exclusions', label: 'Exclusions', type: 'text', placeholder: 'e.g. excludes sale items' },
  { name: 'start_date', label: 'Start date', type: 'text', placeholder: 'e.g. 2026-08-01' },
  { name: 'end_date', label: 'End date', type: 'text', placeholder: 'e.g. 2026-08-07' },
  { name: 'timezone', label: 'Timezone', type: 'text', placeholder: 'e.g. America/New_York' },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Products / context', type: 'textarea' },
];

function EmailCard({ item, onChange }) {
  const [view, setView] = useState('edit'); // edit | mobile | plain
  const window = promoWindow(item.promo_details || {});
  const subjects = Array.isArray(item.subject_options) && item.subject_options.length
    ? item.subject_options : [item.subject_line].filter(Boolean);
  return (
    <div className="flow-card gen-card">
      <div className="gen-card-head">
        <StatusPill table="email_assets" item={item} onChange={onChange} />
        <div className="studio-item-actions">
          <span className="kit-item-meta">
            {item.flow_type}{item.segment ? ` · ${item.segment}` : ''}{item.send_timing ? ` · ${item.send_timing}` : ''}
          </span>
          <CopyBtn text={() => emailMarkdown(item)} label="Copy full email" />
        </div>
      </div>

      {item.objective && <p className="flow-muted" style={{ marginTop: 0 }}>{item.objective}</p>}
      {window && <p className="flow-muted">Promotion window: {window}</p>}

      <div className="gen-tabs" role="tablist">
        {[['edit', 'Details'], ['mobile', 'Mobile preview'], ['plain', 'Plain-text']].map(([k, lbl]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'gen-tab is-on' : 'gen-tab'} onClick={() => setView(k)}>{lbl}</button>
        ))}
      </div>

      {view === 'edit' && (
        <>
          {subjects.length > 1
            ? <AssetField label="Subject options" value={subjects} copy />
            : <AssetField label="Subject line" value={item.subject_line} copy />}
          <AssetField label="Preheader" value={item.preheader} copy />
          <AssetField label="Headline" value={item.headline} copy />
          <AssetField label="Body" value={item.body_copy} copy />
          <AssetField label="CTA" value={item.cta} copy />
          <AssetField label="Secondary CTA" value={item.secondary_cta} copy />
          <AssetField label="Exclusions" value={item.exclusions} />
          <AssetField label="Design notes" value={item.design_notes} />
          <div className="flow-row" style={{ marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => download(`${item.flow_type || 'email'}-${item.email_order || 1}.md`, emailMarkdown(item), 'text/markdown')}>Export Markdown</button>
          </div>
        </>
      )}

      {view === 'mobile' && (
        <div className="email-mobile">
          <div className="email-mobile-subject">{item.subject_line}</div>
          <div className="email-mobile-preheader">{item.preheader}</div>
          {item.headline && <h4>{item.headline}</h4>}
          <div className="email-mobile-body">{item.body_copy}</div>
          {item.cta && <div className="email-mobile-cta">{item.cta}</div>}
        </div>
      )}

      {view === 'plain' && (
        <>
          <pre className="email-plain">{emailPlainText(item)}</pre>
          <CopyBtn text={() => emailPlainText(item)} label="Copy plain-text" />
        </>
      )}
    </div>
  );
}

/** A generate form for one tab. Returns generated emails up to the parent. */
function EmailForm({ fields, initial, generate, onGenerated }) {
  const [values, setValues] = useState(initial || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const { account } = useAuth();
  const isFreePlan = !account || account.plan === 'free' || !account.plan;

  const missing = fields.some(
    (f) => f.required && (values[f.name] == null || values[f.name] === '' || (Array.isArray(values[f.name]) && !values[f.name].length))
  );

  async function run() {
    if (isFreePlan) { setPaywall(true); return; } // v5 Prompt 2: trial paywall
    setBusy(true); setError(null); setUpgrade(false); setWarnings([]);
    try {
      const res = await generate(values);
      setWarnings(res.quality_warnings || []);
      onGenerated(res.emails || []);
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') {
        if (isFreePlan || e.plan === 'free') setPaywall(true);
        else setUpgrade(true);
      } else setError(e.message);
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
      <TrialPaywall open={paywall} onClose={() => setPaywall(false)} />
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
            <p className="flow-muted">Lifecycle flows and campaign emails — every email ships full, send-ready body copy with subject options, preheader, CTA, timing and mobile/plain-text previews.</p>
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
            {lifecycleEmails.length > 0 && (
              <div className="flow-row" style={{ margin: '12px 0' }}>
                <button className="kit-copy" onClick={() => download('lifecycle-emails.md', emailsMarkdown(lifecycleEmails), 'text/markdown')}>Export all (Markdown)</button>
              </div>
            )}
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
            {campaignEmails.length > 0 && (
              <div className="flow-row" style={{ margin: '12px 0' }}>
                <button className="kit-copy" onClick={() => download('campaign-emails.md', emailsMarkdown(campaignEmails), 'text/markdown')}>Export all (Markdown)</button>
              </div>
            )}
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
