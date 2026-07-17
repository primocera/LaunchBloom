import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { homePlan } from '../lib/next-actions';
import '../flow.css';

// ---------------------------------------------------------------------------
// v5 Prompt 4: Home as an action dashboard. One greeting row with a single
// context-aware primary action, "continue where you left off", up to three
// next best actions, active campaigns and recent assets. Detailed usage lives
// in Account — Home only shows a compact warning at 80% / 100%.
// ---------------------------------------------------------------------------

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

export default function Dashboard() {
  const { account } = useAuth();
  const [profile, setProfile] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [assets, setAssets] = useState(null);
  const [dash, setDash] = useState(null);

  useEffect(() => {
    api.brandProfile().then((r) => setProfile(r.profile || r)).catch(() => setProfile({}));
    api.campaigns().then((r) => setCampaigns(r.campaigns || [])).catch(() => setCampaigns([]));
    api.library({ limit: 6 }).then((r) => setAssets(r.items || r.assets || [])).catch(() => setAssets([]));
    api.dashboard().then(setDash).catch(() => setDash({}));
  }, []);

  const loading = profile === null || campaigns === null || assets === null || dash === null;
  const name = account?.email?.split('@')[0] || 'there';

  if (loading) {
    return (
      <div className="flow dash">
        <div className="flow-main is-wide">
          <h2 className="flow-h2">Your marketing workspace</h2>
          <div className="dash-grid">
            {[...Array(4)].map((_, i) => <div className="flow-card dash-skeleton" key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  const { primary, actions, usageLevel } = homePlan({
    profile,
    campaigns,
    assets,
    kit: dash?.kit || null,
    account,
    plan: account?.plan,
  });

  const activeCampaigns = (campaigns || []).filter((c) => c.status !== 'archived').slice(0, 3);
  const recent = (assets || []).slice(0, 5);
  const latest = recent[0];

  return (
    <div className="flow dash">
      <div className="flow-main is-wide">
        {/* ── Top: greeting, workspace context, ONE primary action ── */}
        <div className="dash-hero">
          <div>
            <h2 className="flow-h2">Hi {name} — your marketing workspace</h2>
            {account?.plan === 'trial' && <p className="flow-muted">You're on the 3-day trial.</p>}
          </div>
          <Link className="flow-btn dash-primary" to={primary.to}>{primary.label}</Link>
        </div>

        {/* Compact usage warning only at 80% / 100% — details live in Account */}
        {usageLevel !== 'ok' && (
          <p className={usageLevel === 'over' ? 'flow-err' : 'dash-usage-warn'} role="status">
            {usageLevel === 'over'
              ? "You've used all AI actions for this period. "
              : "You've used over 80% of your AI actions. "}
            <Link to="/app/account">See usage &amp; plan</Link>
          </p>
        )}

        <div className="dash-grid">
          {/* ── Continue where you left off ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Continue where you left off</div>
            {latest ? (
              <>
                <h3>{latest.title || latest.type || 'Recent asset'}</h3>
                <p className="flow-muted dash-small">
                  {[latest.type, latest.status, relTime(latest.updated_at || latest.created_at)].filter(Boolean).join(' · ')}
                </p>
                <Link className="flow-btn is-ghost" to="/app/assets">Open in Library</Link>
              </>
            ) : (
              <>
                <p className="flow-muted">Create your first campaign — everything you generate stays organized under it.</p>
                <Link className="flow-btn is-ghost" to="/app/campaigns">Create your first campaign</Link>
              </>
            )}
          </div>

          {/* ── Next best actions (max 3, derived — never static) ── */}
          {actions.length > 0 && (
            <div className="flow-card">
              <div className="flow-eyebrow">Next best actions</div>
              <ul className="kit-outline dash-kit-links">
                {actions.map((a) => (
                  <li key={a.label}>
                    <Link to={a.to}>{a.label} →</Link>
                    <div className="kit-item-meta">{a.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Active campaigns ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Campaigns</div>
            {activeCampaigns.length ? (
              <div className="kit-items">
                {activeCampaigns.map((c) => {
                  const count = Object.values(c.asset_counts || {}).reduce((a, b) => a + b, 0);
                  return (
                    <div className="kit-item" key={c.id}>
                      <div className="kit-item-title">{c.name}</div>
                      <div className="kit-item-meta">
                        {count} asset{count === 1 ? '' : 's'}
                        {c.end_date ? ` · ends ${new Date(c.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                      </div>
                    </div>
                  );
                })}
                <Link className="flow-link" to="/app/campaigns">All campaigns →</Link>
              </div>
            ) : (
              <>
                <p className="flow-muted">Plan a launch, promotion or content month around one brief.</p>
                <Link className="flow-link" to="/app/campaigns">Create your first campaign →</Link>
              </>
            )}
          </div>

          {/* ── Recent assets ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Recent assets</div>
            {recent.length ? (
              <div className="kit-items">
                {recent.map((a) => (
                  <div className="kit-item" key={`${a.table || a.type}-${a.id}`}>
                    <div className="kit-item-title">{a.title || a.type}</div>
                    <div className="kit-item-meta">
                      {[a.type, a.status || 'draft', relTime(a.updated_at || a.created_at)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
                <Link className="flow-link" to="/app/assets">Open Library →</Link>
              </div>
            ) : (
              <>
                <p className="flow-muted">Generate your first asset — website copy, emails, captions or ads.</p>
                <Link className="flow-link" to="/app/create">Open Create →</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
