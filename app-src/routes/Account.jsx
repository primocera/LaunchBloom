import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { BRAND } from '../brand';

// Prompts 8 + 14: account page — profile, billing (plan, trial countdown, next
// charge, billing portal), usage, data export and account deletion.
function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function daysLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default function Account() {
  const { account, logout } = useAuth();
  const [billing, setBilling] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.billing().then((b) => !cancelled && setBilling(b)).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function openPortal() {
    setError(null);
    try {
      const { url } = await api.billingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportData() {
    setError(null);
    try { await api.exportData(); } catch (err) { setError(err.message); }
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

  const sub = billing?.subscription;

  return (
    <div className="account-page">
      <h1>Account</h1>

      <section className="account-section">
        <h2>Profile</h2>
        <p><strong>Email:</strong> {account?.email}</p>
      </section>

      <section className="account-section">
        <h2>Billing</h2>
        <p><strong>Plan:</strong> {billing?.plan_label || account?.plan_label || 'Free'}</p>

        {!billing && <p className="muted">Loading billing…</p>}

        {billing && !sub && billing.plan === 'free' && (
          <>
            <p className="muted">You're on the free plan.</p>
            <a className="btn-primary inline" href="/#pricing">Start a plan</a>
          </>
        )}

        {sub && sub.status === 'trialing' && (
          <p>
            Free trial — <strong>{daysLeft(sub.trial_end)} day(s) left</strong>. You'll be charged on{' '}
            <strong>{fmtDate(sub.next_charge_at)}</strong> unless you cancel.
          </p>
        )}
        {sub && sub.status === 'active' && !sub.cancel_at_period_end && (
          <p>Renews on <strong>{fmtDate(sub.current_period_end)}</strong>{sub.interval ? ` (${sub.interval})` : ''}.</p>
        )}
        {sub && sub.cancel_at_period_end && (
          <p>Your plan ends on <strong>{fmtDate(sub.current_period_end)}</strong>. You can reactivate from the billing portal.</p>
        )}
        {sub && sub.status === 'past_due' && (
          <p className="warn">Your last payment failed. Update your card to keep access.</p>
        )}

        {billing?.has_billing && (
          <button className="btn-secondary" onClick={openPortal}>Manage billing</button>
        )}
        {sub && (
          <a className="btn-secondary inline" href="/#pricing" style={{ marginLeft: 8 }}>Change plan</a>
        )}
      </section>

      <section className="account-section">
        <h2>Usage</h2>
        {billing ? (
          <>
            <p>
              <strong>{billing.usage?.ai_actions ?? 0}{billing.limits?.ai_actions != null ? `/${billing.limits.ai_actions}` : ''}</strong>{' '}
              AI actions {billing.limits?.monthly ? 'this billing period' : 'used'}
            </p>
            <p>
              <strong>{billing.usage?.launch_kits ?? 0}{billing.limits?.launch_kits != null ? `/${billing.limits.launch_kits}` : ''}</strong>{' '}
              launch kits
            </p>
          </>
        ) : <p className="muted">Loading…</p>}
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
