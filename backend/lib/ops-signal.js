// ---------------------------------------------------------------------------
// v12 SC-V12-04 — structured operational signals for billing/webhook events.
//
// Replaces ad-hoc console.log lines with one machine-parseable shape, so an
// operator (or a log drain) can count webhook failures, ignored foreign events
// and reconciliation corrections without reading prose. Deliberately tiny and
// dependency-free.
//
// It must never emit PII. Two defences: callers pass only opaque identifiers
// (Stripe event/subscription/invoice/charge ids, an event type, a reason), and
// this module additionally whitelists field names and redacts any value that
// looks like an email address. A signal is operational telemetry, not an audit
// of who did what.
// ---------------------------------------------------------------------------

'use strict';

const PREFIX = 'ops-signal';

// Only these fields may appear in a signal. Anything else is dropped rather
// than trusted — the whitelist is the guarantee, not the caller's discipline.
const ALLOWED_FIELDS = Object.freeze([
  'event_id',
  'event_type',
  'subscription_id',
  'invoice_id',
  'charge_id',
  'dispute_id',
  'reason',
  'severity',
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function scrub(value) {
  const s = String(value == null ? '' : value);
  return EMAIL_RE.test(s) ? '[redacted-email]' : s;
}

/**
 * Emit one structured signal. `kind` names the class of event
 * (webhook_failed, foreign_event_ignored, reconciliation_correction, …);
 * `fields` carries only whitelisted opaque identifiers.
 * Returns the emitted object (also handy for tests).
 */
function opsSignal(kind, fields = {}, emit = console.log) {
  const payload = { signal: kind, at: new Date().toISOString() };
  for (const key of ALLOWED_FIELDS) {
    if (fields[key] != null && fields[key] !== '') payload[key] = scrub(fields[key]);
  }
  emit(`${PREFIX} ${JSON.stringify(payload)}`);
  return payload;
}

module.exports = { opsSignal, PREFIX, ALLOWED_FIELDS };
