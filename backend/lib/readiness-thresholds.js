// ---------------------------------------------------------------------------
// v12 SC-V12-07 — turn raw operational counts into warning/stop signals.
//
// The readiness endpoint already reports counts (webhook failures, outbox
// backlog, AI spend, reservation leakage). Counts alone need an operator to
// remember what "too high" is. This classifies each into ok / warn / stop
// against explicit thresholds, and returns an overall status, so a dashboard or
// a paging rule can act without re-deriving the limits. Pure and secret-free.
// ---------------------------------------------------------------------------

'use strict';

// warn = look now; stop = intervene (pause the affected subsystem). Chosen for
// a small paid cohort — deliberately conservative, and easy to re-tune here.
const THRESHOLDS = Object.freeze({
  webhook_failures_24h: { warn: 1, stop: 5 },
  outbox_backlog: { warn: 25, stop: 100 },
  reservation_leakage: { warn: 1, stop: 10 },
});

function level(value, warn, stop) {
  if (value == null || Number.isNaN(Number(value))) return 'unknown';
  const v = Number(value);
  if (stop != null && v >= stop) return 'stop';
  if (warn != null && v >= warn) return 'warn';
  return 'ok';
}

/**
 * Classify the live signals block.
 * @param live { webhook_failures_24h, outbox_backlog, reservation_leakage,
 *               ai_spend_24h_usd, ai_spend_ceiling_usd }
 * @returns { signals: {name: level}, status: 'ok'|'warn'|'stop' }
 */
function classifyReadiness(live = {}) {
  const signals = {};
  for (const [name, t] of Object.entries(THRESHOLDS)) {
    signals[name] = level(live[name], t.warn, t.stop);
  }

  // AI spend is measured against its own configured ceiling: warn at 80%, stop
  // at or above the ceiling. Distinct from the hard per-day call BRAKE
  // (MAX_AI_CALLS_PER_DAY in spend-guard) — this is the money alarm.
  const ceiling = Number(live.ai_spend_ceiling_usd);
  const spend = Number(live.ai_spend_24h_usd);
  if (ceiling > 0 && Number.isFinite(spend)) {
    const ratio = spend / ceiling;
    signals.ai_spend = ratio >= 1 ? 'stop' : ratio >= 0.8 ? 'warn' : 'ok';
  } else {
    signals.ai_spend = 'unknown';
  }

  // LB-V19 (LB-05): absence of data must NEVER read as healthy. A signal that is
  // `unknown` means we could not measure it (e.g. a failed count) — so when no
  // actionable warn/stop is present but some signal is unmeasured, the roll-up is
  // `degraded`, not `ok`. Order: stop > warn > degraded (unavailable) > ok.
  const values = Object.values(signals);
  const status = values.includes('stop') ? 'stop'
    : values.includes('warn') ? 'warn'
      : values.includes('unknown') ? 'degraded'
        : 'ok';
  return { signals, status };
}

module.exports = { classifyReadiness, THRESHOLDS };
