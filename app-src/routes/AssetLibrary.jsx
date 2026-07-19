import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { download, findPlaceholders, assetPlainText, assetsCsv, toWordDoc } from '../lib/export';
import { STATUS_LABEL } from '../lib/status-labels';

// Prompt 13: one searchable library for everything the studios generate.
const TYPES = [
  ['', 'All types'],
  ['website_pages', 'Website pages'],
  ['email_assets', 'Emails'],
  ['social_assets', 'Social posts'],
  ['creative_assets', 'Ad creatives'],
  ['seo_assets', 'SEO assets'],
];

// Status vocabulary lives in lib/status-labels.js (v7 LB-11) so studio pills
// and Library always agree. Underlying enum values are kept
// (draft/edited/ready/published) so the item PATCH route and StatusPill cycle
// stay valid; only the customer-facing labels are shared.
const STATUSES = [['', 'Any status'], ...Object.entries(STATUS_LABEL).filter(([v]) => v !== 'blocked')];

/** Unresolved claims block "Ready to export" — surface that instead. */
function statusLabel(item) {
  const warnings = item.quality_warnings || item.warnings || [];
  if ((item.status === 'ready' || item.status === 'published') && warnings.length) {
    return STATUS_LABEL.blocked;
  }
  return STATUS_LABEL[item.status] || item.status || 'Draft';
}

/** Provenance shown on every row (Prompt 26): campaign, brief and prompt version, source. */
function provenanceLine(item) {
  const meta = item.__meta || item.meta || {};
  const bits = [
    item.campaign_name || meta.campaign_name,
    (item.brief_version || meta.brief_version) ? `Brief v${item.brief_version || meta.brief_version}` : null,
    (item.prompt_version || meta.prompt_version) ? `Prompt ${item.prompt_version || meta.prompt_version}` : null,
    item.author_email || meta.source || (item.created_at ? 'AI-generated draft' : null),
  ].filter(Boolean);
  return bits.join(' · ');
}

const REWRITES = [
  ['shorter', 'Shorter'],
  ['longer', 'Longer'],
  ['direct', 'More direct'],
  ['native', 'More native'],
  ['instruction', 'Custom instruction…'],
];

