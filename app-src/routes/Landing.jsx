import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { BRAND } from '../brand';
import { resumePendingCheckout } from './Login';
import BloomMark from '../components/BloomMark';
import Marquee from '../components/Marquee';
import Meteors from '../components/Meteors';
import Reveal from '../components/Reveal';
import '../landing.css';

// ---------------------------------------------------------------------------
// Playbook v6 Prompt 15 — rebuild the landing story around ONE campaign.
// The copy below is the playbook's page-by-page rewrite verbatim: one stable
// promise (no rotating hero), a single four-step mechanism (no six-studios /
// eight-deliverables contradiction), the real-estate example, honest trust
// lines and FAQ. All commercial values come from GET /api/plans.
// ---------------------------------------------------------------------------

// The single four-step mechanism used everywhere — never alternate between a
// four-step flow, six studios and eight deliverables.
const MECHANISM = [
  { n: '1', title: 'Set the facts', body: 'Add your products, audience, voice, proof and claim restrictions to Brand Profile.' },
  { n: '2', title: 'Brief the campaign', body: 'Choose the offer, audience, goal, dates, channels and primary CTA.' },
  { n: '3', title: 'Create connected assets', body: 'Generate website copy, emails, social content, ads and SEO ideas inside that campaign.' },
  { n: '4', title: 'Review and ship', body: 'Resolve unsupported claims, compare versions, edit and export from Library.' },
];

// "What one campaign can include" — deliverables as one connected set.
const VALUE_LIST = [
  'Website pages',
  'Lifecycle and campaign emails',
  'Social captions, carousels and scripts',
  'Static, UGC and search-ad briefs',
  'SEO content ideas',
];

// v5 Prompt 1 / v6: pricing renders from GET /api/plans — the backend catalog
// is the single commercial source of truth. Entitlement label is "full launch
// campaigns" (migrated together with the data model).
function planCard(p) {
  return {
    name: p.label,
    plan: p.plan,
    price: p.price.display,
    badge: p.badge || undefined,
    note: p.note,
    sub: `${p.launch_kits} full launch campaigns + ${p.ai_actions} AI actions / month`,
    features: [
      `${p.workspaces} workspace${p.workspaces === 1 ? '' : 's'}`,
      `${p.launch_kits} full launch campaigns / month`,
      `${p.ai_actions} AI actions / month`,
      'Website, email, social, ads and SEO ideas',
      'Edit, compare versions and export',
    ],
    cta: 'Start 3-day trial',
    savings: p.yearly_savings,
  };
}

const FAQ = [
  {
    q: 'How is this different from a general AI chat?',
    a: 'A chat answers one prompt at a time. LaunchBloom keeps your approved brand facts and campaign brief attached to every asset, then saves outputs with version history and review checks.',
  },
  {
    q: 'Do I need a finished brand strategy?',
    a: 'No. Start with the facts you know. LaunchBloom marks missing proof, prices or restrictions for review instead of inventing them.',
  },
  {
    q: 'What does the free account include?',
    a: 'You can create your account and prepare your Brand Profile and Campaign Brief without a payment method. Generation starts when you choose a plan and begin the 3-day trial.',
  },
  {
    q: 'Will LaunchBloom publish for me?',
    a: 'No. It creates, organizes and exports review-ready drafts. You remain responsible for checking and publishing them.',
  },
  {
    q: 'Does the SEO Studio provide keyword volume or ranking data?',
    a: 'Not currently. It creates content ideas and a research checklist. Any metric must include a real source and date.',
  },
];

