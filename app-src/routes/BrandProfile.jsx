import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { minimumViableProfile } from '../lib/next-actions';

// ---------------------------------------------------------------------------
// v5 Prompt 5: guided Brand setup with progressive disclosure.
// - First run (?welcome=1 or empty profile): a 7-question onboarding that can
//   be finished in under three minutes.
// - After that: seven sections with per-section completeness, structured
//   Products and Audience records, chip inputs and explained examples.
// Legacy flat fields are kept as-is (no data loss); structured records live
// alongside them in the same jsonb profile.
// ---------------------------------------------------------------------------

const SECTIONS = [
  {
    id: 'basics', label: 'Basics',
    fields: [
      ['brand_name', 'Brand name', 'input', 'e.g. Bloom & Co'],
      ['business_type', 'Business type', 'input', 'e.g. Handmade candles, ecommerce'],
      ['website', 'Website', 'input', 'https://…'],
      ['markets', 'Target markets', 'chips', 'e.g. US'],
      ['languages', 'Languages', 'chips', 'e.g. English'],
      ['main_goal', 'Main goal', 'input', 'e.g. first 100 customers, grow email list'],
    ],
    why: 'Sets the language, market and goal every asset is written for.',
  },
  {
    id: 'audience', label: 'Audience', records: 'audiences',
    fields: [],
    why: 'Generators write to your primary segment unless you pick another.',
  },
  {
    id: 'products', label: 'Products & offers', records: 'products_list',
    fields: [['products', 'Products / services (free text)', 'textarea', 'Anything not captured in the records above…']],
    why: 'Add facts you can verify: what it is, price, materials or delivery, proof and any claim restrictions.',
  },
  {
    id: 'voice', label: 'Voice',
    fields: [
      ['tone', 'Tone of voice', 'input', 'e.g. warm, direct, a little playful'],
      ['example_copy', 'Example copy', 'textarea', 'Paste a paragraph that sounds like your brand…'],
      ['words_to_use', 'Words to use', 'chips', 'e.g. handcrafted'],
      ['words_to_avoid', 'Words to avoid', 'chips', 'e.g. cheap'],
      ['cta_style', 'CTA style', 'input', 'e.g. "Shop the collection", not "Buy now"'],
    ],
    why: 'Voice fields shape how everything reads.',
  },
  {
    id: 'proof', label: 'Proof & positioning',
    fields: [
      ['positioning', 'Positioning', 'textarea', 'One or two sentences on how you want to be seen…'],
      ['differentiators', 'Differentiators', 'textarea', 'What makes you different from competitors…'],
      ['proof_points', 'Proof points', 'textarea', 'Real numbers, results, credentials you can back up…'],
      ['competitors', 'Competitors', 'chips', 'e.g. BigCandleCo'],
    ],
    why: 'Only add numbers, reviews, credentials or results you can support. Leave this blank if you do not have proof yet.',
  },
  {
    id: 'channels', label: 'Channels',
    fields: [['default_channels', 'Default channels', 'chips', 'e.g. Instagram']],
    why: 'Studios preselect these channels for you.',
  },
  {
    id: 'compliance', label: 'Compliance',
    fields: [['compliance_notes', 'Claim restrictions', 'textarea', 'Claims you must avoid, legal/industry rules…']],
    why: 'Restrictions here are enforced across every generator.',
  },
];

const PRODUCT_FIELDS = [
  ['name', 'Name', 'e.g. Lavender Dream candle'],
  ['category', 'Category', 'e.g. scented candle'],
  ['description', 'Description', 'What it is, key facts (materials, sizes)'],
  ['price', 'Price', 'e.g. $34'],
  ['differentiators', 'Differentiators', 'Why this over alternatives'],
  ['proof', 'Proof', 'Reviews, results, certifications you can back up'],
  ['url', 'URL', 'https://…'],
  ['claim_restrictions', 'Claim restrictions', 'Anything you must not say about it'],
];

const AUDIENCE_FIELDS = [
  ['name', 'Segment name', 'e.g. Gift buyers'],
  ['description', 'Who they are', 'Situation, pains, what they want'],
];

