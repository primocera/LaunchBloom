import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import '../flow.css';

// ---------------------------------------------------------------------------
// v5 Prompt 3 / v6 Prompt 20: the Create landing page — choose the next asset
// within campaign context. Create never presents a second navigation list
// without a campaign: without one, it asks the user to select or create a
// campaign first. Copy follows the playbook Create table verbatim.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    to: '/app/website',
    title: 'Website',
    body: 'Page-ready website and landing-page copy, including titles, metadata, FAQs and CTA structure.',
  },
  {
    to: '/app/email-studio',
    title: 'Email',
    body: 'Lifecycle flows and campaign sequences with subjects, preheaders, full body copy and audience rules.',
  },
  {
    to: '/app/social',
    title: 'Social',
    body: 'Captions, carousels and video scripts adapted to the channels and dates you choose.',
  },
  {
    to: '/app/creative',
    title: 'Ads & Creative',
    body: 'Static, carousel, UGC, video and search-ad briefs with testing and claim checks.',
  },
  {
    to: '/app/seo',
    title: 'SEO Ideas',
    body: 'Content topics, page titles, metadata and outlines to research before publishing.',
  },
];

export default function Create() {
  // v5 Prompt 6: arriving from a campaign carries its id into every studio.
  const [params] = useSearchParams();
  const campaign = params.get('campaign');
  const withCampaign = (to) => (campaign ? `${to}?campaign=${campaign}` : to);
  const [campaignName, setCampaignName] = useState(null);

  // Resolve the campaign name for the heading (Prompt 20: "Create for {name}").
  useEffect(() => {
    if (!campaign) { setCampaignName(null); return; }
    let cancelled = false;
    api.campaigns()
      .then((r) => {
        if (cancelled) return;
        const found = (r.campaigns || []).find((c) => String(c.id) === String(campaign));
        setCampaignName(found?.name || '');
      })
      .catch(() => { if (!cancelled) setCampaignName(''); });
    return () => { cancelled = true; };
  }, [campaign]);

  return (
    <div className="flow">
      <section className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>{campaign ? `Create for ${campaignName || 'your campaign'}` : 'Create'}</h2>
            <p className="flow-muted">
              {campaign
                ? 'Choose the next asset. Every generation uses this campaign’s approved brief and your Brand Profile.'
                : 'Choose the next asset. Every generation uses your campaign’s approved brief and your Brand Profile.'}
            </p>
          </div>
        </div>

        {!campaign && (
          <div className="flow-card" role="status">
            <p style={{ margin: 0 }}>
              Select or create a campaign first so every asset has a clear purpose.{' '}
              <Link to="/app/campaigns">Go to Campaigns →</Link>
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
