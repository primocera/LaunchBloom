import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import '../flow.css';

// ---------------------------------------------------------------------------
// The guided flow, one page: onboarding → positioning → offers → launch kit.
// Which step you see is derived from what already exists in the workspace,
// so refreshing (or coming back tomorrow) resumes where you left off.
// ---------------------------------------------------------------------------

const ONBOARDING_FIELDS = [
  { id: 'skills', label: 'What are you good at?', placeholder: 'e.g. video editing, yoga, copywriting…', big: true },
  { id: 'interests', label: 'What do you enjoy?', placeholder: 'Topics you could talk about for hours', big: true },
  { id: 'experience', label: 'Relevant experience', placeholder: 'Jobs, projects, results — anything counts' },
  { id: 'audience_ideas', label: 'Who could you help?', placeholder: 'Any guesses are fine' },
  { id: 'product_type', label: 'What would you like to sell?', placeholder: 'Service, coaching, course, digital product…' },
  { id: 'current_stage', label: 'Where are you now?', placeholder: 'Just an idea / side hustle / already selling' },
  { id: 'main_goal', label: 'Main goal', placeholder: 'e.g. first paying client, replace my salary…' },
  { id: 'weekly_time_available', label: 'Hours per week you can invest', placeholder: 'e.g. 5 hours' },
  { id: 'biggest_challenge', label: 'Biggest challenge right now', placeholder: 'What is stopping you?' },
];

const SECTIONS = [
  ['landing_page', 'Landing page'],
  ['content_plan', '30-day content plan'],
  ['email_sequence', '7-email sequence'],
  ['ads_kit', 'Meta ad ideas'],
  ['seo_kit', 'SEO starter plan'],
  ['weekly_plan', 'Weekly action plan'],
];

