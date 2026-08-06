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
  // v10 SC-07: the cohort funnel loads independently — a cohort failure must
  // not blank the scorecard, and vice versa.
  const [cohort, setCohort] = useState(null);
  // SC-95-03: the canonical value scorecard loads independently too.
  const [beta, setBeta] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | denied | error

  useEffect(() => {
    api.betaScorecard()
      .then((d) => { setBeta(d); setState('ready'); })
      .catch((err) => setState(err.status === 403 || err.status === 401 ? 'denied' : 'error'));
    api.scorecard().then(setData).catch(() => setData(null));
    api.cohort().then(setCohort).catch(() => setCohort(null));
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

  const m = (data && data.metrics) || {};
  const w = (data && data.window) || {};
  const cancels = Object.entries((data && (data.metrics?.cancellation_reasons || data.cancellation_reasons)) || {});
  const cost = m.cost_per_action;
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1040, margin: '0 auto', color: C.text }}>
      {/* SC-95-03: the canonical capped-beta value scorecard — one denominator,
          server-confirmed milestones (including repeat campaigns), outage-aware.
          This is the decision system; the sections below are deprecated views. */}
      <BetaValueScorecard beta={beta} />

      <details style={{ marginTop: 28 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, color: C.muted }}>
          Deprecated views (older activation scorecard &amp; campaign-control funnel)
        </summary>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
          Kept for continuity. The canonical value scorecard above is the single
          decision system; these may use different denominators and are not used
          for the 9.5 decision.
        </p>

        <h2 style={{ margin: '18px 0 0', fontSize: 18 }}>Activation scorecard (deprecated)</h2>
        <p style={{ color: C.muted, marginTop: 6 }}>
          Last {w.days ?? 7} days · {fmtDate(w.since)} – {fmtDate(w.until)}.
        </p>
        {data ? (
          <div style={{
            display: 'grid', gap: 14, marginTop: 14,
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          }}>
            {ORDER.map((k) => <MetricCard key={k} mkey={k} metric={m[k]} />)}
          </div>
        ) : <p style={{ color: C.muted }}>Not available.</p>}

        <CohortFunnel cohort={cohort} />

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
      </details>
    </div>
  );
}

// SC-95-03: the canonical value loop. Renders the server's state verbatim —
// no_data / insufficient_data / unavailable / reported read differently and
// imply different actions; an analytics outage (data_available:false) shows a
// clear banner and never a zero. Gates are pre-registered hypotheses.
const VALUE_STATE = {
  reported: { color: C.text, note: null },
  insufficient_data: { color: C.muted, note: 'Too few accounts to report' },
  no_data: { color: C.muted, note: 'Nothing measured in this window' },
  unavailable: { color: C.warn, note: 'Not measurable' },
};

