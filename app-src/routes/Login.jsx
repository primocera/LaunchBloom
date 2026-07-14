import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import BloomMark from '../components/BloomMark';

// ---------------------------------------------------------------------------
// Prompt 8: email/password sign-in. Friendly errors, loading state, and a
// redirect: already-signed-in visitors go straight to the dashboard.
// ---------------------------------------------------------------------------

/** Hand off to Stripe using the account we just signed in as. */
export async function resumePendingCheckout(email) {
  const pendingPlan = localStorage.getItem('of-pending-plan');
  if (!pendingPlan) return false;
  const pendingInterval = localStorage.getItem('of-pending-interval') || 'monthly';
  localStorage.removeItem('of-pending-plan');
  localStorage.removeItem('of-pending-interval');
  const data = await api.checkout(pendingPlan, email, pendingInterval);
  if (!data.url) throw new Error('Could not start checkout.');
  window.location.href = data.url;
  return true; // the browser is navigating to Stripe
}

export default function Login() {
  const { account, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Logged-in users don't belong on /login. If they arrived here with a plan
  // picked on the landing page, hand off to Stripe; otherwise go to the app.
  useEffect(() => {
    if (!account) return;
    resumePendingCheckout(account.email)
      .then((going) => { if (!going) navigate('/app', { replace: true }); })
      .catch(() => navigate('/app', { replace: true }));
  }, [account, navigate]);
  if (account) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const address = email.trim();
    try {
      await login(address, password);
      if (await resumePendingCheckout(address)) return;
      navigate('/app');
    } catch (err) {
      if (err.code === 'NO_ACCOUNT') {
        setError('No account with this email yet — create one below.');
      } else {
        setError(err.message);
      }
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
        <h1>Welcome back</h1>
        <p>Sign in to continue building your launch.</p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          aria-label="Email address"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
          minLength={8}
          aria-label="Password"
        />
        <button className="btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>

        {error && <p className="login-err">{error}</p>}

        <p className="login-alt">
          New here? <Link to="/app/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
