import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { download, findPlaceholders, assetPlainText, toWordDoc } from '../lib/export';
import { STATUS_LABEL } from '../lib/status-labels';
import { diffFields, diffSummary } from '../lib/version-diff';

// ---------------------------------------------------------------------------
// v9 SC-06 / v10 SC-02: the asset detail drawer — preview, provenance, manual
// edit, AI rewrite, version history, visual comparison and restore-after-
// confirm, plus export.
//
// Extracted from AssetLibrary so the campaign Assets tab is a real working
// surface instead of a dead-end list that sends the user to a separate global
// Library to do the actual work. There is exactly ONE drawer, one diff
// implementation and one status vocabulary — a second copy would drift.
// ---------------------------------------------------------------------------

const REWRITES = [
  ['shorter', 'Shorter'],
  ['longer', 'Longer'],
  ['direct', 'More direct'],
  ['native', 'More native'],
];

/** Unresolved claims block "Ready to export" — surface that instead. */
export function statusLabel(item) {
  const warnings = item.quality_warnings || item.warnings || [];
  if ((item.status === 'ready' || item.status === 'published') && warnings.length) return STATUS_LABEL.blocked;
  return STATUS_LABEL[item.status] || item.status || 'Draft';
}

export function provenanceLine(item) {
  const meta = item.__meta || item.meta || {};
  return [
    item.campaign_name || meta.campaign_name,
    (item.brief_version || meta.brief_version) ? `Brief v${item.brief_version || meta.brief_version}` : null,
    (item.prompt_version || meta.prompt_version) ? `Prompt ${item.prompt_version || meta.prompt_version}` : null,
    item.author_email || meta.source || (item.created_at ? 'AI-generated draft' : null),
  ].filter(Boolean).join(' · ');
}

