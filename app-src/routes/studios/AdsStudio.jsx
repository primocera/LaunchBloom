import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CopyBtn, NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 21: the Ads Starter Kit Studio. ad_ideas grouped into the spec's
// sections (Meta ad hooks, static concepts, video concepts, UGC brief), each
// card with all fields, copy/edit/mark-for-testing actions, and the
// small-budget testing plan card (generic guidance, not financial advice).
// ---------------------------------------------------------------------------

const SECTIONS = [
  ['hook', 'Meta ad hooks'],
  ['static', 'Static ad concepts'],
  ['video', 'Video ad concepts'],
  ['ugc', 'UGC brief'],
];

// Prompt 21's testing plan card, generic guidance per the spec.
const TESTING_PLAN = [
  ['What to test first', 'Run your 2-3 strongest hooks against the same audience before testing visuals — the hook decides whether anything else gets seen.'],
  ['Suggested budget range', 'A small daily budget (roughly the price of a coffee or two per ad) is enough to compare hooks. This is generic guidance, not financial advice.'],
  ['When to stop a weak ad', 'If an ad has clearly worse click-through than its siblings after a few hundred impressions, pause it — do not wait for it to turn around.'],
  ['What signal to watch', 'Click-through rate first (did the hook work?), then landing page actions (did the promise hold?). Ignore likes.'],
];

const EDIT_FIELDS = ['hook', 'headline', 'primary_text', 'visual_direction', 'cta'];

export default function AdsStudio() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  function load() {
    if (!kitId) return;
    api.items('ad_ideas', kitId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'ads_kit', load);

  async function patch(item, updates) {
    try {
      const r = await api.updateItem('ad_ideas', item.id, updates);
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const err = error || kitsError || regenError;
  const grouped = (type) => (items || []).filter((i) => (i.ad_type || '').toLowerCase().includes(type));
  const ungrouped = (items || []).filter((i) => !SECTIONS.some(([t]) => (i.ad_type || '').toLowerCase().includes(t)));

  function AdCard({ i }) {
    return editing === i.id ? (
      <div className="kit-item is-edit" key={i.id}>
        <div style={{ flex: 1 }}>
          {EDIT_FIELDS.map((f) => (
            <label className="flow-field" key={f} style={{ margin: '6px 0' }}>
              <span>{f.replace(/_/g, ' ')}</span>
              <input value={draft[f] ?? i[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
            </label>
          ))}
          <div className="flow-row">
            <button className="kit-copy" onClick={() => patch(i, draft)}>Save</button>
            <button className="kit-copy" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </div>
    ) : (
      <div className={`kit-item ${i.status === 'selected' ? 'is-ready' : ''}`} key={i.id}>
        <span className="kit-badge">{i.ad_type}</span>
        <div style={{ flex: 1 }}>
          <div className="kit-item-title">{i.headline || i.hook}</div>
          <div className="flow-muted">Hook: {i.hook}</div>
          <div className="flow-muted">{i.primary_text}</div>
          {i.visual_direction && <div className="flow-muted">Visual: {i.visual_direction}</div>}
          {i.cta && <div className="kit-item-cta">CTA: {i.cta}</div>}
          {i.status === 'selected' && <div className="kit-item-meta">Selected for testing</div>}
        </div>
        <div className="studio-item-actions">
          <CopyBtn text={i.hook || ''} label="Copy hook" />
          <CopyBtn text={i.primary_text || ''} label="Copy primary text" />
          <CopyBtn text={i.visual_direction || ''} label="Copy visual direction" />
          <button className="kit-copy" onClick={() => patch(i, { status: i.status === 'selected' ? 'draft' : 'selected' })}>
            {i.status === 'selected' ? 'Unselect' : 'Select for testing'}
          </button>
          <button className="kit-copy" onClick={() => { setEditing(i.id); setDraft({}); }}>Edit</button>
        </div>
      </div>
    );
  }

  return (
    <StudioShell
      title="Ads Starter Kit"
      blurb="Meta ad hooks, static and video concepts, and a UGC brief — pick what to test first."
      kits={kits}
      kitId={kitId}
      onSelectKit={setKitId}
    >
      {err && <p className="flow-err">{err}</p>}
      {kits && !kits.length && <NoKit />}
      {kits && kits.length > 0 && !items && !err && <p className="flow-muted">Loading…</p>}

      {items && (
        <>
          <div className="flow-card studio-toolbar">
            <span className="flow-muted">{items.filter((i) => i.status === 'selected').length} selected for testing</span>
            <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
              {regenBusy ? 'Regenerating…' : 'Regenerate ads section'}
            </button>
          </div>

          {SECTIONS.map(([type, label]) => {
            const group = grouped(type);
            if (!group.length) return null;
            return (
              <div className="flow-card" key={type}>
                <h3>{label}</h3>
                <div className="kit-items">{group.map((i) => <AdCard i={i} key={i.id} />)}</div>
              </div>
            );
          })}
          {ungrouped.length > 0 && (
            <div className="flow-card">
              <h3>Other ideas</h3>
              <div className="kit-items">{ungrouped.map((i) => <AdCard i={i} key={i.id} />)}</div>
            </div>
          )}

          <div className="flow-card">
            <h3>Small-budget testing plan</h3>
            {TESTING_PLAN.map(([k, v]) => (
              <div key={k}>
                <div className="flow-k">{k}</div>
                <p className="flow-muted">{v}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </StudioShell>
  );
}