function BetaValueScorecard({ beta }) {
  if (!beta) return <p style={{ color: C.muted }}>Loading value scorecard…</p>;
  const steps = beta.steps || [];
  const outage = beta.data_available === false;
  const w = beta.window || {};

  return (
    <section>
      <h1 style={{ margin: 0, fontSize: 24 }}>Beta value scorecard</h1>
      <p style={{ color: C.muted, marginTop: 6 }}>
        Last {w.days ?? 7} days · cohort of {beta.cohort_size ?? 0}
        {beta.reportable === false && !outage && ` · under the reporting threshold of ${beta.min_cohort}`}.
        Gates are pre-registered hypotheses, not benchmarks; never customer-facing.
      </p>

      {outage && (
        <div style={{ background: 'rgba(180,83,9,.10)', border: `1px solid ${C.warn}`, borderRadius: 12, padding: '12px 16px', margin: '12px 0', color: C.warn, fontSize: 14 }}>
          Analytics read failed for this window — every metric is <strong>unavailable</strong>, not zero.
          Do not expand or change the product on an unavailable read.
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
          <caption style={{ captionSide: 'bottom', textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.muted }}>
            {beta.disclaimer}
          </caption>
          <thead>
            <tr>
              {['Milestone (question)', 'Reached', 'Of activated', 'State'].map((h) => (
                <th key={h} scope="col" style={{ textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 600, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const st = VALUE_STATE[s.state] || VALUE_STATE.no_data;
              return (
                <tr key={s.step}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: C.text }}>
                    {s.step}
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>{s.question}</div>
                  </th>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: st.color }}>
                    {s.numerator == null ? '—' : `${s.numerator} / ${s.denominator ?? '—'}`}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: st.color }}>
                    {s.value == null ? <span title={st.note || ''}>—</span> : `${s.value}%`}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, color: st.color }}>
                    {s.state}{st.note ? ` — ${st.note}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Decision gates (hypotheses)</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(beta.thresholds || []).map((t) => (
            <li key={t.key} style={{ fontSize: 13, color: C.muted, margin: '3px 0' }}>
              <strong style={{ color: C.text }}>{t.key}</strong>: {t.gate}
            </li>
          ))}
        </ul>
      </div>

      <HandoffFeedback fb={beta.handoff_feedback} />
    </section>
  );
}

// SC-95-04: post-handoff feedback — did the coordinated handoff reduce rework?
// Categories only (never the free-text note). The reduced-rework claim is
// blocked until respondents, low manual work and interviews support it.
function HandoffFeedback({ fb }) {
  if (!fb) return null;
  const cat = (obj) => Object.entries(obj || {}).filter(([, n]) => n > 0);
  const supported = fb.reduced_rework_claim_supported;
  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Handoff feedback — reduced rework?</h2>
      <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>
        {fb.respondents == null ? '—' : `${fb.respondents} respondents`}
        {fb.eligible ? ` of ${fb.eligible} who exported a handoff` : ''}
        {fb.response_rate != null ? ` · ${fb.response_rate}% response` : ''} · state: {fb.state}.
        Categories only; notes are never shown here.
      </p>
      <span style={{
        display: 'inline-block', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
        color: supported ? C.success : C.warn,
        background: supported ? 'rgba(16,185,129,.12)' : 'rgba(180,83,9,.12)',
      }}>
        {supported ? 'Reduced-rework claim supported by evidence' : 'Reduced-rework claim BLOCKED — evidence insufficient'}
      </span>
      {fb.state === 'reported' && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {['job_done', 'manual_work', 'price_view'].map((c) => (
            <div key={c} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>{c}</div>
              {cat(fb.counts?.[c]).length === 0
                ? <div style={{ fontSize: 13, color: C.muted }}>No answers</div>
                : cat(fb.counts[c]).map(([v, n]) => (
                  <div key={v} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{v}</span><strong>{n}</strong>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// v10 SC-07: the eleven-step campaign-control funnel.
//
// Renders the server's state verbatim — it never computes a rate the backend
// suppressed, and never fills a blank with a zero. "Insufficient data" and
// "not instrumented" read differently from a real 0%, because they mean
// different things and imply different actions.
const STATE_STYLE = {
  reported: { color: C.text, note: null },
  insufficient_data: { color: C.muted, note: 'Too few accounts to report a rate' },
  no_data: { color: C.muted, note: 'Nothing measured in this window' },
  unavailable: { color: C.warn, note: 'Not instrumented' },
};

function CohortFunnel({ cohort }) {
  if (!cohort) return null;
  const c = cohort.cohort || {};
  const steps = c.steps || [];
  const drop = cohort.biggest_drop_off;
  const cost = cohort.cost || {};
  const money = (v) => (v == null ? '—' : `$${v}`);

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Campaign-control funnel</h2>
      <p style={{ color: C.muted, marginTop: 0, fontSize: 13 }}>
        Last {cohort.window?.days ?? 30} days · cohort of {c.cohort_size ?? 0}
        {c.reportable === false && ` · under the reporting threshold of ${c.min_cohort}`}
      </p>

      {drop && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: C.muted }}>Biggest drop-off</div>
          <div style={{ fontSize: 15, margin: '4px 0' }}>
            <strong>{drop.from}</strong> → <strong>{drop.to}</strong> — lost {drop.lost} of {drop.of}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>{drop.decision}</div>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <caption style={{ captionSide: 'bottom', textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.muted }}>
            {cohort.disclosure}
          </caption>
          <thead>
            <tr>
              {['Step', 'Reached', 'Of cohort', 'Of previous', 'What it tells you'].map((h) => (
                <th key={h} scope="col" style={{ textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 600, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const style = STATE_STYLE[s.state] || STATE_STYLE.no_data;
              return (
                <tr key={s.step}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: C.text }}>
                    {s.label}
                  </th>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: style.color }}>
                    {s.numerator == null ? '—' : `${s.numerator} / ${s.denominator}`}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: style.color }}>
                    {s.value == null ? <span title={style.note || ''}>—</span> : `${s.value}%`}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, color: style.color }}>
                    {s.step_value == null ? '—' : `${s.step_value}%`}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, color: C.muted }}>
                    {s.decision}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gap: 14, marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {[
          ['AI spend (window)', money(cost.ai_spend_usd)],
          ['Per activated account', money(cost.per_activated_account)],
          ['Per exporting account', money(cost.per_exporting_account)],
          ['Per renewed account', money(cost.per_renewed_account)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: C.muted }}>{label}</div>
            <div style={{ fontSize: 20, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>
      <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>{cost.note}</p>
    </section>
  );
}
