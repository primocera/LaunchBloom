import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Admin scorecard (Prompt 10) rendered as a readable dashboard instead of raw
// JSON. The endpoint 403s for non-allowlisted accounts, so this page shows an
// honest "admins only" state rather than an error. Beta gates come from the
// scorecard's own definitions — we render pass/below/no-data, never invent one.

const GATES = {
  activation: { min: 0.45, dir: 'gte', label: 'Activation', kind: 'ratio', hint: '≥ 45%' },
  time_to_first_value_minutes: { max: 15, dir: 'lte', label: 'Time to first value', kind: 'minutes', hint: '≤ 15 min' },
  trial_conversion: { min: 0.20, dir: 'gte', label: 'Trial conversion', kind: 'ratio', hint: '≥ 20%' },
  d7_retention: { min: 0.30, dir: 'gte', label: 'D7 retention', kind: 'ratio', hint: '≥ 30%' },
  generation_success: { min: 0.97, dir: 'gte', label: 'Generation success', kind: 'ratio', hint: '≥ 97%' },
};
const PLAIN = {
  acquisition: { label: 'Signups started', kind: 'users' },
  signups_completed: { label: 'Signups completed', kind: 'users' },
  limit_reached_users: { label: 'Hit a plan limit', kind: 'users' },
};
const ORDER = [
  'acquisition', 'signups_completed', 'activation', 'time_to_first_value_minutes',
  'trial_conversion', 'd7_retention', 'generation_success', 'limit_reached_users',
];

function fmt(metric, kind) {
  if (!metric || metric.value == null) return '—';
  if (kind === 'ratio') return `${Math.round(metric.value * 1000) / 10}%`;
  if (kind === 'minutes') return `${Math.round(metric.value)} min`;
  return String(metric.value);
}

function gateStatus(key, metric) {
  const g = GATES[key];
  if (!g || !metric || metric.value == null) return null;
  const pass = g.dir === 'gte' ? metric.value >= g.min : metric.value <= g.max;
  return pass ? 'pass' : 'below';
}

const C = {
  bg: '#F8F7F4', card: '#FFFFFF', text: '#111827', muted: '#6B7280',
  primary: '#2563EB', success: '#10B981', warn: '#B45309', border: '#E5E7EB',
};

function MetricCard({ mkey, metric }) {
  const g = GATES[mkey];
  const p = PLAIN[mkey];
  const kind = g?.kind || p?.kind || 'users';
  const label = g?.label || p?.label || mkey;
  const status = gateStatus(mkey, metric);
  const denom = metric && metric.denominator != null ? metric.denominator : null;
  const num = metric ? metric.numerator : null;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 13, color: C.muted, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>
        {g && <span style={{ fontSize: 12 }}>gate {g.hint}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
        {fmt(metric, kind)}
      </div>
      <div style={{ fontSize: 12, color: C.muted, minHeight: 16 }}>
        {denom != null ? `${num} of ${denom}` : (num != null ? `${num} ${kind === 'users' ? 'users' : ''}`.trim() : '')}
      </div>
      {status && (
        <span style={{
          alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, padding: '2px 8px',
          borderRadius: 999,
          color: status === 'pass' ? C.success : C.warn,
          background: status === 'pass' ? 'rgba(16,185,129,.12)' : 'rgba(180,83,9,.12)',
        }}>
          {status === 'pass' ? 'Meets gate' : 'Below gate'}
        </span>
      )}
      {!status && g && <span style={{ fontSize: 12, color: C.muted }}>No data yet</span>}
    </div>
  );
}

export default function Admin() {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | denied | error

  useEffect(() => {
    api.scorecard()
      .then((d) => { setData(d); setState('ready'); })
      .catch((err) => setState(err.status === 403 || err.status === 401 ? 'denied' : 'error'));
  }, []);

  if (state === 'loading') return <div style={{ padding: 32, color: C.muted }}>Loading scorecard…</div>;
  if (state === 'denied') return (
    <div style={{ padding: 32 }}>
      <h1 style={{ color: C.text }}>Admin scorecard</h1>
      <p style={{ color: C.muted, maxWidth: 520 }}>
        This view is limited to admin accounts. Add your email to <code>ADMIN_EMAILS</code> in the
        server environment and redeploy, then sign in with that account.
      </p>
    </div>
  );
  if (state === 'error') return (
    <div style={{ padding: 32 }}>
      <h1 style={{ color: C.text }}>Admin scorecard</h1>
      <p style={{ color: C.warn }}>Could not load the scorecard right now. Try again shortly.</p>
    </div>
  );

  const m = data.metrics || {};
  const w = data.window || {};
  const cancels = Object.entries(data.metrics?.cancellation_reasons || data.cancellation_reasons || {});
  const cost = m.cost_per_action;
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1040, margin: '0 auto', color: C.text }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Scorecard</h1>
      <p style={{ color: C.muted, marginTop: 6 }}>
        Last {w.days ?? 7} days · {fmtDate(w.since)} – {fmtDate(w.until)}. Beta gates are hypotheses, not validated benchmarks.
      </p>

      <div style={{
        display: 'grid', gap: 14, marginTop: 20,
        gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
      }}>
        {ORDER.map((k) => <MetricCard key={k} mkey={k} metric={m[k]} />)}
      </div>

      <div style={{ display: 'grid', gap: 14, marginTop: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Cancellation reasons</div>
          {cancels.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 14 }}>None in this window.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {cancels.map(([reason, n]) => (
                <li key={reason} style={{ fontSize: 14, margin: '2px 0' }}>
                  {reason}: <strong>{typeof n === 'object' ? (n.value ?? n.numerator ?? '') : n}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>AI cost per action</div>
          <div style={{ fontSize: 14, color: C.text }}>
            {cost && cost.value != null
              ? `$${cost.value} ${cost.unit || ''}`.trim()
              : <span style={{ color: C.muted }}>From the spend ledger — shown once there is spend to report.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
