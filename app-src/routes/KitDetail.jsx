import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { contentPlanCsv, download, emailSequenceMarkdown, kitMarkdown } from '../lib/export';
import '../flow.css';

// ---------------------------------------------------------------------------
// Prompt 17: the Launch Kit detail page. Tabs per section, structured
// rendering (never raw JSON), copy-to-clipboard everywhere, and a
// regenerate button per section with a confirmation before replacing.
// ---------------------------------------------------------------------------

const TABS = [
  ['overview', 'Overview'],
  ['landing_page', 'Landing Page'],
  ['content_plan', 'Content Plan'],
  ['email_sequence', 'Emails'],
  ['ads_kit', 'Ads'],
  ['seo_kit', 'SEO'],
  ['weekly_plan', 'Weekly Plan'],
];

export default function KitDetail() {
  const { id } = useParams();
  const { account, logout } = useAuth();
  const [kit, setKit] = useState(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [quality, setQuality] = useState(null);

  const canExport = account?.limits?.can_export !== false;

  useEffect(() => {
    api.launchKit(id)
      .then((r) => setKit(r.launch_kit))
      .catch((e) => setError(e.message));
    api.kitQuality(id).then(setQuality).catch(() => {});
  }, [id]);

  /** Fetch every item table, then hand the bundle to an export builder. */
  async function withItems(fn) {
    const tables = ['content_items', 'email_items', 'ad_ideas', 'seo_items', 'weekly_tasks'];
    const results = await Promise.all(tables.map((t) => api.items(t, id).catch(() => ({ items: [] }))));
    fn(Object.fromEntries(tables.map((t, i) => [t, results[i].items])));
  }

  function exportKit() {
    withItems((items) => download('launch-kit.md', kitMarkdown(kit, items), 'text/markdown'));
  }
  function exportCsv() {
    withItems((items) => download('content-plan.csv', contentPlanCsv(items.content_items), 'text/csv'));
  }
  function exportEmails() {
    withItems((items) => download('email-sequence.md', emailSequenceMarkdown(items.email_items), 'text/markdown'));
  }

  async function regenerate(section) {
    const label = TABS.find(([s]) => s === section)?.[1] || section;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Replace the current ${label}? The existing version will be lost.`)) return;
    setBusy(section);
    setError(null);
    try {
      const r = await api.regenerateSection(kit.id, section);
      setKit((k) => ({ ...k, [section]: r.data }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flow">
      <header className="flow-head">
        <Link to="/app" className="flow-brand">OfferFlow AI</Link>
        <div className="flow-account">
          <span className="flow-credits">{account?.plan_label || 'Free'} plan</span>
          <button className="flow-link" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="flow-main">
        <div className="flow-row" style={{ marginBottom: 14 }}>
          {[['/app/landing-page', 'Landing Page Studio'], ['/app/content-plan', 'Content Studio'], ['/app/email-sequence', 'Email Studio'], ['/app/ads', 'Ads Studio'], ['/app/seo', 'SEO Studio'], ['/app/weekly-plan', 'Weekly Plan']].map(([to, label]) => (
            <Link key={to} to={to} className="kit-tab" style={{ textDecoration: 'none' }}>{label}</Link>
          ))}
        </div>
        {error && <p className="flow-err">{error}</p>}
        {!kit && !error && <p className="flow-muted">Loading your launch kit…</p>}

        {kit && (
          <>
            <div className="flow-card">
              <div className="flow-eyebrow">Launch kit</div>
              <h2>{kit.title}</h2>
              <p className="flow-muted">{kit.summary}</p>
            </div>

            <nav className="kit-tabs">
              {TABS.map(([s, label]) => (
                <button
                  key={s}
                  className={tab === s ? 'kit-tab is-on' : 'kit-tab'}
                  onClick={() => setTab(s)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {tab === 'overview' ? (
              <>
                <div className="flow-card">
                  <div className="kit-row-head">
                    <h3>Export</h3>
                    {!canExport && <span className="kit-badge">Upgrade to export</span>}
                  </div>
                  <p className="flow-muted">Take the kit into Notion, Google Docs, your email tool or a scheduler.</p>
                  <div className="flow-row">
                    <button className="kit-copy" disabled={!canExport} onClick={exportKit}>Export full kit (.md)</button>
                    <button className="kit-copy" disabled={!canExport} onClick={exportCsv}>Content plan (.csv)</button>
                    <button className="kit-copy" disabled={!canExport} onClick={exportEmails}>Email sequence (.md)</button>
                  </div>
                </div>
                {quality && <QualityCards quality={quality.quality} safety={quality.safety} />}
                <Overview kit={kit} />
              </>
            ) : (
              <div className="flow-card">
                <SectionView id={tab} data={kit[tab]} />
                <button
                  className="flow-btn is-ghost"
                  disabled={!!busy}
                  onClick={() => regenerate(tab)}
                >
                  {busy === tab ? 'Regenerating…' : 'Regenerate this section'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── copy helpers ─────────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="kit-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

/** Flatten a section into readable plain text for "copy all". */
function sectionText(id, data) {
  if (!data) return '';
  if (id === 'landing_page') {
    const included = data.whats_included || data.offer_stack || [];
    return [
      data.headline,
      data.subheadline,
      '',
      'THE PROBLEM', data.problem_section,
      '',
      'THE SOLUTION', data.solution_section || data.transformation_section,
      '',
      data.benefits?.length ? 'BENEFITS' : '',
      ...(data.benefits || []).map((x) => `- ${x}`),
      '',
      "WHAT'S INCLUDED",
      ...included.map((x) => `- ${x}`),
      '',
      data.who_its_for?.length ? "WHO IT'S FOR" : '',
      ...(data.who_its_for || []).map((x) => `- ${x}`),
      '',
      data.how_it_works?.length ? 'HOW IT WORKS' : '',
      ...(data.how_it_works || []).map((x, n) => `${n + 1}. ${x}`),
      '',
      data.pricing_section ? 'PRICING\n' + data.pricing_section : '',
      '',
      'FAQ',
      ...(data.faq || []).flatMap((f) => [`Q: ${f.question}`, `A: ${f.answer}`]),
      '',
      `CTA: ${data.primary_cta}`,
      data.final_cta_section || '',
    ].filter((l) => l !== '').join('\n');
  }
  const items = data.items || [];
  return items
    .map((it) =>
      Object.entries(it)
        .filter(([k, v]) => typeof v !== 'object' || Array.isArray(v))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' | ') : v}`)
        .join('\n')
    )
    .join('\n\n');
}

