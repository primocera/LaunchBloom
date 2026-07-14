import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import BloomMark from '../components/BloomMark';

// ---------------------------------------------------------------------------
// Prompt 8: email/password sign-in. Friendly errors, loading state, and a
// redirect: already-signed-in visitors go straight to the dashboard.
// ---------------------------------------------------------------------------

/**
 * Hand off to Stripe. The customer is derived from the signed-in session
 * server-side, so no email is passed from the client (Prompt 4).
 */
export async function resumePendingCheckout() {
  const pendingPlan = localStorage.getItem('of-pending-plan');
  if (!pendingPlan) return false;
  const pendingInterval = localStorage.getItem('of-pending-interval') || 'monthly';
  localStorage.removeItem('of-pending-plan');
  localStorage.removeItem('of-pending-interval');
  const data = await api.checkout(pendingPlan, pendingInterval);
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
  const [unverified, setUnverified] = useState(false);
  const [notice, setNotice] = useState(null);

  // The email-link callback redirects here with ?error=expired_link when a
  // verification/recovery link is stale.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'expired_link') {
      setError('That link has expired or was already used. Sign in or request a new one.');
    }
  }, []);

  // Logged-in users don't belong on /login. If they arrived here with a plan
  // picked on the landing page, hand off to Stripe; otherwise go to the app.
  useEffect(() => {
    if (!account) return;
    resumePendingCheckout()
      .then((going) => { if (!going) navigate('/app', { replace: true }); })
      .catch(() => navigate('/app', { replace: true }));
  }, [account, navigate]);
  if (account) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    setNotice(null);

    const address = email.trim();
    try {
      await login(address, password);
      if (await resumePendingCheckout()) return;
      navigate('/app');
    } catch (err) {
      if (err.code === 'EMAIL_NOT_CONFIRMED') {
        setUnverified(true);
        setError('Please verify your email first — check your inbox for the link.');
      } else {
        setError(err.message);
      }
      setBusy(false);
    }
  }

  async function resend() {
    setNotice(null);
    try {
      await api.resendVerification(email.trim());
      setNotice('Verification email sent. Check your inbox.');
    } catch {
      setNotice('Verification email sent. Check your inbox.');
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
        {unverified && (
          <p className="login-alt">
            <button type="button" className="link-btn" onClick={resend}>Resend verification email</button>
          </p>
        )}
        {notice && <p className="login-note">{notice}</p>}

        <p className="login-alt">
          <Link to="/app/forgot-password">Forgot your password?</Link>
        </p>
        <p className="login-alt">
          New here? <Link to="/app/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
