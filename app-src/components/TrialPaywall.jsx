import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';

// ---------------------------------------------------------------------------
// v5 Prompt 2: contextual trial paywall. Shown when a free account attempts
// its first generation. Discloses the selected plan, the exact post-trial
// price and charge date, the trial allowance and how to cancel — then starts
// Stripe Checkout. The user's prepared form input stays in a local draft, so
// nothing is lost across the redirect.
// ---------------------------------------------------------------------------

function chargeDate() {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function TrialPaywall({ open, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [plan, setPlan] = useState(() => {
    try { return localStorage.getItem('of-pending-plan') || 'starter'; } catch { return 'starter'; }
  });
  const [interval, setInterval] = useState(() => {
    try { return localStorage.getItem('of-pending-interval') || 'monthly'; } catch { return 'monthly'; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // v5 Prompt 19: trap focus inside the dialog, Escape closes, focus returns.
  const cardRef = useFocusTrap(open, () => onClose?.());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.trackEvent('paywall_viewed'); // v5 Prompt 18: funnel instrumentation
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.plans) setCatalog(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const selected = catalog?.plans?.find((p) => p.plan === plan) || null;
  const price = selected ? selected.price.display[interval] : null;
  const per = interval === 'yearly' ? '/yr' : '/mo';

  async function start() {
    if (busy) return; // duplicate-click guard
    setBusy(true);
    setError(null);
    try {
      const data = await api.checkout(plan, interval);
      window.location.href = data.url; // leave busy=true until we navigate away
    } catch (e) {
      if (e.code === 'ALREADY_SUBSCRIBED') {
        setError('You already have a subscription. Manage your plan from Account & billing.');
      } else {
        setError(e.message || 'Could not start checkout. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="paywall-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className="paywall-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <h2 id="paywall-title">Start your 3-day free trial to generate</h2>
        <p className="paywall-sub">
          Your work is saved. During the trial you get{' '}
          <strong>
            {catalog ? `${catalog.trial.ai_actions_total} AI actions and ${catalog.trial.launch_kits_total} full launch kit` : '20 AI actions and 1 full launch kit'}
          </strong>{' '}
          to try the whole workspace.
        </p>

        <div className="paywall-plans" role="radiogroup" aria-label="Choose a plan">
          {(catalog?.plans || []).map((p) => (
            <button
              key={p.plan}
              type="button"
              role="radio"
              aria-checked={plan === p.plan}
              className={plan === p.plan ? 'paywall-plan is-on' : 'paywall-plan'}
              onClick={() => setPlan(p.plan)}
            >
              <span className="paywall-plan-name">{p.label}</span>
              <span className="paywall-plan-price">{p.price.display[interval]}{per}</span>
              <span className="paywall-plan-sub">{p.ai_actions} AI actions / month</span>
            </button>
          ))}
        </div>

        <div className="paywall-interval" role="group" aria-label="Billing interval">
          <button type="button" className={interval === 'monthly' ? 'is-active' : ''} onClick={() => setInterval('monthly')}>Monthly</button>
          <button type="button" className={interval === 'yearly' ? 'is-active' : ''} onClick={() => setInterval('yearly')}>
            Yearly{catalog ? ` · ${catalog.yearly_badge}` : ''}
          </button>
        </div>

        <button className="flow-btn paywall-cta" disabled={busy || !selected} onClick={start}>
          {busy ? 'Opening secure checkout…' : 'Start my 3-day trial'}
        </button>

        {error && <p className="flow-err">{error}</p>}

        <p className="paywall-footer">
          {price ? <>You'll be charged {price}{per} on {chargeDate()} unless you cancel before then. </> : null}
          {catalog?.trial?.disclosure || "Payment method required. Cancel before your trial ends and you won't be charged."}{' '}
          Cancel anytime from Account &amp; billing.
        </p>

        <button type="button" className="paywall-close" onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>
  );
}
