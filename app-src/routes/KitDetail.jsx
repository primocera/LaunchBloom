import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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

  useEffect(() => {
    api.launchKit(id)
      .then((r) => setKit(r.launch_kit))
      .catch((e) => setError(e.message));
  }, [id]);

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
          {account?.plan === 'free' && account?.credits_limit != null && (
            <span className="flow-credits">{account.credits_limit - account.credits_used} credits</span>
          )}
          <button className="flow-link" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="flow-main">
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
              <Overview kit={kit} />
            ) : (
              <div className="flow-card">
                <SectionView id={tab} data={kit[tab]} />
                <button
                  className="flow-btn is-ghost"
                  disabled={!!busy}
                  onClick={() => regenerate(tab)}
                >
                  {busy === tab ? 'Regenerating…' : 'Regenerate this section (1 credit)'}
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
    return [
      data.headline,
      data.subheadline,
      '',
      'THE PROBLEM', data.problem_section,
      '',
      'THE TRANSFORMATION', data.transformation_section,
      '',
      'WHAT YOU GET',
      ...(data.offer_stack || []).map((x) => `- ${x}`),
      '',
      data.bonuses?.length ? 'BONUSES' : '',
      ...(data.bonuses || []).map((x) => `- ${x}`),
      '',
      'FAQ',
      ...(data.faq || []).flatMap((f) => [`Q: ${f.question}`, `A: ${f.answer}`]),
      '',
      `CTA: ${data.primary_cta}`,
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
        <Field label="The problem" value={data.problem_section} />
        <Field label="The transformation" value={data.transformation_section} />

        <div className="flow-k">What you get</div>
        <ul>{(data.offer_stack || []).map((x) => <li key={x}>{x}</li>)}</ul>

        {data.bonuses?.length > 0 && (
          <>
            <div className="flow-k">Bonuses</div>
            <ul>{data.bonuses.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}

        <div className="flow-k">FAQ</div>
        {(data.faq || []).map((f) => (
          <p key={f.question}><strong>{f.question}</strong><br />{f.answer}</p>
        ))}

        <Field label="Primary CTA" value={data.primary_cta} />
        <Field label="Secondary CTA" value={data.secondary_cta} />
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
