import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
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
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const [items, setItems] = useState(null); // saved assets

  useEffect(() => {
    if (!table) return;
    api.assets(table).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [table]);

  function set(name, v) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  async function onGenerate() {
    setBusy(true);
    setError(null);
    setUpgrade(false);
    try {
      const res = await generate(values);
      const fresh = res[resultKey] || [];
      // Newest first, prepended to any previously-saved assets.
      setItems((prev) => [...fresh, ...(prev || [])]);
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') setUpgrade(true);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
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
          {fields.map((f) => (
            <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          ))}
          <div className="flow-row">
            <button className="flow-btn" disabled={busy || missingRequired} onClick={onGenerate}>
              {busy ? 'Generating…' : `Generate ${title.replace(/ Studio$/, '')}`}
            </button>
          </div>
          {error && <p className="flow-err">{error}</p>}
          {upgrade && (
            <p className="flow-err">
              You've hit your plan limit for generations.{' '}
              <Link to="/#pricing">Upgrade your plan</Link> to keep going.
            </p>
          )}
        </div>

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
    </div>
  );
}
