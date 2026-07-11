import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CopyBtn, NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 20: the Email Sequence Studio. Sequence timeline of the 7 emails
// with every field from the spec, copy actions (subject / preheader /
// outline / full sequence), edit, mark as ready, regenerate, and the email
// quality checklist.
// ---------------------------------------------------------------------------

const QUALITY_CHECKLIST = [
  'Does the sequence tell a story?',
  'Is the offer introduced clearly?',
  'Are objections handled?',
  'Is the CTA clear?',
  'Does it avoid spammy urgency?',
];

const EDIT_FIELDS = ['email_type', 'subject_line', 'preheader', 'main_angle', 'cta'];

function outlineText(item) {
  return (Array.isArray(item.body_outline) ? item.body_outline : []).map((x) => `- ${x}`).join('\n');
}

function emailText(item) {
  return [
    `Email ${item.sequence_order} (${item.email_type})`,
    `Subject: ${item.subject_line}`,
    `Preheader: ${item.preheader}`,
    `Angle: ${item.main_angle}`,
    'Outline:',
    outlineText(item),
    `CTA: ${item.cta}`,
  ].join('\n');
}

export default function EmailStudio() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  function load() {
    if (!kitId) return;
    api.items('email_items', kitId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'email_sequence', load);

  async function patch(item, updates) {
    try {
      const r = await api.updateItem('email_items', item.id, updates);
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const err = error || kitsError || regenError;

  return (
    <StudioShell
      title="Email Sequence Studio"
      blurb="Your 7-email launch sequence, in order — copy, edit and mark each one ready."
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
            <span className="flow-muted">{items.filter((i) => i.status === 'ready').length}/{items.length} marked ready</span>
            <div className="flow-row" style={{ marginTop: 0 }}>
              <CopyBtn text={() => items.map(emailText).join('\n\n---\n\n')} label="Copy full sequence" />
              <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
                {regenBusy ? 'Regenerating…' : 'Regenerate email sequence'}
              </button>
            </div>
          </div>

          <div className="email-timeline">
            {items.map((i) => (
              <div className={`flow-card email-card ${i.status === 'ready' ? 'is-ready' : ''}`} key={i.id}>
                <div className="kit-row-head">
                  <div>
                    <span className="kit-badge">Email {i.sequence_order}</span>{' '}
                    <span className="kit-item-meta">{i.email_type}{i.status === 'ready' ? ' · ready' : ''}</span>
                  </div>
                  <div className="studio-item-actions">
                    <CopyBtn text={i.subject_line || ''} label="Copy subject" />
                    <CopyBtn text={i.preheader || ''} label="Copy preheader" />
                    <CopyBtn text={outlineText(i)} label="Copy outline" />
                    <button className="kit-copy" onClick={() => patch(i, { status: i.status === 'ready' ? 'draft' : 'ready' })}>
                      {i.status === 'ready' ? 'Back to draft' : 'Mark as ready'}
                    </button>
                    <button className="kit-copy" onClick={() => { setEditing(i.id); setDraft({}); }}>Edit</button>
                  </div>
                </div>

                {editing === i.id ? (
                  <>
                    {EDIT_FIELDS.map((f) => (
                      <label className="flow-field" key={f} style={{ margin: '6px 0' }}>
                        <span>{f.replace(/_/g, ' ')}</span>
                        <input value={draft[f] ?? i[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                      </label>
                    ))}
                    <label className="flow-field" style={{ margin: '6px 0' }}>
                      <span>body outline (one point per line)</span>
                      <textarea
                        rows={4}
                        value={draft.body_outline_text ?? outlineText(i).replace(/^- /gm, '')}
                        onChange={(e) => setDraft({ ...draft, body_outline_text: e.target.value })}
                      />
                    </label>
                    <div className="flow-row">
                      <button
                        className="kit-copy"
                        onClick={() => {
                          const { body_outline_text, ...rest } = draft;
                          const updates = { ...rest };
                          if (body_outline_text != null) {
                            updates.body_outline = body_outline_text.split('\n').map((l) => l.trim()).filter(Boolean);
                          }
                          patch(i, updates);
                        }}
                      >
                        Save
                      </button>
                      <button className="kit-copy" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="kit-item-title">{i.subject_line}</div>
                    <div className="flow-muted">Preheader: {i.preheader}</div>
                    <div className="flow-muted">Angle: {i.main_angle}</div>
                    <ul className="kit-outline">
                      {(Array.isArray(i.body_outline) ? i.body_outline : []).map((x) => <li key={x}>{x}</li>)}
                    </ul>
                    {i.cta && <div className="kit-item-cta">CTA: {i.cta}</div>}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="flow-card">
            <h3>Email quality checklist</h3>
            <ul className="kit-checklist">
              {QUALITY_CHECKLIST.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </div>
        </>
      )}
    </StudioShell>
  );
}