// ── views ────────────────────────────────────────────────────────────────────

// Prompt 27's quality cards + Prompt 28's safety warnings.
const QUALITY_LABELS = {
  offer: 'Offer',
  landing_page: 'Landing page',
  content_plan: 'Content plan',
  email_sequence: 'Email sequence',
};

function QualityCards({ quality, safety }) {
  const highRisk = Object.entries(safety || {}).filter(([, s]) => s && s.risk_level === 'high');

  return (
    <>
      {highRisk.map(([section, s]) => (
        <div className="flow-err" key={section}>
          <strong>Safety warning — {QUALITY_LABELS[section] || section}:</strong> {s.explanation}
          {s.flagged_phrases.length > 0 && <div>Flagged: {s.flagged_phrases.map((p) => `"${p}"`).join(', ')}</div>}
          {s.safer_alternatives.length > 0 && (
            <ul className="kit-outline">{s.safer_alternatives.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
          <div className="flow-muted">You can still edit and use this copy — but rephrase before publishing.</div>
        </div>
      ))}

      <div className="flow-card">
        <h3>Quality check</h3>
        <div className="quality-grid">
          {Object.entries(quality || {}).map(([section, q]) => q && (
            <div className="quality-card" key={section}>
              <div className="kit-row-head" style={{ margin: 0 }}>
                <span className="kit-item-title">{QUALITY_LABELS[section] || section}</span>
                <span className={`kit-badge ${q.passed ? 'is-pass' : 'is-fail'}`}>{q.score}/100</span>
              </div>
              {q.issues.length > 0 ? (
                <ul className="kit-outline">
                  {q.issues.map((iss, n) => (
                    <li key={iss}>{iss} <span className="flow-muted">{q.suggestions[n]}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="flow-muted">All checks passed.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Overview({ kit }) {
  return (
    <div className="flow-card">
      <h3>Launch checklist</h3>
      {Array.isArray(kit.launch_checklist) && kit.launch_checklist.length ? (
        <ul className="kit-checklist">
          {kit.launch_checklist.map((x) => <li key={x}>{x}</li>)}
        </ul>
      ) : (
        <p className="flow-muted">No checklist yet.</p>
      )}
      <p className="flow-muted" style={{ marginTop: 12 }}>
        Work through the tabs above — each section is copy-ready and can be regenerated on its own.
      </p>
    </div>
  );
}

function SectionView({ id, data }) {
  if (!data) return <p className="flow-muted">Nothing here yet. Regenerate to create it.</p>;

  if (id === 'landing_page') {
    return (
      <div className="kit-landing">
        <div className="kit-row-head">
          <h3>Landing page copy</h3>
          <CopyBtn text={sectionText(id, data)} label="Copy full page" />
        </div>

        <Field label="Headline" value={data.headline} />
        <Field label="Subheadline" value={data.subheadline} />
        <Field label="Primary CTA" value={data.primary_cta} />
        <Field label="The problem" value={data.problem_section} />
        <Field label="The solution" value={data.solution_section || data.transformation_section} />

        {data.benefits?.length > 0 && (
          <>
            <div className="flow-k">Benefits</div>
            <ul>{data.benefits.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}

        <div className="flow-k">What's included</div>
        <ul>{(data.whats_included || data.offer_stack || []).map((x) => <li key={x}>{x}</li>)}</ul>

        {data.who_its_for?.length > 0 && (
          <>
            <div className="flow-k">Who it's for</div>
            <ul>{data.who_its_for.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}

        {data.who_its_not_for?.length > 0 && (
          <>
            <div className="flow-k">Who it's not for</div>
            <ul>{data.who_its_not_for.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}

        {data.how_it_works?.length > 0 && (
          <>
            <div className="flow-k">How it works</div>
            <ul>{data.how_it_works.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}

        <Field label="Pricing section" value={data.pricing_section} />

        <div className="flow-k">FAQ</div>
        {(data.faq || []).map((f) => (
          <p key={f.question}><strong>{f.question}</strong><br />{f.answer}</p>
        ))}

        <Field label="Final CTA" value={data.final_cta_section} />
        <p className="flow-muted">{data.testimonial_placeholder_note}</p>
      </div>
    );
  }

  const items = data.items || [];
  if (!items.length) return <p className="flow-muted">Nothing here yet.</p>;

  return (
    <>
      <div className="kit-row-head">
        <h3>{items.length} items</h3>
        <CopyBtn text={sectionText(id, data)} label="Copy all" />
      </div>
      <div className="kit-items">
        {items.map((item, i) => (
          <div className="kit-item" key={i}>
            {'day_number' in item && <span className="kit-badge">Day {item.day_number}</span>}
            {'sequence_order' in item && <span className="kit-badge">Email {item.sequence_order}</span>}
            {'priority' in item && <span className="kit-badge">{item.priority}</span>}
            <div style={{ flex: 1 }}>
              <div className="kit-item-title">
                {item.topic || item.subject_line || item.headline || item.task_title || item.title || item.keyword}
              </div>
              {(item.platform || item.content_type || item.email_type || item.ad_type || item.page_type || item.task_type) && (
                <div className="kit-item-meta">
                  {[item.platform, item.content_type, item.email_type, item.ad_type, item.page_type, item.task_type]
                    .filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="flow-muted">
                {item.hook || item.main_angle || item.primary_text || item.task_description || item.meta_description}
              </div>
              {Array.isArray(item.body_outline) && (
                <ul className="kit-outline">
                  {item.body_outline.map((x) => <li key={x}>{x}</li>)}
                </ul>
              )}
              {item.visual_direction && <div className="flow-muted">Visual: {item.visual_direction}</div>}
              {item.caption_angle && <div className="flow-muted">Angle: {item.caption_angle}</div>}
              {item.cta && <div className="kit-item-cta">CTA: {item.cta}</div>}
            </div>
            <CopyBtn
              text={item.hook || item.subject_line || item.primary_text || item.title || item.task_title || ''}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="kit-field">
      <div className="kit-row-head">
        <div className="flow-k">{label}</div>
        <CopyBtn text={value} />
      </div>
      <p>{value}</p>
    </div>
  );
}
