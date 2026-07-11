import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AskBox from '../components/AskBox';
import BloomMark from '../components/BloomMark';
import Marquee from '../components/Marquee';
import Meteors from '../components/Meteors';
import Reveal from '../components/Reveal';
import RotatingWord from '../components/RotatingWord';
import StepPopups from '../components/StepPopups';
import '../landing.css';

const ROLES = [
  'Offer Builder.',
  'Positioning Coach.',
  'Launch Strategist.',
  'Content Planner.',
  'Email Writer.',
  'Marketing Partner.',
];

const PROMPTS = [
  'I can edit videos but have no idea what to sell',
  'Turn my yoga classes into an online offer',
  'I want to coach but who would pay me?',
  'I have a skill, zero audience, and 5 hours a week',
];

// TODO: replace with your real Stripe price IDs (must match backend
// STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO env vars).
const PRO_PRICE_ID = 'price_PRO_TODO';

// What comes out of a launch kit — the eight deliverables from the spec.
const OUTPUTS = [
  'Positioning',
  'Offer',
  'Landing page copy',
  '30-day content plan',
  '7-email sequence',
  'Meta ad ideas',
  'SEO starter plan',
  'Weekly action plan',
];

const FEATURES = [
  {
    title: 'A guided path, not a blank prompt',
    body: 'Answer a few questions about your skills, audience and time. The workflow does the rest, in order.',
    preview: (
      <div className="fp">
        <div className="fp-label">Onboarding</div>
        <div className="fp-bar">
          <span style={{ width: '62%' }} />
        </div>
        <div className="fp-row">
          <span className="fp-chip is-on">Skills</span>
          <span className="fp-chip is-on">Audience</span>
          <span className="fp-chip">Time: 5h/wk</span>
        </div>
      </div>
    ),
  },
  {
    title: 'Positioning before anything else',
    body: 'A specific niche, an ideal customer, and a one-line positioning statement — grounded in what you told us.',
    preview: (
      <div className="fp">
        <div className="fp-label">Positioning</div>
        <div className="fp-input">Video editing for busy real-estate agents</div>
        <div className="fp-input is-muted">Ideal customer: agents posting listings weekly, no time to edit.</div>
      </div>
    ),
  },
  {
    title: 'Three offers, genuinely different',
    body: 'Not three flavors of the same thing — different price points, formats and depth. You pick the one that fits.',
    preview: (
      <div className="fp">
        <div className="fp-stat-row">
          <div>
            <div className="fp-k">Starter</div>
            <div className="fp-v">$97</div>
          </div>
          <div>
            <div className="fp-k">Core</div>
            <div className="fp-v">$450</div>
          </div>
          <div>
            <div className="fp-k">Premium</div>
            <div className="fp-v">$1.2k</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'A full launch kit in one go',
    body: 'Landing copy, 30 days of content, 7 emails, ad ideas, an SEO plan and your first weekly action plan.',
    preview: (
      <div className="fp">
        <div className="fp-label">Launch kit</div>
        <div className="fp-row">
          <span className="fp-chip is-on">Landing</span>
          <span className="fp-chip is-on">30-day content</span>
          <span className="fp-chip is-on">7 emails</span>
        </div>
      </div>
    ),
  },
  {
    title: 'Everything stays tied to your offer',
    body: 'Every caption, email and ad promotes the offer you picked — not generic content about your niche.',
    preview: (
      <div className="fp">
        <div className="fp-label">Day 14 · Instagram</div>
        <div className="fp-input">Hook: "Your listing sat for 40 days. The video was why."</div>
        <div className="fp-input is-muted">CTA: Book the Starter edit →</div>
      </div>
    ),
  },
  {
    title: 'Honest by design',
    body: 'No invented testimonials, no income promises, no hype. Placeholders tell you what to replace with real proof.',
    preview: (
      <div className="fp">
        <div className="fp-label">Landing page</div>
        <div className="fp-input is-muted">
          Add real client results here — the kit never invents them for you.
        </div>
      </div>
    ),
  },
];

const FAQ = [
  {
    q: 'How is this different from asking ChatGPT for a business plan?',
    a: 'A chat gives you a wall of text you still have to turn into assets. This is a workflow: onboarding → positioning → three offers → a launch kit where every piece (landing copy, content calendar, emails, ads, SEO) is structured, editable and tied to the offer you picked.',
  },
  {
    q: 'I have no audience yet. Does this still work?',
    a: 'That is exactly who it is for. The positioning step picks a niche you can realistically reach with the platforms and hours you actually have, and the weekly plan starts from zero — not from "post to your list".',
  },
  {
    q: 'What do the free credits cover?',
    a: 'Ten credits, no card needed. Positioning costs one, the three offer options cost one, and a full launch kit costs three — so you can go from idea to a complete kit at least once for free.',
  },
  {
    q: 'Will it promise me revenue?',
    a: 'No. Price suggestions are ranges, results language is honest, and testimonial slots are placeholders for real proof. Anything that overpromises hurts you at launch — so the kit refuses to.',
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

  // Remember which plan was clicked; checkout resumes once they are signed in.
  function choose(priceId) {
    try {
      if (priceId) localStorage.setItem('of-pending-plan', priceId);
    } catch {
      /* private mode: they can still pick the plan again after signing in */
    }
    navigate('/app/login');
  }

  return (
    <div className="lp">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="lp-sky">
        <div className="lp-clouds" aria-hidden="true" />
        <Meteors />

        <header className="lp-header">
          <div className="lp-brand">
            <span className="lp-brand-mark">
              <BloomMark />
            </span>
            OfferFlow AI
          </div>
          <Link className="lp-header-cta" to="/app">
            Start for free
          </Link>
        </header>

        <section className="lp-hero">
          <h1>
            Your AI{' '}
            <span className="lp-serif">
              <RotatingWord words={ROLES} />
            </span>
          </h1>
          <p className="lp-sub">
            From idea to offer to launch — a guided workflow that turns what you know into something people can buy.
          </p>

          <div className="lp-hero-actions">
            <Link className="lp-cta" to="/app">
              Try it free
            </Link>
            <a className="lp-cta-ghost" href="#pricing">
              See pricing
            </a>
          </div>

          <div className="lp-ask">
            <div className="lp-ask-head">
              <div className="lp-ask-title">
                <span className="lp-ask-spark">✦</span> Tell OfferFlow your idea
              </div>
              <span className="lp-ask-pill">Guided workflow</span>
            </div>

            <AskBox prompts={PROMPTS} />
          </div>
        </section>
      </div>

      <StepPopups />

      {/* ── What you get ──────────────────────────────────────────────── */}
      <Reveal as="section" className="lp-trusted">
        <div className="lp-trusted-label">One launch kit, eight deliverables</div>
        <Marquee items={OUTPUTS} />
      </Reveal>

      {/* ── Feature grid ──────────────────────────────────────────────── */}
      <section className="lp-features">
        <div className="lp-feature-grid">
          {FEATURES.map((f, i) => (
            <Reveal as="article" className="lp-feature" key={f.title} delay={(i % 3) * 90}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              {f.preview}
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────── */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-pricing-inner">
          <Reveal>
            <div className="lp-eyebrow">Pricing plans</div>
            <h2 className="lp-h2">Simple pricing for first-time founders</h2>
            <p className="lp-h2-sub">Your first launch kit is free. Cancel anytime.</p>
          </Reveal>

          <div className="lp-price-grid">
            <Reveal className="lp-price-card">
              <div className="lp-price-top">
                <span className="lp-price-name">Free</span>
              </div>
              <div className="lp-price-amount">
                $0<span>/mo</span>
              </div>
              <div className="lp-price-note">
                <div className="lp-price-note-title">Go from idea to kit once</div>
                <div className="lp-price-note-sub">Ten credits, no card</div>
              </div>

              <div className="lp-included">What's included</div>
              <ul className="lp-price-features">
                <li>Positioning + ideal customer</li>
                <li>Three offer options</li>
                <li>One full launch kit</li>
                <li>All eight deliverables included</li>
              </ul>

              <Link className="lp-price-btn" to="/app">
                Start free
              </Link>
              <div className="lp-price-micro">No card needed</div>
            </Reveal>

            <Reveal className="lp-price-card" delay={120} data-price-id={PRO_PRICE_ID}>
              <div className="lp-price-top">
                <span className="lp-price-name">Pro</span>
                <span className="lp-price-badge">Most popular</span>
              </div>
              <div className="lp-price-amount">
                $29<span>/mo</span>
              </div>
              <div className="lp-price-note">
                <div className="lp-price-note-title">Launch as many offers as you want</div>
                <div className="lp-price-note-sub">Unlimited kits and regenerations</div>
              </div>

              <div className="lp-included">What's included</div>
              <ul className="lp-price-features">
                <li>Unlimited launch kits</li>
                <li>Regenerate any section with feedback</li>
                <li>Fresh weekly action plans</li>
                <li>All future studios and tools</li>
              </ul>

              <button className="lp-price-btn" onClick={() => choose(PRO_PRICE_ID)}>
                Choose
              </button>
              <div className="lp-price-micro">Cancel anytime · no setup fees</div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="lp-faq">
        <div className="lp-faq-inner">
          <Reveal className="lp-faq-left">
            <div className="lp-eyebrow">Got questions?</div>
            <h2 className="lp-h2 is-left">
              Everything You
              <br />
              Need to Know, All in
              <br />
              One Place
            </h2>
            <p className="lp-faq-blurb">
              Quick answers about how the workflow guides you, what the free credits cover, and what
              the kit will never do.
            </p>
          </Reveal>
          <Reveal className="lp-faq-right" delay={120}>
            <Faq />
          </Reveal>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-brand is-dark">
            <span className="lp-brand-mark">
              <BloomMark />
            </span>
            OfferFlow AI
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Product</div>
            <Link to="/app">Open the app</Link>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Resources</div>
            <a href="#pricing">Plans</a>
          </div>
        </div>
        <div className="lp-copy">© OfferFlow AI {new Date().getFullYear()}. All rights reserved.</div>
      </footer>
    </div>
  );
}
