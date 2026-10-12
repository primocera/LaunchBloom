import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import AuthLayout from '../components/AuthLayout';

// Prompt 3: set a new password. The user reaches this page from the recovery
// email link, which the /api/auth/callback route exchanges for a short-lived
// recovery session cookie. reset-password uses that cookie server-side.
export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(password);
      navigate('/app', { replace: true });
    } catch (err) {
      if (err.status === 401) {
        setError('This reset link has expired. Request a new one.');
      } else {
        setError(err.message);
      }
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <div className="field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <span className="field-hint">At least 8 characters</span>
        </div>
        <div className="field">
          <label htmlFor="reset-confirm">Repeat new password</label>
          <input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <button className="btn-primary" type="submit" disabled={busy || password.length < 8 || !confirm}>
          {busy ? 'Saving...' : 'Update password'}
        </button>
        {error && <p className="login-err">{error}</p>}
        <p className="login-alt"><Link to="/app/forgot-password">Request a new link</Link></p>
      </form>
    </AuthLayout>
  );
}
