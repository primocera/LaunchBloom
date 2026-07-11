import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AskBox from '../components/AskBox';
import BloomMark from '../components/BloomMark';
import Marquee from '../components/Marquee';
import Meteors from '../components/Meteors';
import Reveal from '../components/Reveal';
import StepPopups from '../components/StepPopups';
import '../landing.css';

// ---------------------------------------------------------------------------
// Prompt 24: the public landing page. Copy and section order follow the
// playbook spec verbatim (hero, problem, solution, how it works, features,
// example kit, who it's for, pricing, FAQ, final CTA). The animated hero sky
// is kept from the ConversionForge design system.
// ---------------------------------------------------------------------------

const PROMPTS = [
  'I can edit videos but have no idea what to sell',
  'Turn my yoga classes into an online offer',
  'I want to coach but who would pay me?',
  'I have a skill, zero audience, and 5 hours a week',
];

// TODO: replace with your real Stripe price ID (must match backend STRIPE_PRICE_PRO).
const PRO_PRICE_ID = 'price_PRO_TODO';

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

// Prompt 24 problem bullets, verbatim.
const PROBLEM_BULLETS = [
  'You are not sure what to sell.',
  'You do not know how to explain your offer.',
  'You post content, but it does not lead to sales.',
  'You do not have a landing page or email sequence.',
  'You feel busy, but not strategic.',
];

const HOW_IT_WORKS = [
  { n: '1', title: 'Answer a few questions', body: 'Your skills, audience ideas, goals and the hours you actually have.' },
  { n: '2', title: 'Get your positioning', body: 'A specific niche, an ideal customer and a clear one-line promise.' },
  { n: '3', title: 'Pick one of 3 offers', body: 'Genuinely different options — format, depth and price point.' },
  { n: '4', title: 'Launch with a full kit', body: 'Landing page, content plan, emails, ads, SEO and a weekly plan.' },
];

// Prompt 24 feature cards, verbatim names.
const FEATURES = [
  { title: 'Positioning Generator', body: 'A specific niche and ideal customer, grounded in what you already know and enjoy.' },
  { title: 'Offer Builder', body: 'Three monetizable offer options with pricing suggestions, bonuses and objection answers.' },
  { title: 'Landing Page Writer', body: 'Benefit-led page copy with problem, transformation, FAQ and clear CTAs — ready to paste.' },
  { title: 'Content Plan', body: '30 days of posts with hooks, angles and CTAs, all promoting the offer you picked.' },
  { title: 'Email Sequence', body: 'A 7-email launch arc: story, problem, transformation, reveal, objections, proof, last call.' },
  { title: 'Ads Starter Kit', body: 'Meta ad hooks, primary text and visual directions you can shoot with a phone.' },
  { title: 'SEO Starter Kit', body: 'Realistic long-tail keywords with page-ready titles and meta descriptions.' },
  { title: 'Weekly Action Plan', body: 'Concrete tasks sized to your available hours — highest-leverage first.' },
];

