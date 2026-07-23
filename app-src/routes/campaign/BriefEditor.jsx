import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CHANNELS, TEMPLATES, missingDecisions, hasNoDates } from './shared';

// ---------------------------------------------------------------------------
// v9 SC-03: guided Campaign Brief editor. Four compact groups with progressive
// disclosure, an always-visible summary + missing-decisions list, debounced
// server autosave with optimistic-concurrency conflict recovery, and honest
// approval-inheritance disclosure. Editing never spends an AI action and never
// approves — approval stays an explicit decision in the parent Brief section.
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    key: 'goal', title: 'Goal & audience',
    fields: [
      ['objective', 'Objective', 'What is this campaign trying to achieve?', 'input'],
      ['audience', 'Audience', 'Who exactly is it for?', 'input'],
    ],
  },
  {
    key: 'offer', title: 'Offer & terms',
    fields: [
      ['offer_summary', 'Offer', 'What exactly is offered? (product, bundle, discount)', 'textarea'],
      ['promo_terms', 'Promo terms', 'e.g. "20% off with code SUMMER20, ends July 31"', 'input'],
    ],
  },
  {
    key: 'message', title: 'Message & CTA',
    fields: [
      ['key_message', 'Key message', 'The one thing every asset should say', 'input'],
    ],
  },
  {
    key: 'proof', title: 'Proof & restrictions',
    fields: [
      ['proof', 'Proof', 'Real evidence you are permitted to use (reviews, numbers, results)', 'input'],
      ['restrictions', 'Restrictions', 'What claim must not be made? Compliance rules?', 'input'],
    ],
  },
];

const TEMPLATE_TARGET_FIELDS = ['objective', 'channels'];

