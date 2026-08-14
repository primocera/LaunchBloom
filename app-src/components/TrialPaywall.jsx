import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';
import { microcopy } from '../lib/microcopy';
import { checkoutConfigState, planVerificationState, trackErrorState } from '../lib/error-states';
import { resolvePaywallReason, paywallCopy } from '../lib/paywall-reasons';

// ---------------------------------------------------------------------------
// v5 Prompt 2: contextual trial paywall. Shown when a free account attempts
// its first generation. Discloses the selected plan, the exact post-trial
// price and charge date, the trial allowance and how to cancel — then starts
// Stripe Checkout. The user's prepared form input stays in a local draft, so
// nothing is lost across the redirect.
// ---------------------------------------------------------------------------

function chargeDate() {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const date = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  // Prompt 16: show the timezone so the exact charge moment is unambiguous.
  let tz = '';
  try {
    tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch { /* older engines: date alone is still clear */ }
  return tz ? `${date} (${tz})` : date;
}

export default function TrialPaywall({ open, onClose, reason = null }) {
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

  // v7 LB-12 / LB-V17-01: trial eligibility is an explicit finite state, never a
  // nullable boolean that decays to "eligible" on failure. Only a server-
  // confirmed `eligible` may render the 3-day-trial promise; a failed/unknown
  // read is `unavailable` — no trial copy, no charged-today claim, just Retry.
  //   'loading' | 'eligible' | 'ineligible' | 'unavailable'
  const [eligState, setEligState] = useState('loading');

  function loadEligibility(cancelledRef) {
    setEligState('loading');
    return api.billing()
      .then((b) => {
        if (cancelledRef.cancelled) return;
        // Only an explicit boolean is trusted. Anything else (missing field,
        // malformed payload) is unknown, not eligible.
        if (b?.trial_eligible === true) setEligState('eligible');
        else if (b?.trial_eligible === false) setEligState('ineligible');
        else setEligState('unavailable');
      })
      .catch(() => { if (!cancelledRef.cancelled) setEligState('unavailable'); });
  }

  useEffect(() => {
    if (!open) return;
    const ref = { cancelled: false };
    // v18 S13: every paywall view is tagged with its typed reason, so the
    // boundary that opened it is measurable from one contract, not inferred.
    api.trackEvent('paywall_viewed', { reason: resolvePaywallReason({ reason }) });
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!ref.cancelled && data?.plans) setCatalog(data); })
      .catch(() => {});
    loadEligibility(ref);
    return () => { ref.cancelled = true; };
    // `reason` is included for lint correctness; callers pass a fixed reason per
    // open, so this does not cause the paywall_viewed event to re-fire.
  }, [open, reason]);

  function retryEligibility() {
    setError(null);
    const ref = { cancelled: false };
    loadEligibility(ref);
  }

  if (!open) return null;

  // v18 S13: when a caller names a non-trial reason (quota reached, export not
  // in plan, payment past due, cancelled, permission denied), the header comes
  // from the one reason contract. The trial reasons keep the richer eligState
  // copy below (exact allowance, charge date), so passing no reason is
  // unchanged behaviour.
  const resolvedReason = resolvePaywallReason({
    reason,
    trialEligible: eligState === 'eligible' ? true : eligState === 'ineligible' ? false : null,
  });
  const isTrialReason = resolvedReason === 'trial_required' || resolvedReason === 'trial_expired';
  const reasonCopy = paywallCopy(resolvedReason);

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
      if (e.code === 'PLAN_UNAVAILABLE') {
        // v13 SC-P0-01: checkout failed closed — no session, no charge, and no
        // access change. Say so plainly and let the user retry.
        const st = planVerificationState(e);
        setError(`${st.message} ${st.reassurance}`.trim());
        trackErrorState(api.trackEvent, st, { feature: 'checkout' });
      } else if (e.code === 'CHECKOUT_UNAVAILABLE' || e.code === 'LAUNCH_CONFIG_INCOMPLETE' || e.status === 503) {
        // v13 SC-P1-10 / SC-P0-03: checkout config unavailable. Confirm no charge
        // and that the currency has not silently changed.
        const st = checkoutConfigState(e);
        setError(`${st.message} ${st.reassurance}`.trim());
        trackErrorState(api.trackEvent, st, { feature: 'checkout' });
      } else if (e.code === 'ALREADY_SUBSCRIBED') {
        // Server is the final authority: eligibility changed under us. Refresh
        // canonical state so the copy stops promising a trial, and explain.
        setEligState('ineligible');
        setError('You already have a subscription. Manage your plan from Account & billing.');
      } else {
        setError(e.userMessage || microcopy('unknown', { req_id: e.req_id }));
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
        {!isTrialReason ? (
          <>
            <h2 id="paywall-title">{reasonCopy.title}</h2>
            <p className="paywall-sub">{reasonCopy.lead}</p>
          </>
        ) : eligState === 'ineligible' ? (
          <>
            <h2 id="paywall-title">Choose a plan to keep generating</h2>
            <p className="paywall-sub">
              Your work is saved. You've already used your 3-day trial, so your plan starts — and is
              charged — today.
            </p>
          </>
        ) : eligState === 'eligible' ? (
          <>
            <h2 id="paywall-title">Start your 3-day free trial to generate</h2>
            <p className="paywall-sub">
              Your work is saved. During the trial you get{' '}
              <strong>
                {catalog ? `${catalog.trial.ai_actions_total} AI actions and ${catalog.trial.launch_kits_total} full launch campaign` : '20 AI actions and 1 full launch campaign'}
              </strong>{' '}
              to try the whole workspace.
            </p>
          </>
        ) : eligState === 'unavailable' ? (
          <>
            <h2 id="paywall-title">Choose a plan to keep generating</h2>
            <p className="paywall-sub" role="alert">
              Your work is saved. We couldn’t confirm whether your free trial is available right now —
              and you have not been charged. Try again to see your exact terms before you continue.
            </p>
          </>
        ) : (
          <>
            <h2 id="paywall-title">Choose a plan to keep generating</h2>
            <p className="paywall-sub" aria-busy="true">
              Your work is saved. Checking your plan options…
            </p>
          </>
        )}

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

        {eligState === 'unavailable' ? (
          <button className="flow-btn paywall-cta" onClick={retryEligibility} disabled={busy}>
            Try again
          </button>
        ) : (
          <button
            className="flow-btn paywall-cta"
            disabled={busy || !selected || eligState === 'loading'}
            onClick={start}
          >
            {busy ? 'Opening secure checkout…'
              : eligState === 'loading' ? 'Checking your plan…'
              : eligState === 'ineligible' ? 'Subscribe — charged today'
              : 'Start my 3-day trial'}
          </button>
        )}

        {error && <p className="flow-err" role="alert">{error}</p>}

        <p className="paywall-footer">
          {eligState === 'ineligible' ? (
            <>
              {price ? <>You'll be charged {price}{per} today. </> : null}
              No second trial — your earlier trial has been used. Cancel anytime from Account &amp; billing.
            </>
          ) : eligState === 'eligible' ? (
            <>
              {price ? <>You'll be charged {price}{per} on {chargeDate()} unless you cancel before then. </> : null}
              {catalog?.trial?.disclosure || "Payment method required. Cancel before your trial ends and you won't be charged."}{' '}
              Cancel anytime from Account &amp; billing.
            </>
          ) : eligState === 'unavailable' ? (
            <>We couldn’t confirm your trial or charge terms, so none are shown. You have not been charged. Try again to continue.</>
          ) : (
            <>Confirming your exact trial and charge terms…</>
          )}
        </p>

        {catalog?.currency_note && <p className="paywall-footer">{catalog.currency_note}</p>}

        <button type="button" className="paywall-close" onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>
  );
}
