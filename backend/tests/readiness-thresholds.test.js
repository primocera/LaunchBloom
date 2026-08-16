// v12 SC-V12-07 — operational signals classify into ok/warn/stop.

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyReadiness } = require('../lib/readiness-thresholds');

test('a quiet system is ok on every signal', () => {
  const { signals, status } = classifyReadiness({
    webhook_failures_24h: 0, outbox_backlog: 0, reservation_leakage: 0,
    ai_spend_24h_usd: 1, ai_spend_ceiling_usd: 15,
  });
  assert.equal(status, 'ok');
  for (const v of Object.values(signals)) assert.equal(v, 'ok');
});

test('webhook failures and reservation leakage escalate to warn then stop', () => {
  assert.equal(classifyReadiness({ webhook_failures_24h: 1 }).signals.webhook_failures_24h, 'warn');
  assert.equal(classifyReadiness({ webhook_failures_24h: 5 }).signals.webhook_failures_24h, 'stop');
  assert.equal(classifyReadiness({ reservation_leakage: 1 }).signals.reservation_leakage, 'warn');
  assert.equal(classifyReadiness({ reservation_leakage: 10 }).signals.reservation_leakage, 'stop');
});

test('AI spend warns at 80% of the ceiling and stops at the ceiling', () => {
  assert.equal(classifyReadiness({ ai_spend_24h_usd: 12, ai_spend_ceiling_usd: 15 }).signals.ai_spend, 'warn');
  assert.equal(classifyReadiness({ ai_spend_24h_usd: 15, ai_spend_ceiling_usd: 15 }).signals.ai_spend, 'stop');
  assert.equal(classifyReadiness({ ai_spend_24h_usd: 5, ai_spend_ceiling_usd: 15 }).signals.ai_spend, 'ok');
});

test('an unknown count is surfaced as unknown, not silently ok', () => {
  const { signals } = classifyReadiness({ webhook_failures_24h: null });
  assert.equal(signals.webhook_failures_24h, 'unknown');
  // No ceiling configured → spend cannot be judged.
  assert.equal(classifyReadiness({ ai_spend_24h_usd: 5 }).signals.ai_spend, 'unknown');
});

test('the overall status is the worst actionable signal', () => {
  assert.equal(classifyReadiness({ webhook_failures_24h: 0, outbox_backlog: 30 }).status, 'warn');
  assert.equal(classifyReadiness({ webhook_failures_24h: 6, outbox_backlog: 0 }).status, 'stop');
});

test('LB-V19 (LB-05): absence of data never rolls up to ok — it degrades', () => {
  // A fully quiet-but-measured system is ok.
  assert.equal(classifyReadiness({
    webhook_failures_24h: 0, outbox_backlog: 0, reservation_leakage: 0,
    ai_spend_24h_usd: 1, ai_spend_ceiling_usd: 15,
  }).status, 'ok');

  // A signal we could not measure (null count) must NOT read as healthy.
  assert.equal(classifyReadiness({
    webhook_failures_24h: null, outbox_backlog: 0, reservation_leakage: 0,
    ai_spend_24h_usd: 1, ai_spend_ceiling_usd: 15,
  }).status, 'degraded');

  // Everything unmeasured (e.g. the DB is unreachable) is degraded, not ok.
  assert.equal(classifyReadiness({}).status, 'degraded');

  // An actionable warn/stop still outranks a mere unavailable signal.
  assert.equal(classifyReadiness({ webhook_failures_24h: null, outbox_backlog: 30 }).status, 'warn');
  assert.equal(classifyReadiness({ webhook_failures_24h: null, outbox_backlog: 200 }).status, 'stop');
});
