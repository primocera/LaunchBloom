import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { resumePendingCheckout } from './Login';
import BloomMark from '../components/BloomMark';

// ---------------------------------------------------------------------------
// Prompt 8: email/password sign-up. Creates the account, signs the user in,
// resumes a pending plan checkout if one was picked on the landing page.
// ---------------------------------------------------------------------------

export default function Signup() {
  const { account, signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Already signed in? If a plan was picked on the landing page, resume its
  // checkout; otherwise send them to the app.
  useEffect(() => {
    if (!account) return;
    resumePendingCheckout(account.email)
      .then((going) => { if (!going) navigate('/app', { replace: true }); })
      .catch(() => navigate('/app', { replace: true }));
  }, [account, navigate]);
  if (account) return null;

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);

    const address = email.trim();
    try {
      await signup(address, password);
      if (await resumePendingCheckout(address)) return;
      navigate('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
        <h1>Create your account</h1>
        <p>Free to start — your first launch kit is on us.</p>

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
          placeholder="Password (min 8 characters)"
          autoComplete="new-password"
          required
          minLength={8}
          aria-label="Password"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-label="Repeat password"
        />
        <button
          className="btn-primary"
          type="submit"
          disabled={busy || !email.trim() || password.length < 8 || !confirm}
        >
          {busy ? 'Creating account...' : 'Create account'}
        </button>

        {error && <p className="login-err">{error}</p>}

        <p className="login-alt">
          Already have an account? <Link to="/app/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
