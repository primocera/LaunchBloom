import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { download } from '../../lib/export';
import TrialPaywall from '../../components/TrialPaywall';
import { CopyBtn } from './common';
import {
  deriveContext,
  validateFields,
  hasBlockingErrors,
  outputEstimate,
  RESULT_TABS,
} from '../../lib/generator-shell';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Upgrade Prompts 16-18: shared scaffold for the generator studios (Website,
// Email, Captions, Creative). A studio is declared with a form field spec, a
// generate() call, and how to render one result item — the scaffold handles
// loading / empty / error / upgrade states, copy buttons and saved assets.
// ---------------------------------------------------------------------------

/** One form control. Supported types: text, textarea, number, select, checkboxes. */
export function FormField({ field, value, onChange, warning }) {
  const { name, label, type = 'text', options = [], placeholder, required } = field;
  const warn = warning ? <span className="gen-field-warn" role="alert">{warning}</span> : null;

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
        {warn}
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
      {warn}
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

const REGEN_MODES = [
  { mode: 'shorter', label: 'Shorter' },
  { mode: 'longer', label: 'Longer' },
  { mode: 'direct', label: 'More direct' },
  { mode: 'native', label: 'More native' },
];

/**
 * One result with Output / Quality / Versions / Brief tabs (Prompt 7).
 * Editing and copying are free; full/section regeneration costs one action and
 * always snapshots the previous copy into version history first.
 */
function ResultCard({ item, table, renderItem, fullCopy, onChange, onUpgrade }) {
  const [tab, setTab] = useState('Output');
  const [versions, setVersions] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const warnings = item.quality_warnings || [];
  const brief = item.brief_snapshot || null;

  function loadVersions() {
    if (!table) return;
    setVersions(null);
    api.assetVersions(table, item.id).then((r) => setVersions(r.versions || [])).catch(() => setVersions([]));
  }

  async function regenerate(mode) {
    if (!table) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.rewriteAsset(table, item.id, mode, mode === 'instruction' ? instruction : '');
      onChange(r.asset);
      setInstruction('');
      if (tab === 'Versions') loadVersions();
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') onUpgrade(e);
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(versionId) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.restoreAsset(table, item.id, versionId);
      onChange(r.asset || r.item || r);
      loadVersions();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow-card gen-card">
      <div className="gen-card-head">
        {table && <StatusPill table={table} item={item} onChange={onChange} />}
        <div className="studio-item-actions">
          {fullCopy && <CopyBtn text={() => fullCopy(item)} label="Copy full" />}
        </div>
      </div>

      {table && (
        <div className="gen-tabs" role="tablist">
          {RESULT_TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'gen-tab is-on' : 'gen-tab'}
              onClick={() => { setTab(t); if (t === 'Versions') loadVersions(); }}
            >
              {t}{t === 'Quality' && warnings.length ? ` (${warnings.length})` : ''}
            </button>
          ))}
        </div>
      )}

      {tab === 'Output' && (
        <>
          {renderItem(item, { table, onChange })}
          {table && (
            <div className="gen-regen">
              <p className="flow-muted gen-cost-note">
                Regenerating uses 1 AI action and saves the current copy to Versions first. Editing and copying are free.
              </p>
              <div className="flow-row gen-regen-modes">
                {REGEN_MODES.map((m) => (
                  <button key={m.mode} className="btn-secondary" disabled={busy} onClick={() => regenerate(m.mode)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flow-row">
                <input
                  className="gen-regen-input"
                  placeholder="Refine with an instruction (e.g. warmer tone, mention free shipping)"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <button className="btn-secondary" disabled={busy || !instruction.trim()} onClick={() => regenerate('instruction')}>
                  {busy ? 'Working…' : 'Regenerate'}
                </button>
              </div>
              {err && <p className="flow-err">{err}</p>}
            </div>
          )}
        </>
      )}

      {tab === 'Quality' && (
        warnings.length ? (
          <ul className="gen-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        ) : <p className="flow-muted">No quality issues flagged for this asset.</p>
      )}

      {tab === 'Versions' && (
        versions === null ? <p className="flow-muted">Loading version history…</p> :
        versions.length === 0 ? <p className="flow-muted">No earlier versions yet. Edits and regenerations will appear here.</p> : (
          <ul className="gen-versions">
            {versions.map((v) => (
              <li key={v.id}>
                <span className="flow-muted">{new Date(v.created_at).toLocaleString()}</span>
                <button className="account-link" disabled={busy} onClick={() => restore(v.id)}>Restore</button>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'Brief' && (
        brief ? (
          <dl className="gen-brief">
            {Object.entries(brief).filter(([, val]) => val != null && val !== '').map(([k, val]) => (
              <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{Array.isArray(val) ? val.join(', ') : String(val)}</dd></div>
            ))}
          </dl>
        ) : <p className="flow-muted">This asset wasn’t generated from a campaign brief.</p>
      )}
    </div>
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
  const [announce, setAnnounce] = useState(''); // v5 Prompt 19: SR live region
  const [items, setItems] = useState(null); // saved assets
  const [profile, setProfile] = useState({}); // brand context for chips
  const [campaign, setCampaign] = useState(null);
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

  // v5 Prompt 7: brand + campaign context drive the editable chips and the
  // smart defaults (primary product/audience — never a silent first pick).
  useEffect(() => {
    api.brandProfile().then((r) => setProfile(r.profile || {})).catch(() => setProfile({}));
  }, []);
  useEffect(() => {
    if (!campaignId) { setCampaign(null); return; }
    api.campaign(campaignId).then((r) => setCampaign(r.campaign || null)).catch(() => setCampaign(null));
  }, [campaignId]);

  const chips = deriveContext({ profile, campaign, values });
  const fieldWarnings = validateFields(fields, values);

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
    setAnnounce('Generating… this uses one AI action.');
    try {
      const res = await generate(campaignId ? { ...values, campaign_id: campaignId } : values);
      const fresh = res[resultKey] || [];
      setWarnings(res.quality_warnings || []);
      // Newest first, prepended to any previously-saved assets.
      setItems((prev) => [...fresh, ...(prev || [])]);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      setAnnounce(`Generated ${fresh.length} item${fresh.length === 1 ? '' : 's'}.`);
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') {
        if (isFreePlan || e.plan === 'free') { setPaywall(true); setAnnounce('Start your trial to generate.'); }
        else { setUpgrade(true); setAnnounce('Plan limit reached.'); }
      } else { setError(e.message); setAnnounce('Generation failed. You can retry.'); }
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

  const missingRequired = hasBlockingErrors(fields, values);

  return (
    <div className="flow">
      <main className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>{title}</h2>
            {blurb && <p className="flow-muted">{blurb}</p>}
          </div>
        </div>

        {/* v5 Prompt 19: screen-reader announcements for generation state. */}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>

        <div className="flow-card gen-form" aria-busy={busy}>
          {/* v5 Prompt 7: editable context — the exact brand, product, audience,
              campaign, language and goal this generation will use. */}
          <div className="gen-context" aria-label="Generation context">
            {chips.map((c) => (
              c.missing && c.editable ? (
                <Link key={c.key} to="/app/brand" className="gen-context-chip is-missing">
                  {c.label}: set in Brand →
                </Link>
              ) : (
                <span key={c.key} className="gen-context-chip">
                  <span className="gen-context-label">{c.label}</span>
                  {c.value || '—'}
                </span>
              )
            ))}
            <Link to="/app/brand" className="gen-context-edit">Edit brand</Link>
          </div>

          {campaignId && (
            <p className="flow-muted" role="status">
              Generating inside a campaign — the brief (offer, dates, CTA) is applied automatically.
            </p>
          )}
          {fields.map((f) => (
            <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} warning={fieldWarnings[f.name]} />
          ))}
          <div className="flow-row">
            <button className="flow-btn" disabled={busy || missingRequired} onClick={onGenerate}>
              {busy ? 'Generating…' : `Generate ${title.replace(/ Studio$/, '')}`}
            </button>
          </div>
          <p className="flow-muted gen-cost-note" role="status">{outputEstimate({ resultKey })}</p>
          {error && (
            <p className="flow-err" role="alert">
              {error}{' '}
              <button className="account-link" onClick={onGenerate}>Retry</button>
            </p>
          )}
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
              <ResultCard
                key={item.id}
                item={item}
                table={table}
                renderItem={renderItem}
                fullCopy={fullCopy}
                onChange={updateItem}
                onUpgrade={(e) => (isFreePlan || e.plan === 'free' ? setPaywall(true) : setUpgrade(true))}
              />
            ))}
          </div>
        )}
      </main>

      <TrialPaywall open={paywall} onClose={() => setPaywall(false)} />
    </div>
  );
}
