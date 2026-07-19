import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, getActiveWorkspace, setActiveWorkspace } from '../lib/api';
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
  const [workspaces, setWorkspaces] = useState([]);
  const [receipt, setReceipt] = useState(null); // Prompt 27: deletion receipt

  function loadWorkspaces() {
    api.workspaces().then(({ workspaces: list }) => setWorkspaces(list)).catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    api.billing().then((b) => !cancelled && setBilling(b)).catch(() => {});
    loadWorkspaces();
    return () => { cancelled = true; };
  }, []);

  async function renameWorkspace(w) {
    const name = window.prompt('Rename workspace:', w.name);
    if (name === null) return;
    try { await api.renameWorkspace(w.id, name.trim() || w.name); loadWorkspaces(); }
    catch (err) { setError(err.message); }
  }

  async function removeWorkspace(w) {
    if (!window.confirm(`Delete "${w.name}" and all its data? This cannot be undone.`)) return;
    try {
      await api.deleteWorkspace(w.id);
      if (getActiveWorkspace() === w.id) setActiveWorkspace(null);
      loadWorkspaces();
    } catch (err) { setError(err.message); }
  }

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
      // Prompt 27: the backend returns a step-by-step deletion receipt. Show it
      // (with any failed steps) instead of promising a clean {ok:true}.
      const r = await api.deleteAccount();
      setReceipt(r || { ok: true });
      setBusy(false);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const sub = billing?.subscription;
  // Exact price/interval for billing copy — from the subscription when present.
  const priceStr = sub && (sub.price_display || (sub.amount != null ? `$${(sub.amount / 100).toFixed(2)}` : null));
  const per = sub && (sub.interval === 'year' || sub.interval === 'yearly') ? 'year' : 'month';
  const planName = billing?.plan_label || account?.plan_label || 'your plan';
  const priceClause = priceStr ? ` at ${priceStr}/${per}` : '';

  // Deletion receipt view (Prompt 27): honest about what was and wasn't deleted.
  if (receipt) {
    const steps = Array.isArray(receipt.steps) ? receipt.steps : [];
    const failed = steps.filter((s) => s.status === 'failed');
    return (
      <div className="account-page">
        <h1>Account deletion</h1>
        <section className="account-section">
          <p>
            Deletion request completed. We’ve emailed a record of what was deleted and any records
            retained for legal reasons.
          </p>
          {steps.length > 0 && (
            <ul className="kit-outline">
              {steps.map((s) => (
                <li key={s.step || s.name}>
                  {(s.step || s.name || '').replace(/_/g, ' ')} — <strong>{s.status}</strong>
                  {s.detail ? ` (${s.detail})` : ''}
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && (
            <p className="warn">
              {failed.length} step{failed.length === 1 ? '' : 's'} could not be completed automatically.
              Contact {BRAND.supportEmail} and we’ll finish them for you.
            </p>
          )}
          <button
            className="btn-secondary"
            onClick={async () => { await logout(); window.location.href = '/'; }}
          >
            Return to home
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="account-page">
      <h1>Account</h1>

      <section className="account-section">
        <h2>Profile</h2>
        <p><strong>Email:</strong> {account?.email}</p>
      </section>

      <section className="account-section">
        <h2>Plan &amp; billing</h2>
        <p><strong>Plan:</strong> {planName}</p>

        {!billing && <p className="muted">Loading billing…</p>}

        {billing && !sub && billing.plan === 'free' && (
          <>
            <p className="muted">You're on the free plan.</p>
            <a className="btn-primary inline" href="/#pricing">Start a plan</a>
          </>
        )}

        {sub && sub.status === 'trialing' && (
          <p>
            Trial ends <strong>{fmtDate(sub.trial_end || sub.next_charge_at)}</strong>. Your {planName}{' '}
            subscription starts{priceClause} unless you cancel before then.
          </p>
        )}
        {sub && sub.status === 'active' && !sub.cancel_at_period_end && (
          <p>{planName} renews on <strong>{fmtDate(sub.current_period_end)}</strong>{priceClause}.</p>
        )}
        {sub && sub.cancel_at_period_end && (
          <p>
            Generation access ends <strong>{fmtDate(sub.current_period_end)}</strong>. Your existing
            assets remain available according to the retention policy.
          </p>
        )}
        {sub && sub.status === 'past_due' && (
          <p className="warn">
            We couldn’t process the latest payment. Update your payment method to avoid losing
            generation access.
          </p>
        )}

        {billing?.has_billing && (
          <button className="btn-secondary" onClick={openPortal}>Manage billing</button>
        )}
        {sub && (
          <a className="btn-secondary inline" href="/#pricing" style={{ marginLeft: 8 }}>Change plan</a>
        )}
      </section>

      <section className="account-section">
        <h2>Workspaces</h2>
        <p className="muted">Each workspace keeps a separate Brand Profile, campaigns and Library.</p>
        {workspaces.map((w) => (
          <div className="ws-row" key={w.id}>
            <span className="ws-name">{w.name}{w.archived ? ' (archived)' : ''}</span>
            <button onClick={() => renameWorkspace(w)}>Rename</button>
            <button onClick={() => removeWorkspace(w)}>Delete</button>
          </div>
        ))}
      </section>

      <section className="account-section">
        <h2>Usage</h2>
        {billing ? (
          <>
            <p>
              <strong>{billing.usage?.ai_actions ?? 0} of {billing.limits?.ai_actions ?? '—'}</strong>{' '}
              AI actions used
              {fmtDate(billing.usage?.resets_at || sub?.current_period_end)
                ? ` · resets ${fmtDate(billing.usage?.resets_at || sub?.current_period_end)}`
                : ''}
            </p>
            <p>
              <strong>{billing.usage?.launch_kits ?? 0} of {billing.limits?.launch_kits ?? '—'}</strong>{' '}
              full launch campaigns used
            </p>
            <p className="muted">Editing and exporting are always free.</p>
          </>
        ) : <p className="muted">Loading…</p>}
      </section>

      <section className="account-section">
        <h2>Data &amp; privacy</h2>
        <p>Export all account data.</p>
        <p className="muted">
          Includes every workspace, Brand Profile, campaign, asset, version and account record in a
          machine-readable archive.
        </p>
        <button className="btn-secondary" onClick={exportData}>Export all account data</button>
      </section>

      <section className="account-section danger">
        <h2>Delete account</h2>
        <p>
          Permanently delete your account, every workspace and all generated assets, and request
          cancellation of any active subscription. This cannot be undone.
        </p>
        {!confirming ? (
          <button className="btn-danger" onClick={() => setConfirming(true)}>Delete account and request billing cancellation</button>
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

      <section className="account-section">
        <h2>Support</h2>
        <p className="muted">
          We typically reply within 1–2 business days. If you hit an error, include the request ID
          shown in the message — it lets us diagnose without seeing your content.
        </p>
        <a className="btn-secondary inline" href={`mailto:${BRAND.supportEmail}`}>Contact support</a>
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
