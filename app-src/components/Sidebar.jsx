import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BRAND } from '../brand';
import BloomMark from './BloomMark';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { CollapseIcon, PagesIcon, SavedIcon, TrendsIcon } from './icons';

// ---------------------------------------------------------------------------
// Left sidebar, same shell pattern as ConversionForge: brand, nav (Dashboard,
// Launch Flow, the five studios), and the account block with plan + usage.
// ---------------------------------------------------------------------------

// v5 Prompt 3: canonical navigation — Home, Brand, Campaigns, Create, Library,
// Account. One asset model, no duplicate generator destinations. The full
// launch workflow lives inside Campaigns as the "Full launch campaign"
// template; the old per-section legacy routes redirect to their studio.
const MAIN_NAV = [
  { to: '/app', label: 'Home', Icon: PagesIcon, end: true },
  { to: '/app/brand', label: 'Brand', Icon: SavedIcon },
  { to: '/app/campaigns', label: 'Campaigns', Icon: TrendsIcon },
  { to: '/app/create', label: 'Create', Icon: TrendsIcon },
  { to: '/app/assets', label: 'Library', Icon: PagesIcon },
  { to: '/app/account', label: 'Account', Icon: SavedIcon },
];

const STUDIO_NAV = [
  { to: '/app/website', label: 'Website' },
  { to: '/app/email-studio', label: 'Email' },
  { to: '/app/social', label: 'Social' },
  { to: '/app/creative', label: 'Ads & Creative' },
  { to: '/app/seo', label: 'SEO Ideas' },
];

function AccountBlock() {
  const { account, logout } = useAuth();

  if (!account) {
    return (
      <div className="account">
        <Link className="account-signin" to="/app/login">Sign in</Link>
        <div className="account-hint">Create your account free. Start a 3-day trial when you're ready to generate.</div>
      </div>
    );
  }

  const name = account.email.split('@')[0];
  const { usage, limits, plan_label: planLabel } = account;
  const unlimited = !limits || limits.ai_actions == null;
  const used = usage?.ai_actions ?? 0;
  const limit = limits?.ai_actions ?? 0;
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <div className="account">
      <div className="account-row">
        <div className="avatar">{name.charAt(0).toUpperCase()}</div>
        <div className="account-name">{name}</div>
      </div>

      <div className="meter">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>

      {unlimited ? (
        <div className="account-usage">Unlimited AI actions</div>
      ) : (
        <div className="account-usage">
          {used}/{limit} AI action{limit === 1 ? '' : 's'} {limits?.monthly ? 'this month' : 'used'}
        </div>
      )}
      <div className="account-hint">
        {planLabel || 'Free'} plan
        {' '}&middot;{' '}
        <Link className="account-link" to="/app/account">Account &amp; billing</Link>
        {' '}&middot;{' '}
        <button className="account-link" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

export default function Sidebar({ onCollapse }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <div className="brand-mark"><BloomMark /></div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="brand-sub">AI marketing workspace</div>
          </div>
        </Link>
        <button className="icon-btn" onClick={onCollapse} aria-label="Collapse sidebar">
          <CollapseIcon />
        </button>
      </div>

      <WorkspaceSwitcher />

      <nav className="sidebar-nav">
        {MAIN_NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-section">
        <div className="section-head">
          <span className="section-title">Create</span>
        </div>
        <nav className="sidebar-nav is-sub">
          {STUDIO_NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            >
              <SavedIcon />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <AccountBlock />
    </aside>
  );
}
