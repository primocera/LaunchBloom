import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { CopyBtn, NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 19: the Content Plan Studio. content_items for the current kit with
// a calendar/list toggle, platform + content-type + status filters, per-item
// actions (copy hook, copy caption angle, done, skipped, edit) and the
// content mix summary. Content stays tied to the selected offer because the
// items are generated from it and only regenerated through the kit.
// ---------------------------------------------------------------------------

const STATUSES = ['planned', 'done', 'skipped'];

// Prompt 19's content mix buckets, counted from goal/content_type keywords.
const MIX = [
  ['Educational', /educat|teach|how|tip|value/i],
  ['Problem awareness', /problem|pain|aware|myth|mistake/i],
  ['Proof', /proof|result|testimonial|case|story/i],
  ['Offer / sales', /offer|sale|sell|launch|buy|promo/i],
  ['Objections', /objection|doubt|faq|but/i],
];

export default function ContentStudio() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [items, setItems] = useState(null);
  const [view, setView] = useState('list'); // list | calendar
  const [fPlatform, setFPlatform] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [editing, setEditing] = useState(null); // item id being edited
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  function load() {
    if (!kitId) return;
    api.items('content_items', kitId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'content_plan', load);

  async function setStatus(item, status) {
    try {
      const r = await api.updateItem('content_items', item.id, { status });
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveEdit(item) {
    try {
      const r = await api.updateItem('content_items', item.id, draft);
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const platforms = useMemo(() => [...new Set((items || []).map((i) => i.platform).filter(Boolean))], [items]);
  const types = useMemo(() => [...new Set((items || []).map((i) => i.content_type).filter(Boolean))], [items]);

  const visible = (items || []).filter(
    (i) =>
      (!fPlatform || i.platform === fPlatform) &&
      (!fType || i.content_type === fType) &&
      (!fStatus || i.status === fStatus)
  );

  const mix = MIX.map(([label, re]) => [
    label,
    (items || []).filter((i) => re.test(`${i.goal || ''} ${i.content_type || ''}`)).length,
  ]);

  const err = error || kitsError || regenError;

  return (
    <StudioShell
      title="Content Plan Studio"
      blurb="Your content plan — filter, mark done or skipped, and keep every post tied to your offer."
      kits={kits}
      kitId={kitId}
      onSelectKit={setKitId}
    >
      {err && <p className="flow-err">{err}</p>}
      {kits && !kits.length && <NoKit />}
      {kits && kits.length > 0 && !items && !err && <p className="flow-muted">Loading…</p>}

      {items && (
        <>
          {/* toolbar: view toggle + filters + regenerate */}
          <div className="flow-card studio-toolbar">
            <div className="flow-row" style={{ marginTop: 0 }}>
              <button className={view === 'list' ? 'kit-tab is-on' : 'kit-tab'} onClick={() => setView('list')}>List</button>
              <button className={view === 'calendar' ? 'kit-tab is-on' : 'kit-tab'} onClick={() => setView('calendar')}>Calendar</button>
            </div>
            <div className="flow-row" style={{ marginTop: 0 }}>
              <select className="studio-select" value={fPlatform} onChange={(e) => setFPlatform(e.target.value)}>
                <option value="">All platforms</option>
                {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="studio-select" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="">All types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="studio-select" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
                {regenBusy ? 'Regenerating…' : 'Regenerate full content plan'}
              </button>
            </div>
          </div>

          {/* content mix summary */}
          <div className="flow-card">
            <div className="flow-k" style={{ marginTop: 0 }}>Content mix</div>
            <div className="studio-mix">
              {mix.map(([label, n]) => (
                <span className="kit-badge" key={label}>{label}: {n}</span>
              ))}
            </div>
          </div>

          {/* calendar view */}
          {view === 'calendar' && (
            <div className="studio-calendar">
              {visible.map((i) => (
                <button
                  key={i.id}
                  className={`cal-day is-${i.status}`}
                  title={`${i.topic || ''} — ${i.platform || ''}`}
                  onClick={() => setView('list')}
                >
                  <span className="cal-num">{i.day_number}</span>
                  <span className="cal-topic">{i.topic}</span>
                </button>
              ))}
            </div>
          )}

          {/* list view */}
          {view === 'list' && (
            <div className="kit-items">
              {visible.map((i) =>
                editing === i.id ? (
                  <div className="kit-item is-edit" key={i.id}>
                    <span className="kit-badge">Day {i.day_number}</span>
                    <div style={{ flex: 1 }}>
                      {['topic', 'hook', 'caption_angle', 'cta', 'goal', 'platform', 'content_type'].map((f) => (
                        <label className="flow-field" key={f} style={{ margin: '6px 0' }}>
                          <span>{f.replace(/_/g, ' ')}</span>
                          <input value={draft[f] ?? i[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                        </label>
                      ))}
                      <div className="flow-row">
                        <button className="kit-copy" onClick={() => saveEdit(i)}>Save</button>
                        <button className="kit-copy" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`kit-item is-${i.status}`} key={i.id}>
                    <span className="kit-badge">Day {i.day_number}</span>
                    <div style={{ flex: 1 }}>
                      <div className="kit-item-title">{i.topic}</div>
                      <div className="kit-item-meta">{[i.platform, i.content_type, i.status].filter(Boolean).join(' · ')}</div>
                      <div className="flow-muted">Hook: {i.hook}</div>
                      <div className="flow-muted">Angle: {i.caption_angle}</div>
                      {i.goal && <div className="flow-muted">Goal: {i.goal}</div>}
                      {i.cta && <div className="kit-item-cta">CTA: {i.cta}</div>}
                    </div>
                    <div className="studio-item-actions">
                      <CopyBtn text={i.hook || ''} label="Copy hook" />
                      <CopyBtn text={i.caption_angle || ''} label="Copy angle" />
                      <button className="kit-copy" onClick={() => setStatus(i, i.status === 'done' ? 'planned' : 'done')}>
                        {i.status === 'done' ? 'Undo done' : 'Done'}
                      </button>
                      <button className="kit-copy" onClick={() => setStatus(i, i.status === 'skipped' ? 'planned' : 'skipped')}>
                        {i.status === 'skipped' ? 'Unskip' : 'Skip'}
                      </button>
                      <button className="kit-copy" onClick={() => { setEditing(i.id); setDraft({}); }}>Edit</button>
                    </div>
                  </div>
                )
              )}
              {!visible.length && <p className="flow-muted">No posts match these filters.</p>}
            </div>
          )}
        </>
      )}
    </StudioShell>
  );
}
