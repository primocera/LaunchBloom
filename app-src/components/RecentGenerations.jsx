import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// The user's last AI runs, failed ones included, so they can see what they
// did and whether it used an AI action. Successful output lives in the studio
// (and the Library below); a failed run saved nothing, so it has no link.

// usage_events.action → what the run was and where its output is kept.
const ACTIONS = {
  'generate-website-kit': ['Website copy', '/app/website'],
  'generate-email-flow': ['Email flow', '/app/email-studio'],
  'generate-campaign-emails': ['Campaign emails', '/app/email-studio'],
  'email-subject': ['Email subject rewrite', '/app/email-studio'],
  'email-body': ['Email body rewrite', '/app/email-studio'],
  'email-variants': ['Email variants', '/app/email-studio'],
  'generate-social-assets': ['Social posts', '/app/social'],
  'generate-creative-assets': ['Ads & creative', '/app/creative'],
  'generate-seo-ideas': ['SEO ideas', '/app/seo'],
  'api-campaigns-strategy': ['Campaign strategy', '/app/campaigns'],
  'api-ai-asset-rewrite': ['AI rewrite', '/app/assets'],
  'generate-launch-kit': ['Campaign package', null],
  'generate-offers': ['Offer ideas', null],
  'generate-positioning': ['Positioning', null],
  'regenerate-section': ['Section regenerated', null],
};

// A run can't take longer than the server's 300s limit; a reservation older
// than this never finished and is still counted.
const STUCK_MS = 6 * 60 * 1000;

function result(item) {
  if (item.status === 'succeeded') return { text: 'Saved', tone: 'is-ok' };
  if (item.status === 'failed') return { text: 'Failed · not counted', tone: 'is-bad' };
  if (item.status === 'released') return { text: 'Stopped · not counted', tone: '' };
  const age = Date.now() - new Date(item.created_at).getTime();
  return age > STUCK_MS
    ? { text: 'Did not finish · counted', tone: 'is-bad' }
    : { text: 'Running…', tone: '' };
}

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function RecentGenerations() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.recentGenerations()
      .then((r) => { if (live) setItems(r.items || []); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  return (
    <details className="account-section recent-gens" open>
      <summary><h2>Recent generations</h2></summary>
      {error && <p className="login-err">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <p className="muted">No generations yet. Everything you generate shows up here.</p>}
      {items && items.length > 0 && (
        <ul className="recent-gens-list">
          {items.map((item) => {
            const [label, to] = ACTIONS[item.action] || ['AI generation', null];
            const r = result(item);
            return (
              <li key={item.id}>
                <span className="recent-gens-when">{when(item.created_at)}</span>
                <span className="recent-gens-what">{label}</span>
                <span className={`campaign-badge ${r.tone}`}>{r.text}</span>
                {item.status === 'succeeded' && to && <Link className="account-link" to={to}>Open</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
