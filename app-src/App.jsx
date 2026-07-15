import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { ExpandIcon } from './components/icons';
import { useAuth } from './lib/auth';
import Dashboard from './routes/Dashboard';
import Flow from './routes/Flow';
import KitDetail from './routes/KitDetail';
import Landing from './routes/Landing';
import Login from './routes/Login';
import Signup from './routes/Signup';
import ForgotPassword from './routes/ForgotPassword';
import ResetPassword from './routes/ResetPassword';
import Legal from './routes/Legal';
import Account from './routes/Account';
import BrandProfile from './routes/BrandProfile';
import Campaigns from './routes/Campaigns';
import AssetLibrary from './routes/AssetLibrary';
import AdsStudio from './routes/studios/AdsStudio';
import ContentStudio from './routes/studios/ContentStudio';
import EmailStudio from './routes/studios/EmailStudio';
import LandingStudio from './routes/studios/LandingStudio';
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Signed-in area: ConversionForge-style shell — collapsible left sidebar
 * (Dashboard, Launch Flow, Studios, account) + scrollable main pane.
 */
function AppShell() {
  const { account, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) return null;
  if (!account) return <Navigate to="/app/login" replace />;

  return (
    <div className={collapsed ? 'shell is-collapsed' : 'shell'}>
      {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}

      <main className="main">
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
          <Route path="/assets" element={<AssetLibrary />} />
          <Route path="/account" element={<Account />} />
          <Route path="/flow" element={<Flow />} />
          <Route path="/kits/:id" element={<KitDetail />} />
          {/* Studios, Prompts 18-23 */}
          <Route path="/landing-page" element={<LandingStudio />} />
          <Route path="/content-plan" element={<ContentStudio />} />
          <Route path="/email-sequence" element={<EmailStudio />} />
          <Route path="/ads" element={<AdsStudio />} />
          <Route path="/seo" element={<SeoStudio />} />
          <Route path="/weekly-plan" element={<WeeklyPlan />} />
          {/* Marketing-asset generator studios (Upgrade prompts 16-18) */}
          <Route path="/website" element={<WebsiteStudio />} />
          <Route path="/email-studio" element={<EmailFlowStudio />} />
          <Route path="/social" element={<SocialStudio />} />
          <Route path="/creative" element={<CreativeStudio />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}
