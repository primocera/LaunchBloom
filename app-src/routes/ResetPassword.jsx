import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import BloomMark from '../components/BloomMark';

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
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" style={{ margin: '0 auto' }}><BloomMark /></div>
        <h1>Choose a new password</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 8 characters)"
          autoComplete="new-password"
          required
          minLength={8}
          aria-label="New password"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat new password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-label="Repeat new password"
        />
        <button className="btn-primary" type="submit" disabled={busy || password.length < 8 || !confirm}>
          {busy ? 'Saving...' : 'Update password'}
        </button>
        {error && <p className="login-err">{error}</p>}
        <p className="login-alt"><Link to="/app/forgot-password">Request a new link</Link></p>
      </form>
    </div>
  );
}