export default function BriefEditor({ campaign, onSaved }) {
  const [form, setForm] = useState(() => ({ ...campaign }));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(campaign.updated_at);
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error | conflict
  const [error, setError] = useState(null);
  const [openGroups, setOpenGroups] = useState(() => new Set(['goal']));
  const timer = useRef(null);
  const savedSections = useRef(new Set());

  // Re-sync when the parent reloads the campaign (e.g. after approve/reopen).
  useEffect(() => {
    setForm({ ...campaign });
    setExpectedUpdatedAt(campaign.updated_at);
  }, [campaign.id, campaign.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = missingDecisions(form);

  function scheduleSave(next) {
    if (timer.current) clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(() => save(next), 800);
  }

  async function save(next) {
    setError(null);
    try {
      const { campaign: updated } = await api.updateCampaign(campaign.id, {
        ...pickBrief(next), expected_updated_at: expectedUpdatedAt,
      });
      setExpectedUpdatedAt(updated.updated_at);
      setStatus('saved');
      // Fire brief_section_completed once per group that is now fully filled.
      for (const g of GROUPS) {
        if (savedSections.current.has(g.key)) continue;
        if (g.fields.every(([f]) => (updated[f] || '').trim())) {
          savedSections.current.add(g.key);
          api.trackEvent('brief_section_completed', { section: g.key });
        }
      }
      if (onSaved) onSaved(updated);
    } catch (err) {
      if (err.code === 'STALE') { setStatus('conflict'); setError(err.message); }
      else { setStatus('error'); setError(err.message); }
    }
  }

  function update(field, value) {
    const next = { ...form, [field]: value };
    setForm(next);
    scheduleSave(next);
  }

  function reloadLatest() {
    api.campaign(campaign.id).then(({ campaign: fresh }) => {
      setForm({ ...fresh });
      setExpectedUpdatedAt(fresh.updated_at);
      setStatus('idle'); setError(null);
      if (onSaved) onSaved(fresh);
    }).catch((e) => setError(e.message));
  }

  function applyTemplate(t) {
    const clashes = TEMPLATE_TARGET_FIELDS.filter((f) =>
      f === 'channels' ? (form.channels || []).length : (form[f] || '').trim());
    if (clashes.length && !window.confirm(
      `Replace your current ${clashes.join(' and ')} with the “${t.label}” template values? Other fields are kept.`
    )) return;
    const next = { ...form, ...t.brief };
    setForm(next);
    scheduleSave(next);
  }

  function toggleGroup(key) {
    setOpenGroups((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  const savingLabel = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed', conflict: 'Conflict' }[status];

  return (
    <div className="brief-editor">
      {/* Always-visible summary + what still blocks a complete brief. */}
      <div className="account-section brief-summary">
        <div className="brand-head" style={{ alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Brief</h2>
          <span className={`brief-save-state is-${status}`} role="status" aria-live="polite">{savingLabel}</span>
        </div>
        {missing.length === 0
          ? <p className="muted" style={{ marginTop: 4 }}>All required decisions are in. Editing is free and never approves the brief — approval stays an explicit step.</p>
          : <p className="muted" style={{ marginTop: 4 }}>Still needed: {missing.map(([, l]) => l).join(', ')}. Editing is free and never spends an AI action.</p>}
        {campaign.brief_approved && (
          <p className="muted">
            This brief is approved. Saved changes apply to <strong>new</strong> generations only — assets you already
            generated keep the snapshot they were created from. Use Review to see which assets a change affects.
          </p>
        )}
        {hasNoDates(form) && (
          <p className="muted">No dates set — urgency or deadline language will not be generated. Dates are optional.</p>
        )}
      </div>

      {status === 'conflict' && (
        <div className="account-section brief-conflict" role="alert">
          <p style={{ marginTop: 0 }}>{error}</p>
          <button className="btn-secondary" onClick={reloadLatest}>Reload the latest version</button>
        </div>
      )}
      {status === 'error' && error && <p className="login-err">{error}</p>}

      {/* Template chips — field-level preview, explicit Replace confirmation. */}
      <div className="brand-field">
        <label>Start from a template (optional)</label>
        <div className="campaign-channels">
          {TEMPLATES.map((t) => (
            <button type="button" key={t.key} className="gen-chip" onClick={() => applyTemplate(t)}
              title={`Sets objective “${t.brief.objective}” and channels ${t.brief.channels.join(', ')}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Four progressive-disclosure groups; all fields stay reachable. */}
      {GROUPS.map((g) => {
        const open = openGroups.has(g.key);
        const filled = g.fields.filter(([f]) => (form[f] || '').trim()).length;
        return (
          <div className="account-section brief-group" key={g.key}>
            <button type="button" className="brief-group-head" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
              <strong>{g.title}</strong>
              <span className="muted">{filled}/{g.fields.length} filled {open ? '▾' : '▸'}</span>
            </button>
            {open && g.fields.map(([f, label, ph, kind]) => (
              <div className="brand-field" key={f}>
                <label>{label}</label>
                {kind === 'textarea'
                  ? <textarea rows={2} value={form[f] || ''} placeholder={ph} onChange={(e) => update(f, e.target.value)} />
                  : <input value={form[f] || ''} placeholder={ph} onChange={(e) => update(f, e.target.value)} />}
              </div>
            ))}
          </div>
        );
      })}

      {/* Dates + channels live under Offer once expanded; kept compact here. */}
      <div className="account-section brief-group">
        <div className="brand-field campaign-dates">
          <label>Markets / language</label>
          <input value={form.markets || ''} placeholder="e.g. US" onChange={(e) => update('markets', e.target.value)} />
          <input value={form.language || ''} placeholder="e.g. English" onChange={(e) => update('language', e.target.value)} />
        </div>
        <div className="brand-field campaign-dates">
          <label>Dates (optional)</label>
          <input type="date" value={form.start_date || ''} onChange={(e) => update('start_date', e.target.value)} />
          <span> → </span>
          <input type="date" value={form.end_date || ''} onChange={(e) => update('end_date', e.target.value)} />
        </div>
        <div className="brand-field campaign-dates">
          <label>Real deadline (optional)</label>
          <input type="date" value={form.deadline || ''} onChange={(e) => update('deadline', e.target.value)} />
        </div>
        <div className="brand-field">
          <label>Channels</label>
          <div className="campaign-channels">
            {CHANNELS.map((ch) => (
              <label key={ch} className="consent" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={(form.channels || []).includes(ch)}
                  onChange={(e) => update('channels', e.target.checked
                    ? [...(form.channels || []), ch]
                    : (form.channels || []).filter((x) => x !== ch))}
                />
                <span>{ch}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Only send real brief fields to the server (never the derived/relational ones).
const BRIEF_KEYS = ['name', 'objective', 'audience', 'offer_summary', 'promo_terms', 'key_message',
  'proof', 'restrictions', 'markets', 'language', 'start_date', 'end_date', 'deadline', 'channels'];
function pickBrief(obj) {
  const out = {};
  for (const k of BRIEF_KEYS) if (k in obj) out[k] = obj[k];
  return out;
}
