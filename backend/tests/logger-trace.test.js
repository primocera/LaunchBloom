// ---------------------------------------------------------------------------
// v18 X02 — distributed trace-id propagation (backend/lib/logger.js).
//
// A trace id must correlate one logical operation across services. We honour a
// valid inbound W3C traceparent or opaque x-trace-id, and refuse malformed or
// sentinel values rather than trust them, so a poisoned header can never inject
// junk into the log correlation key.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { traceIdFrom } = require('../lib/logger');

test('a valid W3C traceparent yields its 32-hex trace id', () => {
  const id = traceIdFrom({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' });
  assert.equal(id, '4bf92f3577b34da6a3ce929d0e0e4736');
});

test('the all-zero traceparent sentinel is rejected', () => {
  assert.equal(traceIdFrom({ traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01' }), null);
});

test('a malformed traceparent is ignored, not trusted', () => {
  for (const bad of ['nonsense', '00-tooshort-x-01', '', '00-4bf9-2b7-01']) {
    assert.equal(traceIdFrom({ traceparent: bad }), null);
  }
});

test('an opaque x-trace-id is accepted when it is a sane token', () => {
  assert.equal(traceIdFrom({ 'x-trace-id': 'req-abc_123.45' }), 'req-abc_123.45');
});

test('an oversized or empty x-trace-id is rejected', () => {
  assert.equal(traceIdFrom({ 'x-trace-id': 'x'.repeat(500) }), null);
  assert.equal(traceIdFrom({ 'x-trace-id': '' }), null);
  assert.equal(traceIdFrom({ 'x-trace-id': 'has space' }), null);
});

test('traceparent wins over x-trace-id when both are present', () => {
  const id = traceIdFrom({
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    'x-trace-id': 'other',
  });
  assert.equal(id, '4bf92f3577b34da6a3ce929d0e0e4736');
});

test('no headers yields null so the caller mints a fresh id', () => {
  assert.equal(traceIdFrom({}), null);
  assert.equal(traceIdFrom(), null);
});
