import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { download } from '../../lib/export';
import TrialPaywall from '../../components/TrialPaywall';
import { CopyBtn } from './common';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Upgrade Prompts 16-18: shared scaffold for the generator studios (Website,
// Email, Captions, Creative). A studio is declared with a form field spec, a
// generate() call, and how to render one result item — the scaffold handles
// loading / empty / error / upgrade states, copy buttons and saved assets.
// ---------------------------------------------------------------------------

/** One form control. Supported types: text, textarea, number, select, checkboxes. */
export function FormField({ field, value, onChange }) {
  const { name, label, type = 'text', options = [], placeholder, required } = field;

  if (type === 'checkboxes') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flow-field">
        <span>{label}{required ? ' *' : ''}</span>
        <div className="gen-checks">
          {options.map((o) => {
            const val = o.value ?? o;
            const lbl = o.label ?? o;
            const on = selected.includes(val);
            return (
              <button
                type="button"
                key={val}
                className={on ? 'gen-chip is-on' : 'gen-chip'}
                onClick={() => onChange(on ? selected.filter((x) => x !== val) : [...selected, val])}
              >
                {lbl}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="flow-field">
      <span>{label}{required ? ' *' : ''}</span>
      {type === 'textarea' ? (
        <textarea rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {options.map((o) => {
            const val = o.value ?? o;
            const lbl = o.label ?? o;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
      ) : (
        <input
          type={type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(type === 'number' ? e.target.value : e.target.value)}
        />
      )}
    </label>
  );
}

/** Renders one asset field with an optional copy button. */
export function AssetField({ label, value, copy }) {
  if (value == null || value === '') return null;
  const isArr = Array.isArray(value);
  return (
    <div className="gen-field">
      <div className="gen-field-head">
        <span className="gen-field-label">{label}</span>
        {copy && <CopyBtn text={isArr ? value.join('\n') : String(value)} />}
      </div>
      {isArr ? (
        <ul className="kit-outline">{value.map((v, i) => <li key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</li>)}</ul>
      ) : (
        <p className="gen-field-val">{String(value)}</p>
      )}
    </div>
  );
}

export const STATUS_LABELS = ['draft', 'edited', 'ready', 'published'];

/** Status pill + cycle button (Prompt 20). Persists via the items PATCH route. */
export function StatusPill({ table, item, onChange }) {
  const [busy, setBusy] = useState(false);
  const status = item.status || 'draft';
  async function cycle() {
    const next = STATUS_LABELS[(STATUS_LABELS.indexOf(status) + 1) % STATUS_LABELS.length];
    setBusy(true);
    try {
      const r = await api.updateItem(table, item.id, { status: next });
      onChange(r.item);
    } catch {
      /* non-blocking */
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className={`gen-status is-${status}`} disabled={busy} onClick={cycle} title="Click to change status">
      {status}
    </button>
  );
}

export default function GeneratorStudio({
  title,
  blurb,
  fields,
  initial = {},
  generate, // (values) => Promise<response>
  resultKey, // key in the response holding the array (e.g. 'pages', 'items', 'emails')
  table, // matching item table for saved list + status
  renderItem, // (item, { table, onChange }) => JSX
  fullCopy, // (item) => string  — "copy full asset"
}) {
  // v5 Prompt 2: the completed brief survives auth, paywall and Stripe
  // redirects — restore any local draft, and save on every change.
  const draftKey = `lb-draft-${table || title}`;
  const [values, setValues] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
      return saved && typeof saved === 'object' ? { ...initial, ...saved } : initial;
    } catch {
      return initial;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [items, setItems] = useState(null); // saved assets
  const { account } = useAuth();
  const isFreePlan = !account || account.plan === 'free' || !account.plan;
  // v5 Prompt 6: launched from a campaign (?campaign=<id>) the generation
  // inherits its brief — campaign_id rides along with every generate call.
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaign') || values.campaign_id || null;

  useEffect(() => {
    if (!table) return;
    api.assets(table).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [table]);

  function set(name, v) {
    setValues((prev) => {
      const next = { ...prev, [name]: v };
      try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }

  async function onGenerate() {
    // A free account can't generate yet: open the trial paywall instead of
    // burning the request. The draft is already saved locally.
    if (isFreePlan) {
      setPaywall(true);
      return;
    }
    setBusy(true);
    setError(null);
    setUpgrade(false);
    setWarnings([]);
    try {
      const res = await generate(campaignId ? { ...values, campaign_id: campaignId } : values);
      const fresh = res[resultKey] || [];
      setWarnings(res.quality_warnings || []);
      // Newest first, prepended to any previously-saved assets.
      setItems((prev) => [...fresh, ...(prev || [])]);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') {
        if (isFreePlan || e.plan === 'free') setPaywall(true);
        else setUpgrade(true);
      } else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function exportAll() {
    const md = (items || []).map((i) => (fullCopy ? fullCopy(i) : JSON.stringify(i, null, 2))).join('\n\n---\n\n');
    download(`${(table || 'assets')}.md`, md, 'text/markdown');
  }

  function updateItem(updated) {
    setItems((xs) => (xs || []).map((x) => (x.id === updated.id ? updated : x)));
  }

  const missingRequired = fields.some(
    (f) => f.required && (values[f.name] == null || values[f.name] === '' || (Array.isArray(values[f.name]) && !values[f.name].length))
  );

  return (
    <div className="flow">
      <main className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>{title}</h2>
            {blurb && <p className="flow-muted">{blurb}</p>}
          </div>
        </div>

        <div className="flow-card gen-form">
          {campaignId && (
            <p className="flow-muted" role="status">
              Generating inside a campaign — the brief (offer, dates, CTA) is applied automatically.
            </p>
          )}
          {fields.map((f) => (
            <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          ))}
          <div className="flow-row">
            <button className="flow-btn" disabled={busy || missingRequired} onClick={onGenerate}>
              {busy ? 'Generating…' : `Generate ${title.replace(/ Studio$/, '')}`}
            </button>
          </div>
          <p className="flow-muted gen-cost-note">Generating uses 1 AI action. Editing, copying and exporting are free.</p>
          {error && <p className="flow-err">{error}</p>}
          {upgrade && (
            <p className="flow-err">
              You've hit your plan limit for generations.{' '}
              <Link to="/#pricing">Upgrade your plan</Link> to keep going.
            </p>
          )}
          {warnings.length > 0 && (
            <div className="gen-warnings">
              <strong>Quality checks ({warnings.length})</strong>
              <ul>{warnings.map((wm, i) => <li key={i}>{wm}</li>)}</ul>
            </div>
          )}
        </div>

        {items && items.length > 0 && (
          <div className="flow-row" style={{ marginBottom: 12 }}>
            <button className="kit-copy" onClick={exportAll}>Export all (Markdown)</button>
          </div>
        )}

        {items && items.length === 0 && !busy && (
          <div className="flow-card">
            <p className="flow-muted">Nothing generated yet. Fill in the form and generate your first assets.</p>
          </div>
        )}

        {items && items.length > 0 && (
          <div className="gen-results">
            {items.map((item) => (
              <div className="flow-card gen-card" key={item.id}>
                <div className="gen-card-head">
                  {table && <StatusPill table={table} item={item} onChange={updateItem} />}
                  <div className="studio-item-actions">
                    {fullCopy && <CopyBtn text={() => fullCopy(item)} label="Copy full" />}
                  </div>
                </div>
                {renderItem(item, { table, onChange: updateItem })}
              </div>
            ))}
          </div>
        )}
      </main>

      <TrialPaywall open={paywall} onClose={() => setPaywall(false)} />
    </div>
  );
}
