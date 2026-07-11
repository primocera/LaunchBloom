import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Shared scaffolding for the studios (Prompts 18-23): the shell with studio
// navigation, the launch-kit selector ("User can select a launch kit if
// multiple exist"), and copy buttons with a success state (Prompt 29).
// ---------------------------------------------------------------------------

export const STUDIO_LINKS = [
  ['/app/landing-page', 'Landing Page'],
  ['/app/content-plan', 'Content Plan'],
  ['/app/email-sequence', 'Emails'],
  ['/app/ads', 'Ads'],
  ['/app/seo', 'SEO'],
  ['/app/weekly-plan', 'Weekly Plan'],
];

export function StudioShell({ title, blurb, kits, kitId, onSelectKit, children }) {
  const { account, logout } = useAuth();

  return (
    <div className="flow">
      <header className="flow-head">
        <Link to="/app" className="flow-brand">OfferFlow AI</Link>
        <nav className="studio-nav">
          {STUDIO_LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'kit-tab is-on' : 'kit-tab')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flow-account">
          <span className="flow-credits">{account?.plan_label || 'Free'} plan</span>
          <button className="flow-link" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>{title}</h2>
            {blurb && <p className="flow-muted">{blurb}</p>}
          </div>
          {kits && kits.length > 1 && (
            <select className="studio-select" value={kitId || ''} onChange={(e) => onSelectKit(e.target.value)}>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>{k.title || 'Launch kit'}</option>
              ))}
            </select>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

/** Loads the caller's kits and keeps a selected one (latest by default). */
export function useKits() {
  const [kits, setKits] = useState(null);
  const [kitId, setKitId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.launchKits()
      .then((r) => {
        setKits(r.launch_kits);
        if (r.launch_kits[0]) setKitId(r.launch_kits[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  return { kits, kitId, setKitId, error, setError };
}

export function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="kit-copy"
      onClick={() => {
        navigator.clipboard?.writeText(typeof text === 'function' ? text() : text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

/** "No kit yet" empty state shared by every studio. */
export function NoKit() {
  return (
    <div className="flow-card">
      <h3>No launch kit yet</h3>
      <p className="flow-muted">Build your first launch kit and this studio fills up automatically.</p>
      <Link className="flow-btn" to="/app">Go to the flow</Link>
    </div>
  );
}

/** Confirm + regenerate a section, returns busy flag. */
export function useRegenerate(kitId, section, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function regenerate() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Replace the current version? The existing content will be lost.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.regenerateSection(kitId, section);
      onDone(r.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return { regenerate, busy, error };
}
