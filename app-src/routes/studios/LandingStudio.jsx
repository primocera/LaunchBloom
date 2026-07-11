import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CopyBtn, NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 18: the Landing Page Studio. Editor-style view of the selected
// kit's landing page copy: copy each section, copy the full page, edit text
// locally and save back to launch_kits.landing_page, regenerate only this
// section, plus the quality checklist card from the spec.
// ---------------------------------------------------------------------------

// [field, label, kind] — kind: text | list | faq
const SECTIONS = [
  ['headline', 'Hero headline', 'text'],
  ['subheadline', 'Hero subheadline', 'text'],
  ['primary_cta', 'Primary CTA', 'text'],
  ['problem_section', 'Problem section', 'text'],
  ['solution_section', 'Solution section', 'text'],
  ['benefits', 'Benefits', 'list'],
  ['whats_included', "What's included", 'list'],
  ['who_its_for', "Who it's for", 'list'],
  ['who_its_not_for', "Who it's not for", 'list'],
  ['how_it_works', 'How it works', 'list'],
  ['pricing_section', 'Pricing section', 'text'],
  ['faq', 'FAQ', 'faq'],
  ['final_cta_section', 'Final CTA section', 'text'],
];

// Prompt 18's quality checklist, verbatim.
const QUALITY_CHECKLIST = [
  'Is the audience clear?',
  'Is the offer clear?',
  'Is the CTA visible?',
  'Are benefits concrete?',
  'Are objections answered?',
];

function sectionToText(kind, value) {
  if (value == null) return '';
  if (kind === 'list') return (value || []).map((x) => `- ${x}`).join('\n');
  if (kind === 'faq') return (value || []).map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  return String(value);
}

function fullPageText(lp) {
  return SECTIONS
    .map(([field, label, kind]) => `${label.toUpperCase()}\n${sectionToText(kind, lp[field])}`)
    .join('\n\n');
}

export default function LandingStudio() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [lp, setLp] = useState(null);
  const [draft, setDraft] = useState(null); // local edits, per field as text
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!kitId) return;
    setLp(null);
    setDraft(null);
    api.launchKit(kitId)
      .then((r) => setLp(r.launch_kit.landing_page || {}))
      .catch((e) => setError(e.message));
  }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'landing_page', (data) => {
    setLp(data);
    setDraft(null);
  });

  function startEdit() {
    const d = {};
    for (const [field, , kind] of SECTIONS) d[field] = sectionToText(kind, lp[field]);
    setDraft(d);
  }

  /** Turn edited text back into the stored shape (lists split on lines). */
  function draftToData() {
    const out = { ...lp };
    for (const [field, , kind] of SECTIONS) {
      const t = draft[field] ?? '';
      if (kind === 'list') {
        out[field] = t.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
      } else if (kind === 'faq') {
        const blocks = t.split(/\n\s*\n/).filter((b) => b.trim());
        out[field] = blocks.map((b) => {
          const q = (b.match(/Q:\s*([\s\S]*?)(?=\nA:|$)/) || [])[1] || '';
          const a = (b.match(/A:\s*([\s\S]*)/) || [])[1] || '';
          return { question: q.trim(), answer: a.trim() };
        });
      } else {
        out[field] = t;
      }
    }
    return out;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = draftToData();
      await api.saveSection(kitId, 'landing_page', data);
      setLp(data);
      setDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const err = error || kitsError || regenError;

  return (
    <StudioShell
      title="Landing Page Studio"
      blurb="Your landing page copy, section by section — edit, copy, or regenerate."
      kits={kits}
      kitId={kitId}
      onSelectKit={setKitId}
    >
      {err && <p className="flow-err">{err}</p>}
      {kits && !kits.length && <NoKit />}
      {kits && kits.length > 0 && !lp && !err && <p className="flow-muted">Loading…</p>}

      {lp && (
        <>
          <div className="flow-card">
            <div className="kit-row-head">
              <h3>{draft ? 'Editing landing page' : 'Landing page copy'}</h3>
              <div className="flow-row" style={{ marginTop: 0 }}>
                <CopyBtn text={() => fullPageText(draft ? draftToData() : lp)} label="Copy full landing page" />
                {!draft ? (
                  <>
                    <button className="kit-copy" onClick={startEdit}>Edit</button>
                    <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
                      {regenBusy ? 'Regenerating…' : 'Regenerate landing page'}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="kit-copy" disabled={saving} onClick={save}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button className="kit-copy" onClick={() => setDraft(null)}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          </div>

          {SECTIONS.map(([field, label, kind]) => (
            <div className="flow-card" key={field}>
              <div className="kit-row-head">
                <div className="flow-k" style={{ margin: 0 }}>{label}</div>
                {!draft && <CopyBtn text={sectionToText(kind, lp[field])} />}
              </div>
              {draft ? (
                <textarea
                  className="studio-edit"
                  rows={kind === 'text' ? 3 : 6}
                  value={draft[field]}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                />
              ) : kind === 'list' ? (
                <ul className="kit-outline">{(lp[field] || []).map((x) => <li key={x}>{x}</li>)}</ul>
              ) : kind === 'faq' ? (
                (lp[field] || []).map((f) => (
                  <p key={f.question}><strong>{f.question}</strong><br />{f.answer}</p>
                ))
              ) : (
                <p>{lp[field] || <span className="flow-muted">Empty — regenerate or edit.</span>}</p>
              )}
            </div>
          ))}

          <div className="flow-card">
            <h3>Quality checklist</h3>
            <p className="flow-muted">Read your page top to bottom and check honestly:</p>
            <ul className="kit-checklist">
              {QUALITY_CHECKLIST.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </div>

          {lp.testimonial_placeholder_note && (
            <p className="flow-muted">{lp.testimonial_placeholder_note}</p>
          )}
        </>
      )}
    </StudioShell>
  );
}
