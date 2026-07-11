import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

/** Hand off to Stripe using the account we just signed in as. */
async function startCheckout(priceId, email) {
  const data = await api.checkout(priceId, email);
  if (!data.url) throw new Error('Could not start checkout.');
  window.location.href = data.url;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const address = email.trim();
    try {
      await login(address);

      // Resume whatever they were doing before we interrupted them.
      const pendingPlan = localStorage.getItem('of-pending-plan');
      if (pendingPlan) {
        localStorage.removeItem('of-pending-plan');
        await startCheckout(pendingPlan, address);
        return; // the browser is navigating to Stripe
      }

      navigate('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" style={{ margin: '0 auto' }}>
          OF
        </div>
        <h1>Sign in to OfferFlow AI</h1>
        <p>No password. Enter your email and we'll pick up where you left off.</p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          aria-label="Email address"
        />
        <button className="btn-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Signing in...' : 'Continue'}
        </button>

        {error && <p className="login-err">{error}</p>}
      </form>
    </div>
  );
}
