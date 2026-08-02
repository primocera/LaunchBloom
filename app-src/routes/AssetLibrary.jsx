import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useRequestGuard } from '../lib/use-request-guard';
import { download, assetsCsv } from '../lib/export';
import { STATUS_LABEL } from '../lib/status-labels';
// v10 SC-02: one drawer, shared with the campaign Assets tab.
import AssetDrawer, { statusLabel, provenanceLine } from '../components/AssetDrawer';

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

const FILTER_KEYS = ['type', 'q', 'favourite', 'archived', 'status', 'platform', 'language', 'campaign_id'];
const FILTER_LABEL = {
  type: 'Type', q: 'Search', favourite: 'Favourites', archived: 'Archived',
  status: 'Status', platform: 'Platform', language: 'Language', campaign_id: 'Campaign',
};

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

  // v13 SC-P1-07: the query string IS the authoritative input, and it changes
  // without remounting the route. `query` is the serialized form so the loader
  // is keyed on the value, not on the (new-every-render) filters object; the
  // guard drops a slow page-1 response that lands after page 2 was requested.
  const query = searchParams.toString();
  const begin = useRequestGuard();
  const load = useCallback(() => {
    const isCurrent = begin();
    const sp = new URLSearchParams(query);
    const params = { page: Math.max(1, parseInt(sp.get('page'), 10) || 1), per: 25 };
    for (const k of FILTER_KEYS) if (sp.get(k)) params[k] = sp.get(k);
    setError(null);
    api.library(params)
      .then((d) => { if (isCurrent()) setData(d); })
      .catch((e) => { if (isCurrent()) setError(e.message); });
  }, [begin, query]);
  useEffect(() => { load(); }, [load]);

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
