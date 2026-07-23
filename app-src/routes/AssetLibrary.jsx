import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { download, findPlaceholders, assetPlainText, assetsCsv, toWordDoc } from '../lib/export';
import { STATUS_LABEL } from '../lib/status-labels';
import { diffFields, diffSummary } from '../lib/version-diff';

// ---------------------------------------------------------------------------
// v9 SC-06: Library as a review workspace, not an admin utility. Filters live in
// the URL (deep-linkable), an accessible asset drawer replaces the row's
// window.prompt/alert flows, versions can be compared visually (Added/Removed/
// Changed) and restored only after a preview + confirm, and a persistent action
// bar shows the exact multi-select count. The list stays bounded to snippets;
// full detail and version content are fetched on demand.
// ---------------------------------------------------------------------------

const TYPES = [
  ['', 'All types'],
  ['website_pages', 'Website pages'],
  ['email_assets', 'Emails'],
  ['social_assets', 'Social posts'],
  ['creative_assets', 'Ad creatives'],
  ['seo_assets', 'SEO assets'],
];

const STATUSES = [['', 'Any status'], ...Object.entries(STATUS_LABEL).filter(([v]) => v !== 'blocked')];

const REWRITES = [
  ['shorter', 'Shorter'],
  ['longer', 'Longer'],
  ['direct', 'More direct'],
  ['native', 'More native'],
];

const FILTER_KEYS = ['type', 'q', 'favourite', 'archived', 'status', 'platform', 'language', 'campaign_id'];
const FILTER_LABEL = {
  type: 'Type', q: 'Search', favourite: 'Favourites', archived: 'Archived',
  status: 'Status', platform: 'Platform', language: 'Language', campaign_id: 'Campaign',
};

/** Unresolved claims block "Ready to export" — surface that instead. */
function statusLabel(item) {
  const warnings = item.quality_warnings || item.warnings || [];
  if ((item.status === 'ready' || item.status === 'published') && warnings.length) return STATUS_LABEL.blocked;
  return STATUS_LABEL[item.status] || item.status || 'Draft';
}

function provenanceLine(item) {
  const meta = item.__meta || item.meta || {};
  return [
    item.campaign_name || meta.campaign_name,
    (item.brief_version || meta.brief_version) ? `Brief v${item.brief_version || meta.brief_version}` : null,
    (item.prompt_version || meta.prompt_version) ? `Prompt ${item.prompt_version || meta.prompt_version}` : null,
    item.author_email || meta.source || (item.created_at ? 'AI-generated draft' : null),
  ].filter(Boolean).join(' · ');
}