export default function Flow() {
  const { account, logout } = useAuth();
  const [state, setState] = useState(null); // { workspace, onboarding, positioning }
  const [offers, setOffers] = useState([]);
  const [kits, setKits] = useState([]);
  const [kit, setKit] = useState(null);
  const [busy, setBusy] = useState(null); // which action is running
  const [error, setError] = useState(null);

  async function refresh() {
    const [ws, of, lk] = await Promise.all([api.workspace(), api.offers(), api.launchKits()]);
    setState(ws);
    setOffers(of.offers);
    setKits(lk.launch_kits);
    if (lk.launch_kits[0] && !kit) {
      const full = await api.launchKit(lk.launch_kits[0].id);
      setKit(full.launch_kit);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(name, fn) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !state) return <Shell account={account} logout={logout}><p className="flow-err">{error}</p></Shell>;
  if (!state) return <Shell account={account} logout={logout}><p className="flow-muted">Loading…</p></Shell>;

  const step = kit ? 4 : offers.length ? 3 : state.positioning ? 2 : state.onboarding ? 1.5 : 1;

  return (
    <Shell account={account} logout={logout} step={step}>
      {error && <p className="flow-err">{error}</p>}

      {/* ── Step 1: onboarding ── */}
      {step === 1 && (
        <OnboardingForm
          busy={busy === 'onboarding'}
          onSubmit={(answers) =>
            run('onboarding', async () => {
              await api.saveOnboarding(answers);
              await refresh();
            })
          }
        />
      )}

      {/* ── Step 1.5: onboarding saved, generate positioning ── */}
      {step === 1.5 && (
        <div className="flow-card">
          <h2>Your answers are in.</h2>
          <p className="flow-muted">Next: we turn them into clear positioning — a niche, an ideal customer, and a one-line statement.</p>
          <button
            className="flow-btn"
            disabled={!!busy}
            onClick={() => run('positioning', async () => { await api.generatePositioning(); await refresh(); })}
          >
            {busy === 'positioning' ? 'Working… (30–60s)' : 'Generate my positioning (1 credit)'}
          </button>
        </div>
      )}

      {/* ── Step 2: positioning shown, generate offers ── */}
      {step === 2 && (
        <>
          <Positioning p={state.positioning} />
          <div className="flow-card">
            <h2>Happy with the direction?</h2>
            <p className="flow-muted">Next we design three genuinely different offers. You pick one.</p>
            <div className="flow-row">
              <button
                className="flow-btn"
                disabled={!!busy}
                onClick={() => run('offers', async () => { await api.generateOffers(); await refresh(); })}
              >
                {busy === 'offers' ? 'Designing… (30–60s)' : 'Design my 3 offers (1 credit)'}
              </button>
              <button
                className="flow-btn is-ghost"
                disabled={!!busy}
                onClick={() => run('positioning', async () => { await api.generatePositioning(); await refresh(); })}
              >
                {busy === 'positioning' ? 'Working…' : 'Regenerate positioning'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3: pick an offer ── */}
      {step === 3 && (
        <>
          <h2 className="flow-h2">Pick the offer that feels right</h2>
          <div className="offer-grid">
            {offers.slice(0, 3).map((o) => (
              <div className="offer-card" key={o.id}>
                <div className="offer-type">{o.offer_type}</div>
                <h3>{o.offer_name}</h3>
                <p className="offer-promise">{o.promise}</p>
                <div className="offer-price">{o.price_suggestion}</div>
                <ul>
                  {(o.what_is_included || []).slice(0, 5).map((x) => <li key={x}>{x}</li>)}
                </ul>
                <p className="flow-muted">{o.why_it_fits}</p>
                <button
                  className="flow-btn"
                  disabled={!!busy}
                  onClick={() => run('kit', async () => {
                    const r = await api.generateLaunchKit(o.id);
                    setKit(r.launch_kit);
                    await refresh();
                  })}
                >
                  {busy === 'kit' ? 'Building your kit… (1–2 min)' : 'Build launch kit (3 credits)'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Step 4: the launch kit ── */}
      {step === 4 && kit && (
        <LaunchKit
          kit={kit}
          busy={busy}
          onRegenerate={(section) =>
            run(section, async () => {
              const r = await api.regenerateSection(kit.id, section);
              setKit({ ...kit, [section]: r.data });
            })
          }
        />
      )}
    </Shell>
  );
}

// ── layout ──────────────────────────────────────────────────────────────────

function Shell({ account, logout, step, children }) {
  return (
    <div className="flow">
      <header className="flow-head">
        <Link to="/" className="flow-brand">OfferFlow AI</Link>
        {step && <Steps current={step} />}
        <div className="flow-account">
          {account?.plan === 'free' && account?.credits_limit != null && (
            <span className="flow-credits">{account.credits_limit - account.credits_used} credits</span>
          )}
          <button className="flow-link" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="flow-main">{children}</main>
    </div>
  );
}

function Steps({ current }) {
  const labels = ['About you', 'Positioning', 'Offers', 'Launch kit'];
  return (
    <div className="flow-steps">
      {labels.map((l, i) => (
        <span key={l} className={current >= i + 1 ? 'is-done' : ''}>{l}</span>
      ))}
    </div>
  );
}

// ── step components ─────────────────────────────────────────────────────────

function OnboardingForm({ onSubmit, busy }) {
  const [values, setValues] = useState(() => {
    // The landing page's ask box hands its text to the skills field.
    let draft = '';
    try { draft = sessionStorage.getItem('of-draft') || ''; } catch { /* private mode */ }
    return { skills: draft };
  });

  function set(id, v) {
    setValues((s) => ({ ...s, [id]: v }));
  }

  return (
    <form
      className="flow-card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <h2>Tell us about you</h2>
      <p className="flow-muted">Honest, rough answers beat polished ones. This shapes everything that follows.</p>

      {ONBOARDING_FIELDS.map((f) => (
        <label className="flow-field" key={f.id}>
          <span>{f.label}</span>
          {f.big ? (
            <textarea
              rows={2}
              value={values[f.id] || ''}
              placeholder={f.placeholder}
              onChange={(e) => set(f.id, e.target.value)}
            />
          ) : (
            <input
              value={values[f.id] || ''}
              placeholder={f.placeholder}
              onChange={(e) => set(f.id, e.target.value)}
            />
          )}
        </label>
      ))}

      <button className="flow-btn" type="submit" disabled={busy || !(values.skills || '').trim()}>
        {busy ? 'Saving…' : 'Save and continue'}
      </button>
    </form>
  );
}

function Positioning({ p }) {
  return (
    <div className="flow-card">
      <div className="flow-eyebrow">Your positioning</div>
      <h2>{p.recommended_niche?.niche}</h2>
      <p>{p.positioning_statement}</p>
      <div className="flow-kv">
        <div>
          <div className="flow-k">Ideal customer</div>
          <p>{p.ideal_customer?.description}</p>
        </div>
        <div>
          <div className="flow-k">Their main pain</div>
          <p>{p.ideal_customer?.main_pain}</p>
        </div>
        <div>
          <div className="flow-k">The transformation</div>
          <p>{p.desired_transformation}</p>
        </div>
        <div>
          <div className="flow-k">Elevator pitch</div>
          <p>{p.elevator_pitch}</p>
        </div>
      </div>
    </div>
  );
}

function LaunchKit({ kit, busy, onRegenerate }) {
  const [open, setOpen] = useState('landing_page');

  return (
    <>
      <div className="flow-card">
        <div className="flow-eyebrow">Your launch kit</div>
        <h2>{kit.title}</h2>
        <p className="flow-muted">{kit.summary}</p>
        {Array.isArray(kit.launch_checklist) && (
          <ul className="kit-checklist">
            {kit.launch_checklist.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
      </div>

      {SECTIONS.map(([id, label]) => (
        <div className="flow-card" key={id}>
          <button className="kit-section-head" onClick={() => setOpen(open === id ? null : id)}>
            <h3>{label}</h3>
            <span>{open === id ? '−' : '+'}</span>
          </button>
          {open === id && (
            <>
              <Section id={id} data={kit[id]} />
              <button className="flow-btn is-ghost" disabled={!!busy} onClick={() => onRegenerate(id)}>
                {busy === id ? 'Regenerating…' : 'Regenerate this section (1 credit)'}
              </button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

/** Render a kit section: landing page is structured; item sections are lists. */
function Section({ id, data }) {
  if (!data) return <p className="flow-muted">Nothing here yet.</p>;

  if (id === 'landing_page') {
    return (
      <div className="kit-landing">
        <h4>{data.headline}</h4>
        <p className="flow-muted">{data.subheadline}</p>
        <div className="flow-k">The problem</div>
        <p>{data.problem_section}</p>
        <div className="flow-k">The transformation</div>
        <p>{data.transformation_section}</p>
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
        <p className="kit-cta">{data.primary_cta}</p>
        <p className="flow-muted">{data.testimonial_placeholder_note}</p>
      </div>
    );
  }

  const items = data.items || [];
  return (
    <div className="kit-items">
      {items.map((item, i) => (
        <div className="kit-item" key={i}>
          {'day_number' in item && <span className="kit-badge">Day {item.day_number}</span>}
          {'sequence_order' in item && <span className="kit-badge">Email {item.sequence_order}</span>}
          {'priority' in item && <span className="kit-badge">{item.priority}</span>}
          <div>
            <div className="kit-item-title">
              {item.topic || item.subject_line || item.headline || item.task_title || item.title || item.keyword}
            </div>
            <div className="flow-muted">
              {item.hook || item.main_angle || item.primary_text || item.task_description || item.meta_description}
            </div>
            {item.cta && <div className="kit-item-cta">CTA: {item.cta}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
