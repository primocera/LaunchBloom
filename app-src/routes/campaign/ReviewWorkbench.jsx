import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { STUDIO_BY_TABLE } from './shared';

// ---------------------------------------------------------------------------
// v9 SC-04: one Review workbench that unifies the v8 control tools (consistency
// findings, brief-change/stale assets, Needs-review assets and evidence
// reminders) into a single review sequence — grouped by issue type, not by
// database table. It reuses the existing /review payload and the existing
// resolution endpoints (ack finding, keep snapshot, asset status, evidence);
// it never runs AI, never bulk-acknowledges, and never hides unresolved items
// from the handoff. Severity communicates HANDOFF risk, not legal judgment.
// ---------------------------------------------------------------------------

const FILTERS = [
  ['blocking', 'Blocking'],
  ['decision', 'Needs decision'],
  ['evidence', 'Evidence/research'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
];

const GROUP_LABEL = {
  conflict: 'Conflict detected',
  brief_change: 'Brief changed',
  needs_review: 'Needs review',
  evidence: 'Evidence needed',
};

const IMPACT_LABEL = { hard: 'Hard blocker', reminder: 'Disclosed reminder', external: 'External work' };

const ACK_NOTE_OPTIONS = [
  ['intentional', 'Intentional — keep as is'],
  ['reviewed_ok', 'Reviewed — looks correct'],
  ['external_check_pending', 'Waiting on an external check'],
  ['other', 'Other reason'],
];

const DETECTION_LIMITS =
  'These checks compare structured fields across your assets and the brief. They do not verify facts, ' +
  'prices, claims, links or external platform/legal policies — that review stays with you.';

const today = () => new Date().toISOString().slice(0, 10);

// Flatten the /review payload into one ordered, issue-typed item list.
function toItems(q) {
  if (!q) return [];
  const items = [];

  for (const f of q.findings || []) {
    const acknowledged = f.status === 'acknowledged';
    const high = f.severity === 'high';
    items.push({
      key: `finding:${f.fingerprint}`,
      kind: 'finding', group: 'conflict',
      bucket: acknowledged ? 'resolved' : high ? 'blocking' : 'decision',
      exportImpact: high && !acknowledged ? 'hard' : 'reminder',
      severity: f.severity,
      title: (f.assets || []).map((a) => a.title).join(', ') || f.code.replace(/_/g, ' '),
      why: f.why,
      observed: f.observed, expected: f.expected, detection: f.detection, resolution: f.resolution,
      ackable: f.ackable, status: f.status,
      audit: acknowledged
        ? `Acknowledged by you${f.acknowledged_at ? ` · ${f.acknowledged_at.slice(0, 10)}` : ''}${f.note_category ? ` · ${f.note_category.replace(/_/g, ' ')}` : ''}`
        : null,
      raw: f,
    });
  }
  for (const a of q.stale || []) {
    items.push({
      key: `stale:${a.table}:${a.id}`,
      kind: 'stale', group: 'brief_change', bucket: 'decision', exportImpact: 'reminder',
      severity: null, title: a.title,
      why: 'This asset was generated before a brief change. Keep its snapshot on record or update it.',
      changed: a.changed, status: a.review_state, raw: a,
    });
  }
  for (const a of q.needs_review_assets || []) {
    items.push({
      key: `needs:${a.table}:${a.id}`,
      kind: 'needs_review', group: 'needs_review', bucket: 'decision', exportImpact: 'reminder',
      severity: null, title: a.title,
      why: 'You edited this asset since it was generated. Confirm it is ready or keep reviewing it.',
      status: 'edited', raw: a,
    });
  }
  for (const e of q.evidence_reminders || []) {
    items.push({
      key: `evidence:${e.id}`,
      kind: 'evidence', group: 'evidence', bucket: 'evidence', exportImpact: 'external',
      severity: null, title: e.label,
      why: `Evidence past its review-by date${e.review_by_date ? ` (${e.review_by_date})` : ''}. Recheck before relying on it.`,
      status: 'reminder', raw: e,
    });
  }
  return items;
}

export function ReviewWorkbench({ campaign }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('blocking');
  const [focus, setFocus] = useState(0);
  const [openKey, setOpenKey] = useState(null);
  const listRef = useRef(null);

  const load = useCallback(async (preserveFocus = false) => {
    setError(null);
    try {
      const { review: r } = await api.campaignReview(campaign.id);
      setReview(r);
      if (!preserveFocus) setFocus(0);
    } catch (err) { setError(err.message); }
  }, [campaign.id]);

  useEffect(() => { load(); }, [load]);

  const allItems = useMemo(() => toItems(review), [review]);
  const items = useMemo(
    () => (filter === 'all' ? allItems : allItems.filter((i) => i.bucket === filter)),
    [allItems, filter],
  );

  // Counts per filter — the same numbers Overview and Handoff derive.
  const counts = useMemo(() => {
    const c = { blocking: 0, decision: 0, evidence: 0, resolved: 0, all: allItems.length };
    for (const i of allItems) c[i.bucket] = (c[i.bucket] || 0) + 1;
    return c;
  }, [allItems]);

  useEffect(() => { if (focus >= items.length) setFocus(Math.max(0, items.length - 1)); }, [items.length, focus]);

  function openItem(idx) {
    const it = items[idx];
    if (!it) return;
    setFocus(idx);
    setOpenKey(it.key);
    api.trackEvent('review_item_opened', {
      group: it.group, severity: it.severity || 'none', bucket: it.bucket, kind: it.kind,
    });
  }

  function onKeyDown(e) {
    if (['ArrowDown', 'j'].includes(e.key)) { e.preventDefault(); setFocus((f) => Math.min(items.length - 1, f + 1)); }
    else if (['ArrowUp', 'k'].includes(e.key)) { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); openItem(focus); }
    else if (e.key === 'Escape') { setOpenKey(null); }
  }

  // After any resolution: recompute, keep the filter, advance to the next item.
  async function afterResolve(resolvedCategory, item) {
    api.trackEvent('review_item_resolved', {
      group: item.group, severity: item.severity || 'none', kind: item.kind, resolution: resolvedCategory,
    });
    setOpenKey(null);
    await load(true);
  }

  const open = items.find((i) => i.key === openKey) || null;

  return (
    <div className="review-workbench">
      <div className="brand-head" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Review</h3>
        <button className="account-link" onClick={() => load(true)}>Recheck · free</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        One place to resolve every campaign risk before handoff. Recomputed on demand — reviewing never uses an AI action.
        Severity is handoff risk, not a legal judgment.
      </p>

      {error && <p className="login-err">{error}</p>}

      {/* Filters double as safe navigation — they never mutate anything. */}
      <div className="review-filters" role="tablist" aria-label="Review filters">
        {FILTERS.map(([key, label]) => (
          <button
            key={key} role="tab" aria-selected={filter === key}
            className={`gen-chip${filter === key ? ' is-active' : ''}`}
            onClick={() => { setFilter(key); setFocus(0); }}
          >
            {label}{counts[key] ? ` · ${counts[key]}` : ''}
          </button>
        ))}
      </div>

      {/* Export-impact summary — mirrors what the manifest discloses. */}
      <p className="muted review-impact-summary">
        Export impact: {counts.blocking} hard blocker{counts.blocking === 1 ? '' : 's'} ·{' '}
        {counts.decision} disclosed reminder{counts.decision === 1 ? '' : 's'} · {counts.evidence} external.
        Unresolved items are always disclosed in the handoff — nothing is hidden.
      </p>

      {review === null && <p className="muted">Building the review queue…</p>}

      {review && items.length === 0 && (
        <div className="account-section">
          <p style={{ margin: 0 }}>No open items in this view.</p>
          <p className="muted" style={{ marginBottom: 0 }}>{DETECTION_LIMITS}</p>
        </div>
      )}

      {items.length > 0 && (
        <div
          className="review-list" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}
          role="listbox" aria-label="Review items" aria-activedescendant={items[focus]?.key}
        >
          {items.map((it, idx) => (
            <div
              id={it.key} key={it.key} role="option" aria-selected={idx === focus}
              className={`review-item is-${it.exportImpact}${idx === focus ? ' is-focus' : ''}`}
              onClick={() => openItem(idx)}
            >
              <div className="review-item-head">
                <span className="review-group">{GROUP_LABEL[it.group]}</span>
                <span className={`review-impact impact-${it.exportImpact}`}>{IMPACT_LABEL[it.exportImpact]}</span>
                {it.severity && <span className="muted"> · {it.severity}</span>}
                {it.audit && <span className="muted"> · {it.audit}</span>}
              </div>
              <div className="review-item-title">{it.title}</div>
              <div className="review-item-why muted">{it.why}</div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="confirm-row" style={{ marginTop: 8 }}>
          <button className="btn-secondary" onClick={() => openItem(focus)}>Review next</button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            ↑/↓ or j/k to move · Enter to open · Esc to close
          </span>
        </div>
      )}

      {open && (
        <ItemDrawer
          item={open} campaign={campaign}
          onClose={() => setOpenKey(null)} onResolved={afterResolve} onError={setError}
        />
      )}
    </div>
  );
}

// The focused item's detail + the accepted resolution paths. Each factual
// acknowledgment or snapshot-keep stays an explicit, single decision.
function ItemDrawer({ item, campaign, onClose, onResolved, onError }) {
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const asset = item.raw && item.raw.table ? { table: item.raw.table, id: item.raw.id } : null;

  async function run(category, fn) {
    setBusy(true);
    try { await fn(); await onResolved(category, item); }
    catch (err) { onError(err.message); setBusy(false); }
  }

  return (
    <div className="account-section review-drawer" role="dialog" aria-label="Review item">
      <div className="brand-head" style={{ alignItems: 'baseline' }}>
        <strong>{GROUP_LABEL[item.group]} — {item.title}</strong>
        <button className="account-link" onClick={onClose}>Close</button>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>{item.why}</p>

      {/* Exact observed vs canonical where it is safe to show. */}
      {(item.observed || item.expected) && (
        <p className="muted">
          {item.expected ? <>Brief says: “{item.expected}”. </> : null}
          {item.observed ? <>Found: “{item.observed}”.</> : null}
        </p>
      )}
      {item.changed && (
        <ul className="muted">
          {item.changed.map((ch) => <li key={ch.field}><strong>{ch.label}:</strong> “{ch.old_value}” → “{ch.new_value}”</li>)}
        </ul>
      )}
      {item.detection && <p className="muted">Detection limit: {item.detection}. {item.resolution}</p>}

      {/* Accepted resolution paths per issue type. */}
      <div className="confirm-row">
        {item.kind === 'finding' && item.ackable && item.status !== 'acknowledged' && (
          <select defaultValue="" disabled={busy} aria-label="Acknowledge finding"
            onChange={(e) => e.target.value && run('finding_ack', () => api.ackConsistencyFinding(campaign.id, item.raw.fingerprint, e.target.value))}>
            <option value="" disabled>Acknowledged by you (kept on record)…</option>
            {ACK_NOTE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {item.kind === 'finding' && !item.ackable && item.status !== 'acknowledged' && (
          <span className="muted">This needs a fix, not an acknowledgment — open the asset to correct it.</span>
        )}
        {item.kind === 'finding' && item.status === 'acknowledged' && (
          <span className="muted">Acknowledged by you — it stays on the handoff record.</span>
        )}

        {item.kind === 'stale' && item.status !== 'snapshot_kept' && (
          <button className="btn-secondary" disabled={busy}
            title="Keeps the asset as generated. Recorded with your email and time; a further brief change reopens this."
            onClick={() => run('keep_snapshot', () => api.keepAssetSnapshot(campaign.id, item.raw.table, item.raw.id))}>
            Keep snapshot
          </button>
        )}

        {item.kind === 'needs_review' && (
          <button className="btn-secondary" disabled={busy}
            title="Sets this asset's status to Ready to export. This is your decision, not an automated approval."
            onClick={() => run('marked_ready', () => api.updateAsset(item.raw.table, item.raw.id, { status: 'ready' }))}>
            Mark Ready to export
          </button>
        )}

        {item.kind === 'evidence' && (
          <button className="btn-secondary" disabled={busy}
            title="Records that you rechecked this evidence today and clears the past-due reminder. It does not verify the source."
            onClick={() => run('evidence_rechecked', () => api.updateEvidence(item.raw.id, { checked_date: today(), review_by_date: null }))}>
            I rechecked it today
          </button>
        )}

        {/* Regenerate / edit surfaces for asset-bound items. */}
        {asset && (
          <>
            <a className="btn-secondary" href="/app/assets">Open in Library</a>
            {STUDIO_BY_TABLE[asset.table] && (
              <a className="btn-secondary" href={`${STUDIO_BY_TABLE[asset.table]}?campaign=${campaign.id}`}
                title="Regenerating creates a new version and uses 1 AI action only on success.">
                Open studio to regenerate
              </a>
            )}
          </>
        )}

        <button className="account-link" onClick={() => setShowEvidence((s) => !s)}>
          {showEvidence ? 'Hide evidence' : 'Add & link evidence'}
        </button>
      </div>

      {showEvidence && (
        <EvidenceForm campaign={campaign} asset={asset} busy={busy}
          onSaved={() => onResolved('evidence_linked', item)} onError={onError} />
      )}
    </div>
  );
}

const EVIDENCE_TYPES = ['review', 'testimonial', 'statistic', 'certification', 'press', 'internal_data', 'other'];

// Create evidence and optionally link it to the item's asset. We never fetch or
// assert the source is true — we record the permitted claim, source and date.
function EvidenceForm({ campaign, asset, onSaved, onError }) {
  const [ev, setEv] = useState({ type: 'review', label: '', source_url: '', checked_date: today(), permitted_claim: '' });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { evidence } = await api.addEvidence({ ...ev, campaign_id: campaign.id });
      if (asset) await api.linkEvidence(evidence.id, asset.table, asset.id);
      onSaved();
    } catch (err) { onError(err.message); setSaving(false); }
  }

  return (
    <form onSubmit={save} className="account-section" style={{ padding: 10, marginTop: 8 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Record real proof once, reuse it across assets. This does not verify the source — it records the permitted claim,
        where it came from and when you checked it.
      </p>
      <div className="brand-field">
        <label>Type</label>
        <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })}>
          {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </div>
      <div className="brand-field">
        <label>Label</label>
        <input value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} placeholder='e.g. "Trustpilot 4.8 rating"' required />
      </div>
      <div className="brand-field">
        <label>Source URL</label>
        <input value={ev.source_url} onChange={(e) => setEv({ ...ev, source_url: e.target.value })} placeholder="https://…" />
      </div>
      <div className="brand-field">
        <label>Date you checked it</label>
        <input type="date" value={ev.checked_date} onChange={(e) => setEv({ ...ev, checked_date: e.target.value })} required />
      </div>
      <div className="brand-field">
        <label>Permitted claim</label>
        <input value={ev.permitted_claim} onChange={(e) => setEv({ ...ev, permitted_claim: e.target.value })} placeholder="The exact claim this evidence supports" />
      </div>
      {asset && <p className="muted">Will link to this asset once saved.</p>}
      <div className="confirm-row">
        <button className="btn-secondary" type="submit" disabled={saving || !ev.label.trim()}>Save evidence</button>
      </div>
    </form>
  );
}