const prettyField = (f) => f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function AssetLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || '']));
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);

  const [data, setData] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState({});
  const [openAsset, setOpenAsset] = useState(null); // {table, id}
  const [error, setError] = useState(null);

  useEffect(() => {
    api.campaigns().then((r) => setCampaigns(r.campaigns || [])).catch(() => setCampaigns([]));
  }, []);

  function load() {
    const params = { page, per: 25 };
    for (const k of FILTER_KEYS) if (filters[k]) params[k] = filters[k];
    api.library(params).then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page'); // any filter change resets to page 1
    setSearchParams(next, { replace: true });
  }
  function resetFilters() { setSearchParams(new URLSearchParams(), { replace: true }); }
  function goPage(p) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next, { replace: true });
  }

  const activeFilters = FILTER_KEYS
    .filter((k) => filters[k])
    .map((k) => `${FILTER_LABEL[k]}: ${k === 'campaign_id' ? (campaigns.find((c) => String(c.id) === filters[k])?.name || filters[k]) : (k === 'type' ? (TYPES.find((t) => t[0] === filters[k])?.[1]) : filters[k])}`);

  const toggleSel = (item) => {
    const key = `${item.table}:${item.id}`;
    setSelected((s) => ({ ...s, [key]: s[key] ? undefined : { table: item.table, id: item.id } }));
  };
  const selItems = Object.values(selected).filter(Boolean);

  async function bulkArchive() {
    if (!selItems.length) return;
    await api.bulkAssets(filters.archived ? 'unarchive' : 'archive', selItems);
    setSelected({}); load();
  }
  async function bulkDelete() {
    if (!selItems.length) return;
    if (!window.confirm(`Delete ${selItems.length} asset${selItems.length === 1 ? '' : 's'}? Version history will also be removed. This cannot be undone.`)) return;
    try {
      await api.bulkAssets('delete', selItems);
    } catch (e) {
      if (e.code === 'CONFIRM_DELETE') {
        if (!window.confirm(`${e.message}\n\nReally delete ${selItems.length} permanently?`)) return;
        await api.bulkAssets('delete', selItems, { confirm: true });
      } else { setError(e.message); return; }
    }
    setSelected({}); load();
  }

  const totalPages = data ? Math.ceil(data.total / data.per) : 1;

  return (
    <div className="library-page">
      <h1>Library</h1>
      <p className="muted">Find, open, compare and prepare every campaign asset — with its campaign, brief version, source, status and edit history.</p>

      <div className="library-filters">
        <select aria-label="Type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Campaign" value={filters.campaign_id} onChange={(e) => setFilter('campaign_id', e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Search titles and copy" aria-label="Search titles and copy"
          value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="Platform…" aria-label="Platform" value={filters.platform} onChange={(e) => setFilter('platform', e.target.value)} style={{ maxWidth: 120 }} />
        <input placeholder="Language…" aria-label="Language" value={filters.language} onChange={(e) => setFilter('language', e.target.value)} style={{ maxWidth: 120 }} />
        <label className="consent" style={{ margin: 0 }}>
          <input type="checkbox" checked={filters.favourite === 'true'} onChange={(e) => setFilter('favourite', e.target.checked ? 'true' : '')} />
          <span>Favourites</span>
        </label>
        <label className="consent" style={{ margin: 0 }}>
          <input type="checkbox" checked={filters.archived === 'true'} onChange={(e) => setFilter('archived', e.target.checked ? 'true' : '')} />
          <span>Archived</span>
        </label>
        <button className="btn-secondary" onClick={() => download('library.csv', assetsCsv(data?.items || []), 'text/csv')}>Export CSV</button>
      </div>

      {error && <p className="login-err">{error}</p>}
      {!data && <p className="muted">Loading…</p>}

      {data && data.items.length === 0 && (
        <div className="account-section">
          <p style={{ margin: 0 }}>No assets match {activeFilters.length ? 'these filters' : 'your library yet'}.</p>
          {activeFilters.length > 0 && (
            <p className="muted" style={{ marginBottom: 8 }}>
              Active filters — {activeFilters.join(' · ')}.{' '}
              <button className="account-link" onClick={resetFilters}>Reset all filters</button>
            </p>
          )}
        </div>
      )}

      {(data?.items || []).map((item) => (
        <div className="library-row" key={`${item.table}:${item.id}`}>
          <input type="checkbox" aria-label={`Select ${item.title}`}
            checked={!!selected[`${item.table}:${item.id}`]} onChange={() => toggleSel(item)} />
          <div className="library-main">
            <div className="library-title">
              <button className="library-star" onClick={() => api.updateAsset(item.table, item.id, { favourite: !item.favourite }).then(load)} title="Favourite" aria-label="Toggle favourite">
                {item.favourite ? '★' : '☆'}
              </button>
              <button className="library-open-link" onClick={() => setOpenAsset({ table: item.table, id: item.id })}>
                {item.title}
              </button>
              <span className="campaign-badge">{item.type_label}</span>
              <span className="campaign-badge">{statusLabel(item)}</span>
            </div>
            {provenanceLine(item) && <div className="library-provenance">{provenanceLine(item)}</div>}
            <div className="library-snippet">{item.snippet}</div>
            <div className="library-actions">
              <button className="btn-secondary" onClick={() => setOpenAsset({ table: item.table, id: item.id })}>Open</button>
            </div>
          </div>
        </div>
      ))}

      {data && data.total > data.per && (
        <div className="library-pager">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => goPage(page - 1)}>← Prev</button>
          <span className="muted"> Page {page} of {totalPages} </span>
          <button className="btn-secondary" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>Next →</button>
        </div>
      )}

      {/* Persistent multi-select action bar with an exact count. */}
      {selItems.length > 0 && (
        <div className="library-actionbar" role="region" aria-label="Selection actions">
          <span><strong>{selItems.length}</strong> selected</span>
          <button className="btn-secondary" onClick={bulkArchive}>{filters.archived ? 'Unarchive' : 'Archive'} {selItems.length}</button>
          <button className="btn-secondary" onClick={bulkDelete}>Delete {selItems.length}</button>
          <button className="account-link" onClick={() => setSelected({})}>Clear selection</button>
        </div>
      )}

      {openAsset && (
        <AssetDrawer
          table={openAsset.table} id={openAsset.id}
          onClose={() => setOpenAsset(null)} onChanged={load} onError={setError}
        />
      )}
    </div>
  );
}

// ── Asset detail drawer: preview, metadata, edit, versions, compare, export ──
function AssetDrawer({ table, id, onClose, onChanged, onError }) {
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
