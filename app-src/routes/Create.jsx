import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { totalAssets, sectionPath } from './campaign/shared';
import ErrorState from '../components/ErrorState';
import { emptyWorkspaceState } from '../lib/error-states';
import '../flow.css';

// ---------------------------------------------------------------------------
// v5 Prompt 3 / v6 Prompt 20 / v10 SC-01: Create is a campaign-context
// RESOLVER, not a second navigation list. Without a campaign it asks which
// campaign the work belongs to (and links to creating one) — it never offers
// the five studios, because an asset generated without an approved brief is
// the "where do I start?" dead end this slice removes. With a campaign it
// offers exactly the five canonical creation paths, carrying the campaign id.
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
  const { account } = useAuth();
  const withCampaign = (to) => (campaign ? `${to}?campaign=${campaign}` : to);

  const [campaigns, setCampaigns] = useState(null); // null = loading, [] = none
  const [error, setError] = useState(null);

  function load() {
    setError(null);
    api.campaigns()
      .then((r) => setCampaigns(r.campaigns || []))
      .catch((e) => { setCampaigns([]); setError(e.message); });
  }
  useEffect(load, []);

  const current = campaigns && campaigns.find((c) => String(c.id) === String(campaign));

  // v10 SC-01: the recommended path, measured from canonical state only —
  // never a synthetic "onboarding done" flag. Entitlement is a coarse label.
  const entitlement = (account?.plan_label || 'free').toLowerCase();
  useEffect(() => {
    if (campaigns === null) return; // still loading — nothing observed yet
    if (!campaign) {
      api.trackEvent('primary_path_started', { stage: 'resolve_campaign', entitlement });
      return;
    }
    if (!current) return;
    const done = Boolean(current.brief_approved) && totalAssets(current) > 0;
    api.trackEvent(done ? 'primary_path_completed' : 'primary_path_started', {
      stage: done ? 'asset_created' : current.brief_approved ? 'brief_approved' : 'brief_incomplete',
      entitlement,
    });
    // Fires once per resolved campaign context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, campaign]);

  // ── No campaign chosen: resolve one first. ──
  if (!campaign) {
    return (
      <div className="flow">
        <section className="flow-main is-wide">
          <div className="studio-head">
            <div>
              <h2>Create</h2>
              <p className="flow-muted">
                Choose the campaign this work belongs to. Every asset uses that campaign’s
                approved brief and your Brand Profile, so the offer, audience and CTA stay consistent.
              </p>
            </div>
          </div>

          {error && (
            <div className="flow-card" role="alert">
              <p className="flow-err" style={{ marginTop: 0 }}>{error}</p>
              <p className="flow-muted" style={{ marginBottom: 0 }}>
                Nothing was lost. <button className="account-link" onClick={load}>Try again</button>
              </p>
            </div>
          )}

          {campaigns === null && (
            <div className="flow-card" aria-busy="true">
              <p className="flow-muted" style={{ margin: 0 }}>Loading your campaigns…</p>
            </div>
          )}

          {campaigns && campaigns.length === 0 && !error && (
            // v13 SC-P1-10: new/empty workspace — guide the one path (Brand
            // Profile → Campaign Brief → first reviewed asset), not the five
            // studios. Steps come from the typed empty-workspace state.
            <div className="flow-card">
              <ErrorState state={emptyWorkspaceState()} />
            </div>
          )}

          {campaigns && campaigns.length > 0 && (
            <>
              {campaigns.filter((c) => !c.archived).map((c) => (
                <div className="flow-card" key={c.id}>
                  <div className="kit-item-title">{c.name}</div>
                  <p className="flow-muted" style={{ marginTop: 4 }}>
                    {c.brief_approved
                      ? `Brief v${c.brief_version || 1} approved · ${totalAssets(c)} asset${totalAssets(c) === 1 ? '' : 's'}`
                      : 'Brief not approved yet — complete it first so assets stay consistent.'}
                  </p>
                  <Link
                    className={c.brief_approved ? 'flow-btn' : 'flow-btn is-ghost'}
                    style={{ display: 'inline-block', textDecoration: 'none' }}
                    to={c.brief_approved ? `/app/create?campaign=${c.id}` : sectionPath(c.id, 'brief')}
                  >
                    {c.brief_approved ? 'Create for this campaign' : 'Complete brief'}
                  </Link>
                </div>
              ))}
              <p className="flow-muted">
                Need a different one? <Link to="/app/campaigns">Go to Campaigns →</Link>
              </p>
            </>
          )}
        </section>
      </div>
    );
  }

  // ── Campaign in context: the five canonical creation paths. ──
  return (
    <div className="flow">
      <section className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>Create for {current?.name || 'your campaign'}</h2>
            <p className="flow-muted">
              Choose the next asset. Every generation uses this campaign’s approved brief and your Brand Profile.
            </p>
          </div>
        </div>

        {current && !current.brief_approved && (
          <div className="flow-card" role="status">
            <p style={{ margin: 0 }}>
              This campaign’s brief isn’t approved yet. Approving it first keeps every asset consistent.{' '}
              <Link to={sectionPath(current.id, 'brief')}>Complete brief →</Link>
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
