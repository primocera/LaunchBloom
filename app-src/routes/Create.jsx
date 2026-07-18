import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../flow.css';

// ---------------------------------------------------------------------------
// v5 Prompt 3: the Create landing page — one place to start any generation,
// organized into the five canonical categories. Replaces the old two-list
// sidebar (new studios + "Launch Kit: …" routes).
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    to: '/app/website',
    title: 'Website',
    body: 'Home, product, landing, about, FAQ and cart copy — structured and ready for your review.',
  },
  {
    to: '/app/email-studio',
    title: 'Email',
    body: 'Lifecycle flows, campaign emails and launch sequences with full body copy.',
  },
  {
    to: '/app/social',
    title: 'Social',
    body: 'Captions, hooks, carousels and reels tied to your campaigns.',
  },
  {
    to: '/app/creative',
    title: 'Ads & Creative',
    body: 'Static, video and UGC ad concepts with briefs you can shoot from.',
  },
  {
    to: '/app/seo',
    title: 'SEO Ideas',
    body: 'Content topics, page titles, metadata and outlines to research before publishing.',
  },
];

const NOTICE_KEY = 'lb-nav-migration-notice';

export default function Create() {
  const [showNotice, setShowNotice] = useState(false);
  // v5 Prompt 6: arriving from a campaign carries its id into every studio.
  const [params] = useSearchParams();
  const campaign = params.get('campaign');
  const withCampaign = (to) => (campaign ? `${to}?campaign=${campaign}` : to);

  // One-time notice for users who knew the old "Launch Kit: …" menu.
  useEffect(() => {
    try {
      if (!localStorage.getItem(NOTICE_KEY)) setShowNotice(true);
    } catch { /* private mode */ }
  }, []);

  function dismiss() {
    try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* ignore */ }
    setShowNotice(false);
  }

  return (
    <div className="flow">
      <section className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>Create</h2>
            <p className="flow-muted">Pick what you want to make. Everything stays tied to your brand and campaigns.</p>
          </div>
        </div>

        {showNotice && (
          <div className="flow-card" role="status">
            <p style={{ margin: 0 }}>
              The studios have a new home. The old “Launch Kit” pages now live here and in{' '}
              <Link to="/app/campaigns">Campaigns</Link> — your existing kits and assets are untouched.{' '}
              <button className="account-link" onClick={dismiss}>Got it</button>
            </p>
          </div>
        )}

        <div className="gen-results">
          {CATEGORIES.map((c) => (
            <Link key={c.to} to={withCampaign(c.to)} className="flow-card gen-card create-card">
              <h3>{c.title}</h3>
              <p className="flow-muted">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