const prettyField = (f) => f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function AssetDrawer({ table, id, onClose, onChanged, onError }) {
  const [detail, setDetail] = useState(null); // {asset, edit_fields, title_field}
  const [versions, setVersions] = useState(null);
  const [compare, setCompare] = useState(null); // a version being compared
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  function loadDetail() {
    return api.assetDetail(table, id).then((d) => {
      setDetail(d);
      setDraft({ title: d.asset[d.title_field] || d.asset.title || '', ...Object.fromEntries(d.edit_fields.map((f) => [f, d.asset[f] ?? ''])) });
    });
  }
  function loadVersions() {
    api.assetVersions(table, id).then((r) => setVersions(r.versions || [])).catch(() => setVersions([]));
  }
  useEffect(() => {
    loadDetail().catch((e) => onError(e.message));
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, id]);
  useEffect(() => {
    if (detail) api.trackEvent('asset_opened', { type: table, status: detail.asset.status || 'draft' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.asset?.id]);

  if (!detail) {
    return (
      <div className="asset-drawer" role="dialog" aria-label="Asset detail" aria-modal="true">
        <div className="asset-drawer-panel"><p className="muted">Loading asset…</p><button className="account-link" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  const a = detail.asset;
  const fields = detail.edit_fields;
  const fieldSpecs = fields.map((f) => [f, prettyField(f)]);
  const dirty = draft && fields.some((f) => (a[f] ?? '') !== (draft[f] ?? '')) || (a[detail.title_field] ?? a.title ?? '') !== (draft?.title ?? '');

  async function save() {
    setBusy(true); setNote(null);
    const patch = { expected_updated_at: a.updated_at, title: draft.title };
    for (const f of fields) patch[f] = draft[f];
    try {
      const r = await api.updateAsset(table, id, patch);
      setDetail((d) => ({ ...d, asset: { ...r.asset, table, type_label: d.asset.type_label } }));
      setNote('Saved. Previous version kept in history.');
      loadVersions(); onChanged();
    } catch (e) {
      if (e.code === 'STALE') { setNote('This asset changed elsewhere — reloaded the latest. Re-apply your edit.'); await loadDetail(); }
      else onError(e.message);
    } finally { setBusy(false); }
  }

  async function rewrite(mode) {
    setBusy(true); setNote(null);
    try {
      const r = await api.rewriteAsset(table, id, mode, '');
      setDetail((d) => ({ ...d, asset: { ...r.asset, table, type_label: d.asset.type_label } }));
      setDraft({ title: r.asset[detail.title_field] || r.asset.title || '', ...Object.fromEntries(fields.map((f) => [f, r.asset[f] ?? ''])) });
      loadVersions(); onChanged();
    } catch (e) {
      if (e.status === 402 || e.code === 'UPGRADE') onError('You’ve hit your plan limit for AI actions.');
      else onError(e.message);
    } finally { setBusy(false); }
  }

  async function restore() {
    if (!compare) return;
    const summary = diffSummary(compare.snapshot, a, fieldSpecs) || 'no field changes';
    if (!window.confirm(`Restore the version from ${new Date(compare.created_at).toLocaleString()}? This replaces the current copy (${summary}) and saves the current one to history first.`)) return;
    setBusy(true);
    try {
      const r = await api.restoreAsset(table, id, compare.id);
      api.trackEvent('version_restored', { type: table });
      setDetail((d) => ({ ...d, asset: { ...(r.asset || r.item || r), table, type_label: d.asset.type_label } }));
      setDraft({ title: (r.asset || {})[detail.title_field] || '', ...Object.fromEntries(fields.map((f) => [f, (r.asset || {})[f] ?? ''])) });
      setCompare(null); loadVersions(); onChanged();
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  }

  function openCompare(v) {
    setCompare(v);
    api.trackEvent('version_compared', { type: table });
  }

  function exportAs(fmt) {
    const item = { ...a, title: draft.title };
    const text = assetPlainText(item);
    const warn = findPlaceholders(item);
    if (warn.length && !window.confirm(`This asset still has unresolved placeholders:\n${warn.join(', ')}\n\nExport anyway?`)) return;
    const base = (draft.title || 'asset').replace(/[^\w-]+/g, '_').slice(0, 40);
    if (fmt === 'txt') download(`${base}.txt`, text, 'text/plain');
    else if (fmt === 'md') download(`${base}.md`, `# ${draft.title}\n\n${text}`, 'text/markdown');
    else if (fmt === 'doc') download(`${base}.doc`, toWordDoc(draft.title, text), 'application/msword');
    api.trackEvent('export_completed', { type: table, status: a.status || 'draft', format: fmt });
  }

  const diff = compare ? diffFields(compare.snapshot, a, fieldSpecs) : null;

  return (
    <div className="asset-drawer" role="dialog" aria-label="Asset detail" aria-modal="true" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="asset-drawer-panel">
        <div className="brand-head" style={{ alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>{draft.title || a.title}</h2>
          <button className="account-link" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {[a.type_label, statusLabel(a), provenanceLine(a)].filter(Boolean).join(' · ')}
        </p>
        {note && <p className="flow-muted" role="status">{note}</p>}

        {/* Manual edit — free, saves a version, conflict-safe. */}
        <label className="flow-field"><span>Title</span>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        {fieldSpecs.map(([f, label]) => (
          <label className="flow-field" key={f}><span>{label}</span>
            <textarea rows={f === 'body_copy' || f === 'primary_text' || f === 'caption' ? 5 : 2}
              value={draft[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
          </label>
        ))}
        <div className="confirm-row">
          <button className="btn-primary" disabled={busy || !dirty} onClick={save}>Save edits (free · keeps a version)</button>
          <select defaultValue="" disabled={busy} aria-label="AI rewrite" onChange={(e) => { if (e.target.value) { rewrite(e.target.value); e.target.value = ''; } }}>
            <option value="" disabled>AI rewrite · 1 AI action…</option>
            {REWRITES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select defaultValue="" aria-label="Export" onChange={(e) => { if (e.target.value) { exportAs(e.target.value); e.target.value = ''; } }}>
            <option value="" disabled>Export…</option>
            <option value="txt">Plain text (.txt)</option>
            <option value="md">Markdown (.md)</option>
            <option value="doc">Word-compatible file (.doc)</option>
          </select>
        </div>

        {/* Version history + visual comparison. */}
        <h3>Version history</h3>
        {versions === null && <p className="muted">Loading versions…</p>}
        {versions && versions.length === 0 && <p className="muted">No earlier versions yet. Edits and AI rewrites will appear here.</p>}
        {versions && versions.map((v) => (
          <div className="asset-version-row" key={v.id}>
            <span className="muted">{new Date(v.created_at).toLocaleString()} · {v.source || 'edit'}{v.author_email ? ` · ${v.author_email}` : ''}</span>
            <button className="account-link" onClick={() => openCompare(v)}>Compare versions</button>
          </div>
        ))}

        {compare && (
          <div className="asset-diff" role="region" aria-label="Version comparison">
            <div className="brand-head" style={{ alignItems: 'baseline' }}>
              <strong>Comparing {new Date(compare.created_at).toLocaleString()} → current</strong>
              <button className="account-link" onClick={() => setCompare(null)}>Close comparison</button>
            </div>
            <p className="muted">{diffSummary(compare.snapshot, a, fieldSpecs) || 'No differences in the editable fields.'}</p>
            {diff.filter((d) => d.status !== 'unchanged').map((d) => (
              <div className={`asset-diff-field is-${d.status}`} key={d.field}>
                <span className="asset-diff-label">{d.label} · {d.status}</span>
                {d.before && <div className="asset-diff-before"><span className="muted">That version</span><p>{d.before}</p></div>}
                {d.after && <div className="asset-diff-after"><span className="muted">Current</span><p>{d.after}</p></div>}
              </div>
            ))}
            <button className="btn-secondary" disabled={busy} onClick={restore}>Restore this version</button>
          </div>
        )}
      </div>
    </div>
  );
}
