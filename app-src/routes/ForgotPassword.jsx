import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import AuthLayout from '../components/AuthLayout';

// Prompt 3: request a password reset. The response is always generic so it
// never reveals whether an account exists for the email.
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
    } catch {
      /* generic regardless */
    }
    setSent(true);
    setBusy(false);
  }

  return (
    <AuthLayout>
      <div className="login-card">
        {sent ? (
          <>
            <h1>Check your inbox</h1>
            <p>If an account exists for that email, a password reset link is on its way.</p>
            <p className="login-alt"><Link to="/app/login">Back to sign in</Link></p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1>Reset your password</h1>
            <p>Enter your email and we'll send you a reset link.</p>
            <div className="field">
              <label htmlFor="forgot-email">Email address</label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <button className="btn-primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending...' : 'Send reset link'}
            </button>
            <p className="login-alt"><Link to="/app/login">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