function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <div className="faq-list">
      {FAQ.map((item, i) => (
        <div key={item.q} className={open === i ? 'faq-item is-open' : 'faq-item'}>
          <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            <span>{item.q}</span>
            <span className="faq-sign">{open === i ? '×' : '+'}</span>
          </button>
          <div className="faq-a">
            <p>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [interval, setInterval] = useState('monthly');
  const [catalog, setCatalog] = useState(null);
  const pricingRef = useRef(null);

  // Load the canonical plan catalog — the backend is the source of truth.
  useEffect(() => {
    api.trackEvent('landing_viewed'); // v5 Prompt 18: top of funnel
    let cancelled = false;
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.plans) setCatalog(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Fire once when the pricing section first scrolls into view.
  useEffect(() => {
    const el = pricingRef.current;
    if (!el) return;
    let fired = false;
    const observer = new IntersectionObserver((entries) => {
      if (!fired && entries.some((e) => e.isIntersecting)) {
        fired = true;
        api.trackEvent('landing_pricing_viewed');
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Remember which plan + interval was clicked; checkout resumes once signed in.
  async function choose(plan) {
    try {
      if (plan) {
        localStorage.setItem('of-pending-plan', plan);
        localStorage.setItem('of-pending-interval', interval);
      }
    } catch {
      /* private mode: they can still pick the plan again after signing in */
    }
    // Already signed in? Go straight to Stripe instead of the signup screen.
    if (account) {
      try {
        if (await resumePendingCheckout()) return;
      } catch {
        /* fall through to the app; they can retry from there */
      }
      navigate('/app');
      return;
    }
    navigate('/app/signup');
  }

  return (
    <div className="lp">
      {/* ── 1. Hero (animated sky kept from the CF design system) ─────── */}
      <div className="lp-sky">
        <div className="lp-clouds" aria-hidden="true" />
        <Meteors />

        <header className="lp-header">
          <div className="lp-brand">
            <span className="lp-brand-mark">
              <BloomMark />
            </span>
            {BRAND.name}
          </div>
          <nav className="lp-nav" aria-label="Primary">
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <a href="#example">Example campaign</a>
            <a href="#pricing">Pricing</a>
            <Link to="/app/login">Sign in</Link>
          </nav>
          <Link className="lp-header-cta" to="/app">
            Create my campaign
          </Link>
        </header>

        <main className="lp-hero" id="main-content">
          <div className="lp-eyebrow lp-hero-eyebrow">FROM ONE BRIEF TO ONE CONNECTED CAMPAIGN</div>
          <h1>Turn one offer into a launch-ready campaign.</h1>
          <p className="lp-sub">
            {BRAND.name} helps solo founders and small teams create connected website copy, emails,
            social posts and ads from one approved Brand Profile and Campaign Brief.
          </p>

          <div className="lp-hero-actions">
            <Link className="lp-cta" to="/app">
              Create my campaign
            </Link>
            <a className="lp-cta-ghost" href="#example">
              See a real example
            </a>
          </div>

          <p className="lp-cta-note">
            Create an account free. Start a 3-day trial only when you’re ready to generate. Payment
            method required for the trial.
          </p>
        </main>
      </div>

      {/* ── 2. Problem ─────────────────────────────────────────────────── */}
      <section className="lp-problem" id="product">
        <div className="lp-problem-inner">
          <Reveal>
            <div className="lp-eyebrow">The problem</div>
            <h2 className="lp-h2">Your campaign should sound like one idea — not five separate AI chats.</h2>
            <p className="lp-h2-sub">
              When website copy, emails, social posts and ads are created separately, the offer
              drifts. Claims change. Calls to action compete. {BRAND.name} keeps every asset tied to
              the same approved brand facts and campaign brief.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 3. Mechanism (one four-step model, used everywhere) ────────── */}
      <section className="lp-how" id="how-it-works">
        <div className="lp-how-inner">
          <Reveal>
            <div className="lp-eyebrow">How it works</div>
            <h2 className="lp-h2">Approve the strategy once. Build every asset from it.</h2>
          </Reveal>
          <div className="lp-how-grid">
            {MECHANISM.map((s, i) => (
              <Reveal className="lp-how-step" key={s.n} delay={i * 90}>
                <div className="lp-how-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Value — what one campaign can include ───────────────────── */}
      <Reveal as="section" className="lp-trusted">
        <div className="lp-trusted-label">What one campaign can include</div>
        <Marquee items={VALUE_LIST} />
      </Reveal>

      {/* ── 5. Example campaign ────────────────────────────────────────── */}
      <section className="lp-example" id="example">
        <div className="lp-example-inner">
          <Reveal>
            <div className="lp-eyebrow">Example campaign</div>
            <h2 className="lp-h2">See how one brief becomes a coherent campaign.</h2>
            <p className="lp-h2-sub">
              Offer: monthly listing-video package · Audience: independent real-estate agents ·
              Goal: booked discovery calls · CTA: Book a 15-minute fit call
            </p>
          </Reveal>
          <div className="lp-example-grid">
            <Reveal className="lp-feature">
              <h3>Website</h3>
              <p className="lp-ex-quote">
                Listing videos edited, captioned and ready to post within 24 hours — for agents who
                need each property launch to move quickly.
              </p>
            </Reveal>
            <Reveal className="lp-feature" delay={90}>
              <h3>Email</h3>
              <p className="lp-ex-quote">Subject: Your next listing already has a content plan</p>
            </Reveal>
            <Reveal className="lp-feature" delay={180}>
              <h3>Social</h3>
              <p className="lp-ex-quote">Hook: One listing should give you more than one post.</p>
            </Reveal>
            <Reveal className="lp-feature" delay={270}>
              <h3>Ad</h3>
              <p className="lp-ex-quote">
                Angle: Turnaround speed, backed only by the delivery time entered in Brand Profile.
              </p>
            </Reveal>
          </div>
          <Reveal>
            <p className="lp-trust-line">
              Every claim stays tied to facts you approve. Missing proof remains clearly marked for
              review.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 6. Pricing ─────────────────────────────────────────────────── */}
      <section className="lp-pricing" id="pricing" ref={pricingRef}>
        <div className="lp-pricing-inner">
          <Reveal>
            <div className="lp-eyebrow">{catalog?.trial?.eyebrow || 'Start with 3 days free'}</div>
            <h2 className="lp-h2">Choose the amount of campaign work you need.</h2>
            <p className="lp-h2-sub">
              {catalog?.trial?.disclosure || '3 days free · 20 AI actions · 1 full launch campaign · payment method required · cancel before the displayed charge date to avoid the charge.'}
            </p>
          </Reveal>

          <div className="lp-billing-toggle" role="group" aria-label="Billing interval">
            <button
              className={interval === 'monthly' ? 'is-active' : ''}
              onClick={() => setInterval('monthly')}
              type="button"
            >
              Monthly
            </button>
            <button
              className={interval === 'yearly' ? 'is-active' : ''}
              onClick={() => setInterval('yearly')}
              type="button"
            >
              Yearly <span className="lp-billing-save">{catalog?.yearly_badge || 'Save up to 36%'}</span>
            </button>
          </div>

          <div className="lp-price-grid">
            {(catalog?.plans || []).map(planCard).map((p, i) => (
              <Reveal className="lp-price-card" key={p.name} delay={i * 90}>
                <div className="lp-price-top">
                  <span className="lp-price-name">{p.name}</span>
                  {p.badge && <span className="lp-price-badge">{p.badge}</span>}
                </div>
                <div className="lp-price-amount">
                  {p.price[interval]}<span>{interval === 'yearly' ? '/yr' : '/mo'}</span>
                </div>
                <div className="lp-price-note">
                  <div className="lp-price-note-title">{p.note}</div>
                  <div className="lp-price-note-sub">{p.sub}</div>
                </div>

                <div className="lp-included">What's included</div>
                <ul className="lp-price-features">
                  {p.features.map((f) => <li key={f}>{f}</li>)}
                </ul>

                <button className="lp-price-btn" onClick={() => choose(p.plan)}>
                  {p.cta}
                </button>
                <div className="lp-price-micro">
                  3 days free · payment method required · then {p.price[interval]}{interval === 'yearly' ? '/yr' : '/mo'} · cancel before the displayed charge date
                  {interval === 'yearly' && p.savings ? ` · save ${p.savings.display} (${p.savings.pct}%)` : ''}
                </div>
              </Reveal>
            ))}
          </div>
          <p className="lp-price-definition">
            {catalog?.ai_action_definition || 'One AI action is one successful generation or regeneration. Failed generations, editing, copying and exporting do not count.'}
          </p>
        </div>
      </section>

      {/* ── 7. FAQ ─────────────────────────────────────────────────────── */}
      <section className="lp-faq">
        <div className="lp-faq-inner">
          <Reveal className="lp-faq-left">
            <div className="lp-eyebrow">Got questions?</div>
            <h2 className="lp-h2 is-left">
              Everything you
              <br />
              need to know, all in
              <br />
              one place
            </h2>
            <p className="lp-faq-blurb">
              Direct answers about how the campaign model works, how the free trial works, and where
              the product’s honest boundaries are.
            </p>
          </Reveal>
          <Reveal className="lp-faq-right" delay={120}>
            <Faq />
          </Reveal>
        </div>
      </section>

      {/* ── 8. Final CTA ───────────────────────────────────────────────── */}
      <section className="lp-final">
        <Reveal className="lp-final-inner">
          <h2>Turn one offer into a launch-ready campaign.</h2>
          <p>Set up your Brand Profile and Campaign Brief free. Start the 3-day trial when you’re ready to generate.</p>
          <Link className="lp-cta" to="/app">
            Create my campaign
          </Link>
        </Reveal>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-brand is-dark">
            <span className="lp-brand-mark">
              <BloomMark />
            </span>
            {BRAND.name}
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Product</div>
            <Link to="/app">Open the app</Link>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Resources</div>
            <a href="#example">Example campaign</a>
            <a href="#how-it-works">How it works</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Legal</div>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/cookies">Cookies</Link>
            <Link to="/legal/refund">Refunds</Link>
            <a href={`mailto:${BRAND.supportEmail}`}>Contact</a>
          </div>
        </div>
        <div className="lp-copy">© {BRAND.name} {new Date().getFullYear()}. All rights reserved.</div>
      </footer>
    </div>
  );
}