export default function AssetLibrary() {
  const [filters, setFilters] = useState({ type: '', q: '', favourite: '', archived: '', status: '', platform: '', language: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  function load(p = page) {
    const params = { page: p, per: 25 };
    if (filters.type) params.type = filters.type;
    if (filters.q) params.q = filters.q;
    if (filters.favourite) params.favourite = filters.favourite;
    if (filters.archived) params.archived = filters.archived;
    if (filters.status) params.status = filters.status;
    if (filters.platform) params.platform = filters.platform;
    if (filters.language) params.language = filters.language;
    api.library(params).then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => { setPage(1); load(1); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, id) {
    setBusyId(id);
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e.message); }
    setBusyId(null);
  }

  const toggleSel = (item) => {
    const key = `${item.table}:${item.id}`;
    setSelected((s) => ({ ...s, [key]: s[key] ? undefined : { table: item.table, id: item.id } }));
  };
  const selItems = Object.values(selected).filter(Boolean);

  async function bulkArchive() {
    if (selItems.length === 0) return;
    await api.bulkAssets(filters.archived ? 'unarchive' : 'archive', selItems);
    setSelected({});
    load();
  }

  async function bulkDelete() {
    if (selItems.length === 0) return;
    // Two explicit confirmations for a permanent, irreversible bulk delete.
    if (!window.confirm(`Delete ${selItems.length} assets? Version history will also be removed. This cannot be undone.`)) return;
    try {
      await api.bulkAssets('delete', selItems); // server 409s without confirm
    } catch (e) {
      if (e.code === 'CONFIRM_DELETE') {
        if (!window.confirm(`${e.message}\n\nType-check: really delete ${selItems.length}?`)) return;
        await api.bulkAssets('delete', selItems, { confirm: true });
      } else { setError(e.message); return; }
    }
    setSelected({});
    load();
  }

  function exportItem(item, fmt) {
    const text = assetPlainText(item);
    const warn = findPlaceholders(item);
    if (warn.length && !window.confirm(`This asset still has unresolved placeholders:\n${warn.join(', ')}\n\nExport anyway?`)) return;
    const base = (item.title || 'asset').replace(/[^\w-]+/g, '_').slice(0, 40);
    if (fmt === 'txt') download(`${base}.txt`, text, 'text/plain');
    else if (fmt === 'md') download(`${base}.md`, `# ${item.title}\n\n${text}`, 'text/markdown');
    else if (fmt === 'doc') download(`${base}.doc`, toWordDoc(item.title, text), 'application/msword');
  }

  function exportCsv() {
    download('library.csv', assetsCsv(data?.items || []), 'text/csv');
  }

  async function rewrite(item, mode) {
    let instruction = '';
    if (mode === 'instruction') {
      instruction = window.prompt('How should this be rewritten?') || '';
      if (!instruction.trim()) return;
    }
    await act(() => api.rewriteAsset(item.table, item.id, mode, instruction), item.id);
  }

  async function showVersions(item) {
    const { versions } = await api.assetVersions(item.table, item.id);
    if (!versions.length) { window.alert('No previous versions yet.'); return; }
    const pick = window.prompt(
      `${versions.length} version(s):\n` +
      versions.map((v, i) => `${i + 1}. ${new Date(v.created_at).toLocaleString()} — ${v.source || 'edit'}${v.author_email ? ` by ${v.author_email}` : ''}`).join('\n') +
      '\n\nEnter a number to restore, or cancel:'
    );
    const idx = parseInt(pick, 10) - 1;
    if (Number.isInteger(idx) && versions[idx]) {
      await act(() => api.restoreAsset(item.table, item.id, versions[idx].id), item.id);
    }
  }

  return (
    <div className="library-page">
      <h1>Library</h1>
      <p className="muted">Review every asset with its campaign, brief version, generation source, status and edit history.</p>

      <div className="library-filters">
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          placeholder="Search titles and copy"
          aria-label="Search titles and copy"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <label className="consent" style={{ margin: 0 }}>
          <input type="checkbox" checked={filters.favourite === 'true'}
            onChange={(e) => setFilters({ ...filters, favourite: e.target.checked ? 'true' : '' })} />
          <span>Favourites</span>
        </label>
        <label className="consent" style={{ margin: 0 }}>
          <input type="checkbox" checked={filters.archived === 'true'}
            onChange={(e) => setFilters({ ...filters, archived: e.target.checked ? 'true' : '' })} />
          <span>Archived</span>
        </label>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="Platform…" value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })} style={{ maxWidth: 120 }} />
        <input placeholder="Language…" value={filters.language} onChange={(e) => setFilters({ ...filters, language: e.target.value })} style={{ maxWidth: 120 }} />
        <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
        {selItems.length > 0 && (
          <>
            <button className="btn-secondary" onClick={bulkArchive}>
              {filters.archived ? 'Unarchive' : 'Archive'} {selItems.length}
            </button>
            <button className="btn-secondary" onClick={bulkDelete}>Delete {selItems.length}</button>
          </>
        )}
      </div>

      {error && <p className="login-err">{error}</p>}
      {!data && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && <p className="muted">No assets match these filters.</p>}

      {(data?.items || []).map((item) => (
        <div className="library-row" key={`${item.table}:${item.id}`}>
          <input type="checkbox" checked={!!selected[`${item.table}:${item.id}`]} onChange={() => toggleSel(item)} />
          <div className="library-main">
            <div className="library-title">
              <button className="library-star" onClick={() => act(() => api.updateAsset(item.table, item.id, { favourite: !item.favourite }), item.id)} title="Favourite">
                {item.favourite ? '★' : '☆'}
              </button>
              <strong>{item.title}</strong>
              <span className="campaign-badge">{item.type_label}</span>
              <span className="campaign-badge">{statusLabel(item)}</span>
            </div>
            {provenanceLine(item) && <div className="library-provenance">{provenanceLine(item)}</div>}
            <div className="library-snippet">{item.snippet}</div>
            <div className="library-actions">
              <select defaultValue="" disabled={busyId === item.id} onChange={(e) => { if (e.target.value) { rewrite(item, e.target.value); e.target.value = ''; } }}>
                <option value="" disabled>{busyId === item.id ? 'Working…' : 'AI rewrite (1 action)'}</option>
                {REWRITES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={() => {
                const name = window.prompt('Rename:', item.title);
                if (name !== null) act(() => api.updateAsset(item.table, item.id, { title: name }), item.id);
              }}>Rename</button>
              <button onClick={() => act(() => api.duplicateAsset(item.table, item.id), item.id)}>Duplicate</button>
              <button onClick={() => showVersions(item)}>History</button>
              <select defaultValue="" onChange={(e) => { if (e.target.value) { exportItem(item, e.target.value); e.target.value = ''; } }}>
                <option value="" disabled>Export…</option>
                <option value="txt">Plain text (.txt)</option>
                <option value="md">Markdown (.md)</option>
                <option value="doc">Word-compatible file (.doc)</option>
              </select>
              <button onClick={() => act(() => api.updateAsset(item.table, item.id, { archived: !item.archived }), item.id)}>
                {item.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button onClick={() => {
                if (window.confirm('Delete this asset? A snapshot is kept in history.')) {
                  act(() => api.deleteAsset(item.table, item.id), item.id);
                }
              }}>Delete</button>
            </div>
          </div>
        </div>
      ))}

      {data && data.total > data.per && (
        <div className="library-pager">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}>← Prev</button>
          <span className="muted"> Page {page} of {Math.ceil(data.total / data.per)} </span>
          <button className="btn-secondary" disabled={page >= Math.ceil(data.total / data.per)} onClick={() => { setPage(page + 1); load(page + 1); }}>Next →</button>
        </div>
      )}
    </div>
  );
}
