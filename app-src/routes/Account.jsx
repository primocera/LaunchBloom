import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { BRAND } from '../brand';

// Prompt 14: minimal account page — profile summary, data export and account
// deletion. Billing/usage detail is expanded in Prompt 8.
export default function Account() {
  const { account, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function exportData() {
    setError(null);
    try {
      await api.exportData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      await logout();
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="account-page">
      <h1>Account</h1>

      <section className="account-section">
        <h2>Profile</h2>
        <p><strong>Email:</strong> {account?.email}</p>
        <p><strong>Plan:</strong> {account?.plan_label || 'Free'}</p>
      </section>

      <section className="account-section">
        <h2>Your data</h2>
        <p>Download everything {BRAND.name} holds for your workspace as a JSON file.</p>
        <button className="btn-secondary" onClick={exportData}>Export my data</button>
      </section>

      <section className="account-section danger">
        <h2>Delete account</h2>
        <p>
          Permanently delete your account, workspace and all generated assets, and cancel any
          active subscription. This cannot be undone.
        </p>
        {!confirming ? (
          <button className="btn-danger" onClick={() => setConfirming(true)}>Delete my account</button>
        ) : (
          <div className="confirm-row">
            <span>Are you sure?</span>
            <button className="btn-danger" onClick={deleteAccount} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
          </div>
        )}
      </section>

      {error && <p className="login-err">{error}</p>}

      <p className="account-legal">
        <Link to="/legal/terms">Terms</Link> &middot;{' '}
        <Link to="/legal/privacy">Privacy</Link> &middot;{' '}
        <Link to="/legal/refund">Refunds</Link> &middot;{' '}
        <a href={`mailto:${BRAND.supportEmail}`}>Contact support</a>
      </p>
    </div>
  );
}
