// v12 SC-V12-04 — operational signals must be structured and PII-free.

const test = require('node:test');
const assert = require('node:assert/strict');

const { opsSignal, PREFIX, ALLOWED_FIELDS } = require('../lib/ops-signal');

/** Capture the emitted line instead of writing to the console. */
function capture(kind, fields) {
  let line = null;
  const payload = opsSignal(kind, fields, (l) => { line = l; });
  return { line, payload };
}

test('a signal is a single parseable line with a stable prefix', () => {
  const { line, payload } = capture('webhook_failed', { event_id: 'evt_1', event_type: 'invoice.paid' });
  assert.ok(line.startsWith(`${PREFIX} `), 'the line must carry the ops-signal prefix');
  const parsed = JSON.parse(line.slice(PREFIX.length + 1));
  assert.equal(parsed.signal, 'webhook_failed');
  assert.equal(parsed.event_id, 'evt_1');
  assert.equal(parsed.event_type, 'invoice.paid');
  assert.ok(parsed.at, 'a timestamp is always present');
  assert.deepEqual(parsed, payload);
});

test('only whitelisted fields survive — a caller cannot smuggle extra data through', () => {
  const { payload } = capture('foreign_event_ignored', {
    event_id: 'evt_2',
    email: 'person@example.com',      // not whitelisted
    customer_email: 'a@b.co',         // not whitelisted
    note: 'free text about a person', // not whitelisted
  });
  assert.equal(payload.event_id, 'evt_2');
  assert.ok(!('email' in payload), 'email must never appear');
  assert.ok(!('customer_email' in payload), 'customer_email must never appear');
  assert.ok(!('note' in payload), 'arbitrary free text must be dropped');
});

test('an email that slips into a whitelisted field is redacted, not emitted', () => {
  // reason is whitelisted, but must still never carry an address.
  const { payload } = capture('webhook_failed', { event_id: 'evt_3', reason: 'failed for user@example.com' });
  assert.equal(payload.reason, '[redacted-email]');
});

test('empty and null fields are omitted rather than emitted blank', () => {
  const { payload } = capture('reconciliation_correction', { event_id: 'evt_4', subscription_id: '', invoice_id: null });
  assert.equal(payload.event_id, 'evt_4');
  assert.ok(!('subscription_id' in payload));
  assert.ok(!('invoice_id' in payload));
});

test('the whitelist is opaque identifiers only — no email/name/content fields', () => {
  for (const f of ALLOWED_FIELDS) {
    assert.ok(!/email|name|address|content|prompt|body/i.test(f), `${f} looks like it could carry PII`);
  }
});
