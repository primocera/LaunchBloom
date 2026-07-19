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
  const [accept, setAccept] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Already signed in? If a plan was picked on the landing page, resume its
  // checkout; otherwise send them to the app.
  useEffect(() => {
    if (!account) return;
    resumePendingCheckout()
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
    if (!accept) {
      setError('Please accept the Terms and Privacy Policy.');
      return;
    }
    setBusy(true);
    setError(null);

    const address = email.trim();
    try {
      const data = await signup(address, password, accept, marketing);
      // Email confirmation required: show a "check your inbox" notice and stop.
      if (data && data.requiresVerification) {
        setDone(true);
        setBusy(false);
        return;
      }
      if (await resumePendingCheckout()) return;
      navigate('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
          <h1>Verify your email to continue</h1>
          <p>
            We sent a secure link to <strong>{email.trim()}</strong>. Open it on this device to
            return to your saved setup.
          </p>
          <p className="login-alt">
            <Link to="/app/login">Send a new verification link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
        <h1>Create your LaunchBloom workspace</h1>
        <p>Set up your brand and campaign brief free. You’ll choose a plan only when you’re ready to generate.</p>

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
        <label className="consent">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            I agree to the <Link to="/legal/terms">Terms</Link> and{' '}
            <Link to="/legal/privacy">Privacy Policy</Link>.
          </span>
        </label>
        <label className="consent">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>Send me occasional product tips and updates (optional).</span>
        </label>
        <button
          className="btn-primary"
          type="submit"
          disabled={busy || !email.trim() || password.length < 8 || !confirm || !accept}
        >
          {busy ? 'Creating workspace...' : 'Create workspace'}
        </button>

        {error && <p className="login-err">{error}</p>}

        <p className="login-alt">
          Already have an account? <Link to="/app/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
