import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CopyBtn, NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 22: the SEO Starter Kit Studio. seo_items presented through the
// spec's sections (primary keywords, blog topics, SEO titles, meta
// descriptions, FAQ questions, next tasks), item actions (copy keyword /
// title / meta, mark as planned, edit), regenerate, and the guidance box.
// ---------------------------------------------------------------------------

const GUIDANCE =
  'SEO is a long-term channel. These are content ideas to research — not verified keyword data. Start with one landing page, one helpful blog post, and one FAQ section tied to the offer.';

// v5 Prompt 12: SEO output is ideation until a data provider is integrated.
const RESEARCH_CHECKLIST = [
  'Search the primary keyword in Google and read the top 10 results — match the dominant intent.',
  'Check Google autocomplete and "People also ask" for real related phrases.',
  'Use a keyword tool for volume and difficulty — record the source and date.',
  'Confirm you can create genuinely better content than what ranks now.',
  'Check the target page does not compete with an existing page for the same keyword.',
];

/** Client-side cannibalization check: same primary keyword used twice. */
function duplicateKeywords(items = []) {
  const seen = new Map();
  for (const i of items) {
    const k = String(i.keyword || '').trim().toLowerCase();
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

const EDIT_FIELDS = ['keyword', 'page_type', 'title', 'meta_description', 'content_angle', 'priority'];

export default function SeoStudio() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  function load() {
    if (!kitId) return;
    api.items('seo_items', kitId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'seo_kit', load);

  async function patch(item, updates) {
    try {
      const r = await api.updateItem('seo_items', item.id, updates);
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const err = error || kitsError || regenError;
  const all = items || [];
  const byPriority = [...all].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));
  const blogs = all.filter((i) => /blog|article|post/i.test(i.page_type || ''));
  const faqs = all.filter((i) => /faq|question/i.test(`${i.page_type} ${i.content_angle}`));
  const nextTasks = byPriority.slice(0, 3);

  function ItemRow({ i }) {
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
      <div className={`kit-item ${i.status === 'planned-next' ? 'is-ready' : ''}`} key={i.id}>
        <span className="kit-badge">{i.priority}</span>
        <div style={{ flex: 1 }}>
          <div className="kit-item-title">
            {i.keyword}{' '}
            <span className="seo-badge" title="This is an AI content idea, not researched keyword data.">Not researched</span>
          </div>
          <div className="kit-item-meta">
            {i.page_type}{i.search_intent ? ` · ${i.search_intent}` : ''}{i.topic_cluster ? ` · ${i.topic_cluster}` : ''}
          </div>
          <div className="flow-muted">Title: {i.title}</div>
          <div className="flow-muted">Meta: {i.meta_description}</div>
          {Array.isArray(i.secondary_keywords) && i.secondary_keywords.length > 0 && (
            <div className="flow-muted">Related ideas: {i.secondary_keywords.join(', ')}</div>
          )}
          {i.content_angle && <div className="flow-muted">Angle: {i.content_angle}</div>}
        </div>
        <div className="studio-item-actions">
          <CopyBtn text={i.keyword || ''} label="Copy keyword" />
          <CopyBtn text={i.title || ''} label="Copy title" />
          <CopyBtn text={i.meta_description || ''} label="Copy meta" />
          <button className="kit-copy" onClick={() => patch(i, { status: i.status === 'planned-next' ? 'planned' : 'planned-next' })}>
            {i.status === 'planned-next' ? 'Unplan' : 'Mark as planned'}
          </button>
          <button className="kit-copy" onClick={() => { setEditing(i.id); setDraft({}); }}>Edit</button>
        </div>
      </div>
    );
  }

  return (
    <StudioShell
      title="SEO content ideas"
      blurb="Practical SEO content ideas for your next pages and articles."
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
            <p className="flow-muted" style={{ margin: 0 }}>{GUIDANCE}</p>
            <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
              {regenBusy ? 'Regenerating…' : 'Regenerate SEO section'}
            </button>
          </div>

          {duplicateKeywords(all).length > 0 && (
            <div className="gen-warnings" role="alert">
              <strong>Possible keyword overlap</strong>
              <p style={{ margin: '4px 0 0' }}>
                These keywords are targeted more than once — split the intent or merge the pages to avoid
                cannibalization: {duplicateKeywords(all).join(', ')}.
              </p>
            </div>
          )}

          <div className="flow-card">
            <h3>Turn an idea into a researched keyword</h3>
            <p className="flow-muted" style={{ marginTop: 0 }}>
              We don't have a keyword-data provider connected, so every idea is marked <em>Not researched</em>.
              Use this checklist before you commit to a page:
            </p>
            <ul className="kit-checklist">
              {RESEARCH_CHECKLIST.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>

          <div className="flow-card">
            <h3>Primary keywords</h3>
            <div className="kit-items">{byPriority.map((i) => <ItemRow i={i} key={i.id} />)}</div>
          </div>

          {blogs.length > 0 && (
            <div className="flow-card">
              <h3>Blog topics</h3>
              <ul className="kit-outline">
                {blogs.map((i) => <li key={i.id}>{i.content_angle || i.title} <span className="flow-muted">({i.keyword})</span></li>)}
              </ul>
            </div>
          )}

          <div className="flow-card">
            <h3>Landing page SEO title options</h3>
            <ul className="kit-outline">
              {all.map((i) => (
                <li key={i.id}>
                  {i.title} <CopyBtn text={i.title || ''} />
                </li>
              ))}
            </ul>
          </div>

          <div className="flow-card">
            <h3>Meta descriptions</h3>
            <ul className="kit-outline">
              {all.map((i) => (
                <li key={i.id}>
                  {i.meta_description} <CopyBtn text={i.meta_description || ''} />
                </li>
              ))}
            </ul>
          </div>

          {faqs.length > 0 && (
            <div className="flow-card">
              <h3>FAQ questions</h3>
              <ul className="kit-outline">
                {faqs.map((i) => <li key={i.id}>{i.content_angle || i.title}</li>)}
              </ul>
            </div>
          )}

          <div className="flow-card">
            <h3>Simple next SEO tasks</h3>
            <ul className="kit-checklist">
              {nextTasks.map((i) => (
                <li key={i.id}>Create the {i.page_type || 'page'} for "{i.keyword}" — use the title and meta above.</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </StudioShell>
  );
}
