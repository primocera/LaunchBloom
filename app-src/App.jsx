import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Flow from './routes/Flow';
import KitDetail from './routes/KitDetail';
import Landing from './routes/Landing';
import Login from './routes/Login';
import AdsStudio from './routes/studios/AdsStudio';
import ContentStudio from './routes/studios/ContentStudio';
import EmailStudio from './routes/studios/EmailStudio';
import LandingStudio from './routes/studios/LandingStudio';
import SeoStudio from './routes/studios/SeoStudio';
import WeeklyPlan from './routes/studios/WeeklyPlan';

export default function App() {
  return (
    <Routes>
      {/* Public: the landing is the homepage. */}
      <Route path="/" element={<Landing />} />
      {/* Dev alias: vite dev serves under /app/, where "/" is unreachable. */}
      <Route path="/app/home" element={<Landing />} />
      <Route path="/app/login" element={<Login />} />
      <Route path="/app/*" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Signed-in area: the guided flow. Signed-out visitors go to login. */
function AppShell() {
  const { account, loading } = useAuth();

  if (loading) return null;
  if (!account) return <Navigate to="/app/login" replace />;

  return (
    <Routes>
      <Route path="/" element={<Flow />} />
      <Route path="/kits/:id" element={<KitDetail />} />
      {/* Studios, Prompts 18-23 */}
      <Route path="/landing-page" element={<LandingStudio />} />
      <Route path="/content-plan" element={<ContentStudio />} />
      <Route path="/email-sequence" element={<EmailStudio />} />
      <Route path="/ads" element={<AdsStudio />} />
      <Route path="/seo" element={<SeoStudio />} />
      <Route path="/weekly-plan" element={<WeeklyPlan />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
