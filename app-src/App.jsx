import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { ExpandIcon } from './components/icons';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import Dashboard from './routes/Dashboard';
import Flow from './routes/Flow';
import KitDetail from './routes/KitDetail';
import Landing from './routes/Landing';
import Login from './routes/Login';
import Signup from './routes/Signup';
import ForgotPassword from './routes/ForgotPassword';
import ResetPassword from './routes/ResetPassword';
import Legal from './routes/Legal';
import NotFound from './routes/NotFound';
import FeedbackWidget from './components/FeedbackWidget';
import Account from './routes/Account';
import BrandProfile from './routes/BrandProfile';
import Campaigns from './routes/Campaigns';
import AssetLibrary from './routes/AssetLibrary';
import Create from './routes/Create';
import SeoStudio from './routes/studios/SeoStudio';
import WeeklyPlan from './routes/studios/WeeklyPlan';
// Upgrade prompts 16-18: marketing-asset generator studios
import WebsiteStudio from './routes/studios/WebsiteStudio';
import EmailFlowStudio from './routes/studios/EmailFlowStudio';
import SocialStudio from './routes/studios/SocialStudio';
import CreativeStudio from './routes/studios/CreativeStudio';

export default function App() {
  return (
    <Routes>
      {/* Public: the landing is the homepage. */}
      <Route path="/" element={<Landing />} />
      {/* Dev alias: vite dev serves under /app/, where "/" is unreachable. */}
      <Route path="/app/home" element={<Landing />} />
      <Route path="/app/login" element={<Login />} />
      <Route path="/app/signup" element={<Signup />} />
      <Route path="/app/forgot-password" element={<ForgotPassword />} />
      <Route path="/app/reset-password" element={<ResetPassword />} />
      <Route path="/legal/:slug" element={<Legal />} />
      <Route path="/app/*" element={<AppShell />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/**
 * Signed-in area: ConversionForge-style shell — collapsible left sidebar
 * (Dashboard, Launch Flow, Studios, account) + scrollable main pane.
 */
/**
 * v5 Prompt 2: checkout return + trial-ending notices.
 * - ?checkout=success|cancelled comes back from Stripe Checkout.
 * - In the final 24 hours of a trial a compact global banner shows the exact
 *   charge date with a link to Account & billing.
 */
function ShellNotices() {
  const [params, setParams] = useSearchParams();
  const checkout = params.get('checkout');
  const [billing, setBilling] = useState(null);

  useEffect(() => {
    api.billing().then(setBilling).catch(() => {});
  }, [checkout]);

  function dismiss() {
    const next = new URLSearchParams(params);
    next.delete('checkout');
    next.delete('plan');
    next.delete('interval');
    setParams(next, { replace: true });
  }

  const sub = billing?.subscription;
  const trialEndsSoon =
    sub?.status === 'trialing' && sub.trial_end &&
    new Date(sub.trial_end).getTime() - Date.now() < 24 * 60 * 60 * 1000;
  const chargeDate = sub?.next_charge_at
    ? new Date(sub.next_charge_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;

  if (checkout === 'success') {
    return (
      <div className="shell-notice" role="status">
        Your 3-day free trial has started. {chargeDate ? `You'll be charged on ${chargeDate} unless you cancel before then. ` : ''}
        <Link to="/app/account">Manage billing</Link>{' '}
        <button className="account-link" onClick={dismiss}>Dismiss</button>
      </div>
    );
  }
  if (checkout === 'cancelled') {
    return (
      <div className="shell-notice" role="status">
        Checkout cancelled — nothing was charged and your work is saved.{' '}
        <button className="account-link" onClick={dismiss}>Dismiss</button>
      </div>
    );
  }
  if (trialEndsSoon) {
    return (
      <div className="shell-notice is-warn" role="status">
        Your trial ends soon{chargeDate ? ` — you'll be charged on ${chargeDate} unless you cancel before then` : ''}.{' '}
        <Link to="/app/account">Account &amp; billing</Link>
      </div>
    );
  }
  return null;
}

function AppShell() {
  const { account, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) return null;
  if (!account) return <Navigate to="/app/login" replace />;

  return (
    <div className={collapsed ? 'shell is-collapsed' : 'shell'}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}

      <main className="main" id="main-content">
        <ShellNotices />
        {collapsed && (
          <button
            className="icon-btn rail"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
          >
            <ExpandIcon />
          </button>
        )}

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/brand" element={<BrandProfile />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/create" element={<Create />} />
          <Route path="/assets" element={<AssetLibrary />} />
          <Route path="/account" element={<Account />} />
          {/* Full launch workflow — a campaign template inside Campaigns (v5 P3) */}
          <Route path="/flow" element={<Flow />} />
          <Route path="/kits/:id" element={<KitDetail />} />
          <Route path="/weekly-plan" element={<WeeklyPlan />} />
          {/* The five canonical studios */}
          <Route path="/website" element={<WebsiteStudio />} />
          <Route path="/email-studio" element={<EmailFlowStudio />} />
          <Route path="/social" element={<SocialStudio />} />
          <Route path="/creative" element={<CreativeStudio />} />
          <Route path="/seo" element={<SeoStudio />} />
          {/* v5 P3: legacy "Launch Kit: …" routes redirect to their studio.
              Existing kit data stays reachable via /app/flow and /app/kits/:id. */}
          <Route path="/landing-page" element={<Navigate to="/app/website" replace />} />
          <Route path="/content-plan" element={<Navigate to="/app/social" replace />} />
          <Route path="/email-sequence" element={<Navigate to="/app/email-studio" replace />} />
          <Route path="/ads" element={<Navigate to="/app/creative" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <FeedbackWidget />
    </div>
  );
}
