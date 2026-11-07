import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';
import { microcopy } from '../lib/microcopy';
import { checkoutConfigState, trackErrorState } from '../lib/error-states';

// ---------------------------------------------------------------------------
// One-time pack of extra AI actions for paying subscribers. Packs and prices
// come from GET /api/plans (the backend catalog) - never hard-coded here. A
// pack adds AI actions to the current month only and expires when the monthly
// AI actions reset; the disclosure says so before checkout.
// ---------------------------------------------------------------------------

export default function TopupDialog({ open, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [pack, setPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cardRef = useFocusTrap(open, () => onClose?.());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    api.trackEvent('topup_viewed', {});
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        // A failed catalog read shows "not available", never an endless loader.
        if (!data) { setCatalog({ topups: [] }); return; }
        setCatalog(data);
        if (data.topups?.length) setPack((p) => p || data.topups[0].pack);
      })
      .catch(() => { if (!cancelled) setCatalog({ topups: [] }); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const packs = catalog?.topups || [];

  async function buy() {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.buyTopup(pack);
      window.location.href = url;
    } catch (e) {
      if (e.code === 'CHECKOUT_UNAVAILABLE' || e.code === 'LAUNCH_CONFIG_INCOMPLETE') {
        const st = checkoutConfigState(e);
        setError(`${st.message} ${st.reassurance}`.trim());
        trackErrorState(api.trackEvent, st, { feature: 'topup_checkout' });
      } else if (e.code === 'TOPUP_REQUIRES_PLAN') {
        setError('Extra AI actions are available on Starter, Pro and Studio. Choose a plan first.');
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
        aria-labelledby="topup-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <h2 id="topup-title">Buy more AI actions</h2>
        <p className="paywall-sub">
          Your work is saved. Add a one-time pack of AI actions to keep generating this month.
        </p>

        {!catalog ? (
          <p className="paywall-sub" aria-busy="true">Loading packs…</p>
        ) : packs.length === 0 ? (
          <p className="paywall-sub" role="status">
            Extra AI actions aren’t available right now. You can upgrade your plan from Account &amp; billing.
          </p>
        ) : (
          <div className="paywall-plans" role="radiogroup" aria-label="Choose a pack">
            {packs.map((p) => (
              <button
                key={p.pack}
                type="button"
                role="radio"
                aria-checked={pack === p.pack}
                className={pack === p.pack ? 'paywall-plan is-on' : 'paywall-plan'}
                onClick={() => setPack(p.pack)}
              >
                <span className="paywall-plan-name">{p.actions} AI actions</span>
                <span className="paywall-plan-price">{p.price.display}</span>
                <span className="paywall-plan-sub">one-time</span>
              </button>
            ))}
          </div>
        )}

        {packs.length > 0 && (
          <button className="flow-btn paywall-cta" disabled={busy || !pack} onClick={buy}>
            {busy ? 'Opening secure checkout…' : 'Buy AI actions'}
          </button>
        )}

        {error && <p className="flow-err" role="alert">{error}</p>}

        <p className="paywall-footer">
          {catalog?.topup_disclosure || 'One-time purchase. Extra AI actions are added to this month only and expire when your monthly AI actions reset.'}{' '}
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms</a> &middot;{' '}
          <a href="/legal/refund" target="_blank" rel="noopener noreferrer">Refund &amp; cancellation</a>
        </p>
        {catalog?.currency_note && <p className="paywall-footer">{catalog.currency_note}</p>}

        <button type="button" className="paywall-close" onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>
  );
}