const WHO_FOR = [
  'Freelancers', 'Creators', 'Coaches', 'Consultants',
  'Solopreneurs', 'Service providers', 'Digital product makers', 'E-commerce beginners',
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
      {/* ── 1. Hero (animated sky kept from the CF design system) ─────── */}
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
            Create my launch kit
          </Link>
        </header>

        <section className="lp-hero">
          <h1>
            Turn your idea into a <span className="lp-serif">clear offer</span>
            <br />
            and launch plan.
          </h1>
          <p className="lp-sub">
            OfferFlow AI helps creators, freelancers and solo founders define what to sell, write
            their landing page, plan content, create emails, test ads and build a simple weekly
            sales system.
          </p>

          <div className="lp-hero-actions">
            <Link className="lp-cta" to="/app">
              Create my launch kit
            </Link>
            <a className="lp-cta-ghost" href="#example">
              See example
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

      {/* ── 2. Problem ─────────────────────────────────────────────────── */}
      <section className="lp-problem">
        <div className="lp-problem-inner">
          <Reveal>
            <div className="lp-eyebrow">The problem</div>
            <h2 className="lp-h2">Ideas are easy. Turning them into sales is where it breaks.</h2>
            <p className="lp-h2-sub">
              You have ideas. Maybe even skills, content or a small audience. But turning that into
              a clear offer, landing page, emails and weekly plan is where most people get stuck.
            </p>
          </Reveal>
          <div className="lp-problem-grid">
            {PROBLEM_BULLETS.map((b, i) => (
              <Reveal className="lp-problem-item" key={b} delay={i * 70}>
                <span className="lp-problem-x">✕</span> {b}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. Solution ────────────────────────────────────────────────── */}
      <Reveal as="section" className="lp-trusted">
        <div className="lp-trusted-label">The solution: one launch kit, eight deliverables</div>
        <Marquee items={OUTPUTS} />
      </Reveal>

      {/* ── 4. How it works ────────────────────────────────────────────── */}
      <section className="lp-how">
        <div className="lp-how-inner">
          <Reveal>
            <div className="lp-eyebrow">How it works</div>
            <h2 className="lp-h2">From idea to launch in four steps</h2>
          </Reveal>
          <div className="lp-how-grid">
            {HOW_IT_WORKS.map((s, i) => (
              <Reveal className="lp-how-step" key={s.n} delay={i * 90}>
                <div className="lp-how-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Features (8 cards, spec names) ──────────────────────────── */}
      <section className="lp-features">
        <div className="lp-feature-grid">
          {FEATURES.map((f, i) => (
            <Reveal as="article" className="lp-feature" key={f.title} delay={(i % 4) * 80}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── 6. Example Launch Kit ──────────────────────────────────────── */}
      <section className="lp-example" id="example">
        <div className="lp-example-inner">
          <Reveal>
            <div className="lp-eyebrow">Example launch kit</div>
            <h2 className="lp-h2">What "video editor with no plan" turns into</h2>
          </Reveal>
          <div className="lp-example-grid">
            <Reveal className="lp-feature">
              <h3>Positioning</h3>
              <p className="lp-ex-quote">"Listing videos for busy real-estate agents — edited and posted within 24 hours."</p>
            </Reveal>
            <Reveal className="lp-feature" delay={90}>
              <h3>Offer</h3>
              <p className="lp-ex-quote">"The Listing Launch Pack — 4 edited videos + captions, monthly."</p>
            </Reveal>
            <Reveal className="lp-feature" delay={180}>
              <h3>Day 14 content</h3>
              <p className="lp-ex-quote">Hook: "Your listing sat for 40 days. The video was why." · CTA: Book the Starter edit →</p>
            </Reveal>
            <Reveal className="lp-feature" delay={270}>
              <h3>Email 4 of 7</h3>
              <p className="lp-ex-quote">Subject: "The 3 listing videos that actually get DMs" · reveal + soft CTA</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 7. Who it is for ───────────────────────────────────────────── */}
      <section className="lp-who">
        <div className="lp-who-inner">
          <Reveal>
            <div className="lp-eyebrow">Who it is for</div>
            <h2 className="lp-h2">Built for people selling themselves, not a warehouse</h2>
          </Reveal>
          <div className="lp-who-grid">
            {WHO_FOR.map((w, i) => (
              <Reveal className="lp-who-chip" key={w} delay={i * 50}>
                {w}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. Pricing preview ─────────────────────────────────────────── */}
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

      {/* ── 9. FAQ ─────────────────────────────────────────────────────── */}
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

      {/* ── 10. Final CTA ──────────────────────────────────────────────── */}
      <section className="lp-final">
        <Reveal className="lp-final-inner">
          <h2>Stop planning. Start launching.</h2>
          <p>Answer a few questions and get your first launch kit today — free.</p>
          <Link className="lp-cta" to="/app">
            Create my launch kit
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
            OfferFlow AI
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Product</div>
            <Link to="/app">Open the app</Link>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-head">Resources</div>
            <a href="#example">Example kit</a>
            <a href="#pricing">Plans</a>
          </div>
        </div>
        <div className="lp-copy">© OfferFlow AI {new Date().getFullYear()}. All rights reserved.</div>
      </footer>
    </div>
  );
}
