import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import '../flow.css';

// ---------------------------------------------------------------------------
// Prompt 10: the dashboard. Six cards — Brand Snapshot, Current Offer,
// This Week, Launch Kit, Quick Generate, Progress — real Supabase data via
// /api/workspace/dashboard, graceful empty states, skeleton loading.
// ---------------------------------------------------------------------------

const STUDIOS = [
  ['/app/landing-page', 'Landing page'],
  ['/app/content-plan', 'Content plan'],
  ['/app/email-sequence', 'Email sequence'],
  ['/app/ads', 'Ads'],
  ['/app/seo', 'SEO'],
  ['/app/weekly-plan', 'Weekly action plan'],
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    return api.dashboard().then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function run(name, fn) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleTask(task) {
    try {
      await api.updateItem('weekly_tasks', task.id, { completed: !task.completed });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !data) {
    return (
      <div className="flow dash">
        <div className="flow-main is-wide"><p className="flow-err">{error}</p></div>
      </div>
    );
  }

  // Skeleton while loading
  if (!data) {
    return (
      <div className="flow dash">
        <div className="flow-main is-wide">
          <h2 className="flow-h2">Dashboard</h2>
          <div className="dash-grid">
            {[...Array(6)].map((_, i) => <div className="flow-card dash-skeleton" key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  const { onboarding, positioning, offer, kit, this_week: thisWeek, progress } = data;

  return (
    <div className="flow dash">
      <div className="flow-main is-wide">
        <h2 className="flow-h2">Dashboard</h2>
        {error && <p className="flow-err">{error}</p>}

        <div className="dash-grid">
          {/* ── 1. Brand Snapshot ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Brand snapshot</div>
            {positioning ? (
              <>
                <h3>{positioning.recommended_niche?.niche}</h3>
                <p className="flow-muted">{positioning.positioning_statement}</p>
                <div className="flow-k">Ideal customer</div>
                <p className="dash-small">{positioning.ideal_customer?.description}</p>
                {onboarding?.platforms?.length > 0 && (
                  <>
                    <div className="flow-k">Main platforms</div>
                    <p className="dash-small">{onboarding.platforms.join(', ')}</p>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="flow-muted">No positioning yet — answer a few questions and we'll build it.</p>
                <Link className="flow-btn" to="/app/flow">Start with onboarding</Link>
              </>
            )}
          </div>

          {/* ── 2. Current Offer ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Current offer</div>
            {offer ? (
              <>
                <h3>{offer.offer_name}</h3>
                <p className="flow-muted">{offer.promise}</p>
                <div className="flow-row" style={{ alignItems: 'center' }}>
                  <span className="offer-price">{offer.price_suggestion}</span>
                  <span className="kit-badge">{offer.status}</span>
                </div>
                <Link className="flow-btn is-ghost" to="/app/flow">Review offers</Link>
              </>
            ) : (
              <>
                <p className="flow-muted">No offer yet. Generate three options and pick the one that fits.</p>
                <Link className="flow-btn" to="/app/flow">Create an offer</Link>
              </>
            )}
          </div>

          {/* ── 3. This Week ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">This week</div>
            {thisWeek.length ? (
              <div className="kit-items">
                {thisWeek.map((t) => (
                  <label className="kit-item task-row" key={t.id}>
                    <input type="checkbox" checked={!!t.completed} onChange={() => toggleTask(t)} />
                    <div style={{ flex: 1 }}>
                      <div className="kit-item-title">{t.task_title}</div>
                      <div className="kit-item-meta">{[t.task_type, t.priority].filter(Boolean).join(' · ')}</div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <>
                <p className="flow-muted">No weekly plan yet — it comes with your launch kit.</p>
                <Link className="flow-btn" to="/app/flow">Generate launch kit</Link>
              </>
            )}
            {thisWeek.length > 0 && <Link className="flow-link" to="/app/weekly-plan">Open full weekly plan →</Link>}
          </div>

          {/* ── 4. Launch Kit ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Launch kit</div>
            {kit ? (
              <>
                <h3>{kit.title || 'Launch kit'}</h3>
                <p className="flow-muted dash-small">{kit.summary}</p>
                <ul className="kit-outline dash-kit-links">
                  {STUDIOS.map(([to, label]) => (
                    <li key={to}><Link to={to}>{label}</Link></li>
                  ))}
                </ul>
                <Link className="flow-btn is-ghost" to={`/app/kits/${kit.id}`}>Open kit overview</Link>
              </>
            ) : (
              <>
                <p className="flow-muted">Your launch kit will hold the landing page, content plan, emails, ads, SEO and weekly plan.</p>
                <Link className="flow-btn" to="/app/flow">Build my launch kit</Link>
              </>
            )}
          </div>

          {/* ── 5. Quick Generate ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Quick generate</div>
            <div className="dash-actions">
              <button
                className="flow-btn is-ghost"
                disabled={!!busy}
                onClick={() =>
                  onboarding
                    ? run('positioning', () => api.generatePositioning())
                    : navigate('/app/flow')
                }
              >
                {busy === 'positioning' ? 'Working…' : positioning ? 'Regenerate positioning' : 'Generate positioning'}
              </button>
              <button
                className="flow-btn is-ghost"
                disabled={!!busy}
                onClick={() =>
                  positioning
                    ? run('offers', () => api.generateOffers())
                    : navigate('/app/flow')
                }
              >
                {busy === 'offers' ? 'Working…' : 'Generate offer ideas'}
              </button>
              <button className="flow-btn is-ghost" disabled={!!busy} onClick={() => navigate('/app/flow')}>
                Generate launch kit
              </button>
              <button
                className="flow-btn is-ghost"
                disabled={!!busy || !kit}
                title={kit ? '' : 'Build a launch kit first'}
                onClick={() => run('weekly', () => api.regenerateSection(kit.id, 'weekly_plan'))}
              >
                {busy === 'weekly' ? 'Working…' : 'Generate weekly plan'}
              </button>
            </div>
          </div>

          {/* ── 6. Progress ── */}
          <div className="flow-card">
            <div className="flow-eyebrow">Progress</div>
            {progress ? (
              <div className="dash-stats">
                <div><div className="dash-num">{progress.posts_planned}</div><div className="flow-muted">posts planned</div></div>
                <div><div className="dash-num">{progress.emails_drafted}</div><div className="flow-muted">emails drafted</div></div>
                <div>
                  <div className="dash-num">{progress.landing_page_ready ? '✓' : '—'}</div>
                  <div className="flow-muted">landing page {progress.landing_page_ready ? 'ready' : 'missing'}</div>
                </div>
                <div>
                  <div className="dash-num">{progress.tasks_completed}/{progress.tasks_total}</div>
                  <div className="flow-muted">tasks completed</div>
                </div>
              </div>
            ) : (
              <p className="flow-muted">Progress shows up once your launch kit exists.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
