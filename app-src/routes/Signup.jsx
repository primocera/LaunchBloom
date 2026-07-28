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
  // Which field the current error belongs to, so a screen reader hears it on
  // the control that caused it rather than only as loose text at the bottom.
  const [errorField, setErrorField] = useState(null);
  const [done, setDone] = useState(false);

  const fail = (field, message) => { setErrorField(field); setError(message); };
  const describedBy = (field) => (error && errorField === field ? 'signup-error' : undefined);
  const invalid = (field) => (error && errorField === field ? 'true' : undefined);

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
    if (busy) return; // a second Enter must not create a second account attempt
    if (password !== confirm) {
      fail('confirm', "Passwords don't match.");
      return;
    }
    if (!accept) {
      fail('accept', 'Please accept the Terms and Privacy Policy to create your workspace.');
      return;
    }
    setBusy(true);
    setError(null);
    setErrorField(null);

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
      // v7 LB-02: land new users in the 3-minute Brand Profile first run —
      // the first activation step — not on a generic dashboard.
      navigate('/app/brand?welcome=1');
    } catch (err) {
      // The email and both consent choices survive a recoverable failure; only
      // the passwords are re-entered, and only because they were never kept.
      fail('email', err.message);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
          <h1>Verify your email to continue</h1>
          {/* v11 SC-01: the link carries a token hash and is verified
              server-side, so it works from any device or browser. The previous
              wording described a same-device restriction that does not exist
              and sent people back to a phone they had already closed. */}
          <p>
            We sent a secure link to <strong>{email.trim()}</strong>. You can open it on any
            device — phone, laptop or tablet — and you’ll land back in your saved setup.
          </p>
          <p>
            Links expire, and each one can only be used once. If yours has expired or you already
            used it, request a new one below.
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
        <h1>Create your Scalvya workspace</h1>
        <p>Set up your brand and campaign brief free. You’ll choose a plan only when you’re ready to generate.</p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          aria-label="Email address"
          aria-required="true"
          aria-invalid={invalid('email')}
          aria-describedby={describedBy('email')}
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
          aria-required="true"
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
          aria-required="true"
          aria-invalid={invalid('confirm')}
          aria-describedby={describedBy('confirm')}
        />
        <label className="consent">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            aria-required="true"
            aria-invalid={invalid('accept')}
            aria-describedby={describedBy('accept')}
          />
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

        {error && <p className="login-err" id="signup-error" role="alert">{error}</p>}

        <p className="login-alt">
          Already have an account? <Link to="/app/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