function Chips({ id, value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const items = Array.isArray(value) ? value : (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : []);
  function add() {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft('');
  }
  return (
    <div className="bp-chips">
      {items.map((it) => (
        <span className="gen-chip is-on" key={it}>
          {it}
          <button type="button" aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>×</button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
      />
    </div>
  );
}

function RecordList({ kind, records, fields, onChange, primaryKey }) {
  const list = Array.isArray(records) ? records : [];
  function update(i, key, v) {
    const next = list.map((r, j) => (j === i ? { ...r, [key]: v } : r));
    onChange(next);
  }
  return (
    <div className="bp-records">
      {list.map((r, i) => (
        <div className="flow-card bp-record" key={i}>
          <div className="bp-record-head">
            <strong>{r.name || `${kind} ${i + 1}`}</strong>
            <span>
              {primaryKey && (
                <button
                  type="button"
                  className={r.primary ? 'gen-chip is-on' : 'gen-chip'}
                  onClick={() => onChange(list.map((x, j) => ({ ...x, primary: j === i })))}
                >
                  {r.primary ? 'Primary' : 'Make primary'}
                </button>
              )}
              <button type="button" className="account-link" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>
            </span>
          </div>
          {fields.map(([key, label, ph]) => (
            <div className="brand-field" key={key}>
              <label htmlFor={`${kind}-${i}-${key}`}>{label}</label>
              <input id={`${kind}-${i}-${key}`} value={r[key] || ''} placeholder={ph} onChange={(e) => update(i, key, e.target.value)} />
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="flow-btn is-ghost" onClick={() => onChange([...list, list.length === 0 && primaryKey ? { primary: true } : {}])}>
        + Add {kind}
      </button>
    </div>
  );
}

function fieldFilled(profile, key) {
  const v = profile[key];
  return Array.isArray(v) ? v.length > 0 : !!v;
}

function sectionCompleteness(profile, section) {
  let total = section.fields.length;
  let done = section.fields.filter(([k]) => fieldFilled(profile, k)).length;
  if (section.records) {
    total += 1;
    if ((profile[section.records] || []).some((r) => r.name)) done += 1;
  }
  return { done, total };
}

// ── First-run onboarding: 7 questions, under three minutes ──────────────────
const ONBOARDING_STEPS = [
  { key: 'brand_name', label: 'What’s your brand called?', ph: 'e.g. Bloom & Co' },
  { key: 'business_type', label: 'What kind of business is it?', ph: 'e.g. Handmade candles, ecommerce' },
  { key: '_product', label: 'Your primary product or service?', ph: 'e.g. Lavender Dream candle' },
  { key: '_audience', label: 'Who do you mainly sell to?', ph: 'e.g. Gift buyers who want something personal' },
  { key: 'main_goal', label: 'Main goal right now?', ph: 'e.g. first 100 customers' },
  { key: 'languages', label: 'Main language for your marketing?', ph: 'e.g. English' },
  { key: 'tone', label: 'Tone of voice?', ph: 'e.g. warm, direct, a little playful' },
];

function Onboarding({ profile, onDone, save }) {
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step];

  function next() {
    if (step < ONBOARDING_STEPS.length - 1) { setStep(step + 1); return; }
    const merged = { ...profile };
    for (const s of ONBOARDING_STEPS) {
      const v = (answers[s.key] || '').trim();
      if (!v) continue;
      if (s.key === '_product') merged.products_list = [...(merged.products_list || []), { name: v, primary: true }];
      else if (s.key === '_audience') merged.audiences = [...(merged.audiences || []), { name: v, description: v, primary: true }];
      else if (s.key === 'languages') merged.languages = [v];
      else merged[s.key] = v;
    }
    save(merged);
    onDone();
  }

  return (
    <div className="brand-page">
      <h1>Give every campaign the same ground truth.</h1>
      <p className="muted">
        Add the facts Scalvya should reuse — and the claims it must never invent. You can refine
        this profile as your business changes.
      </p>
      <div className="flow-card">
        <div className="brand-field">
          <label htmlFor="bp-onb">{current.label}</label>
          <input
            id="bp-onb"
            autoFocus
            value={answers[current.key] || ''}
            placeholder={current.ph}
            onChange={(e) => setAnswers({ ...answers, [current.key]: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
          />
        </div>
        <div className="flow-row">
          {step > 0 && <button className="flow-btn is-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="flow-btn" onClick={next}>
            {step === ONBOARDING_STEPS.length - 1 ? 'Save Brand Profile' : 'Next'}
          </button>
          <button className="account-link" onClick={onDone}>Skip — I’ll add this before generating</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Step {step + 1} of {ONBOARDING_STEPS.length} · About 2 minutes left
        </p>
      </div>
    </div>
  );
}

export default function BrandProfile() {
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState('basics');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const timer = useRef(null);
  const saveSeq = useRef(0); // stale-response guard

  useEffect(() => {
    api.brandProfile().then(({ profile: p }) => {
      setProfile(p || {});
      const empty = !p || !p.brand_name;
      if (params.get('welcome') === '1' && empty) setShowOnboarding(true);
    }).catch(() => setProfile({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next) {
    setProfile(next);
    setStatus('Saving…');
    clearTimeout(timer.current);
    const seq = ++saveSeq.current;
    timer.current = setTimeout(async () => {
      try {
        await api.saveBrandProfile(next);
        if (seq === saveSeq.current) setStatus('Brand Profile saved. New generations will use these facts.');
      } catch {
        if (seq === saveSeq.current) setStatus('Could not save — retrying. Your changes are still on this device.');
        setTimeout(() => { if (seq === saveSeq.current) persist(next); }, 4000);
      }
    }, 700);
  }

  if (!profile) return <div className="brand-page"><p className="muted">Loading…</p></div>;

  if (showOnboarding) {
    return (
      <Onboarding
        profile={profile}
        save={persist}
        onDone={() => {
          setShowOnboarding(false);
          const next = new URLSearchParams(params);
          next.delete('welcome');
          setParams(next, { replace: true });
        }}
      />
    );
  }

  const update = (key, v) => persist({ ...profile, [key]: v });

  return (
    <div className="brand-page">
      <div className="brand-head">
        <h1>Brand Profile</h1>
        <span className="brand-status" role="status" aria-live="polite">{status}</span>
      </div>
      <p className="muted">
        Add the facts Scalvya should reuse — and the claims it must never invent. Changes apply
        to future generations; assets you&rsquo;ve already saved keep the context they were generated
        from.
      </p>
      {/* v9 SC-08: tailored setup guidance from the chosen use-case path. It only
          changes wording — the same Brand Profile → Campaign Brief contract runs
          for both. No company or client names are read or stored. */}
      {(() => {
        let path = null;
        try { path = localStorage.getItem('of-use-case'); } catch { /* private mode */ }
        if (path === 'client') {
          return <p className="muted" role="note">Building for clients? Use one workspace per client and fill this with that client&rsquo;s facts — each campaign brief then inherits them for a clean, consistent handoff.</p>;
        }
        if (path === 'own') {
          return <p className="muted" role="note">Launching your own campaign? Add your real products, audience and proof once here — every campaign you brief will reuse them.</p>;
        }
        return null;
      })()}

      {/* v7 LB-03: the smallest credible baseline, stated — not a score. */}
      {(() => {
        const missing = minimumViableProfile(profile);
        return missing.length ? (
          <p className="muted bp-baseline" role="status">
            Before your first generation, add {missing.join(', ')}. Everything else here improves
            quality but is optional.
          </p>
        ) : (
          <p className="muted bp-baseline" role="status">
            Your baseline is complete — generators have what they need. Deeper proof and restriction
            details improve review quality.
          </p>
        );
      })()}

      {SECTIONS.map((section) => {
        const { done, total } = sectionCompleteness(profile, section);
        const isOpen = open === section.id;
        return (
          <div className="flow-card bp-section" key={section.id}>
            <button
              type="button"
              className="bp-section-head"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : section.id)}
            >
              <span>{section.label}</span>
              <span className={done === total ? 'bp-count is-done' : 'bp-count'}>{done}/{total}</span>
            </button>
            {isOpen && (
              <div className="bp-section-body">
                <p className="muted bp-why">{section.why}</p>
                {section.records === 'audiences' && (
                  <RecordList kind="audience" records={profile.audiences} fields={AUDIENCE_FIELDS} primaryKey onChange={(v) => update('audiences', v)} />
                )}
                {section.records === 'products_list' && (
                  <RecordList kind="product" records={profile.products_list} fields={PRODUCT_FIELDS} primaryKey onChange={(v) => update('products_list', v)} />
                )}
                {section.fields.map(([key, label, kind, placeholder]) => (
                  <div className="brand-field" key={key}>
                    <label htmlFor={`bp-${key}`}>{label}</label>
                    {kind === 'textarea' ? (
                      <textarea id={`bp-${key}`} rows={3} value={Array.isArray(profile[key]) ? profile[key].join(', ') : (profile[key] || '')} placeholder={placeholder} onChange={(e) => update(key, e.target.value)} />
                    ) : kind === 'chips' ? (
                      <Chips id={`bp-${key}`} value={profile[key]} placeholder={placeholder} onChange={(v) => update(key, v)} />
                    ) : (
                      <input id={`bp-${key}`} type="text" value={Array.isArray(profile[key]) ? profile[key].join(', ') : (profile[key] || '')} placeholder={placeholder} onChange={(e) => update(key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="muted">Changes save automatically.</p>
    </div>
  );
}
