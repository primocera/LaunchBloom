import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Flow from './routes/Flow';
import KitDetail from './routes/KitDetail';
import Landing from './routes/Landing';
import Login from './routes/Login';

export default function App() {
  return (
    <Routes>
      {/* Public: the landing is the homepage. */}
      <Route path="/" element={<Landing />} />
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
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
