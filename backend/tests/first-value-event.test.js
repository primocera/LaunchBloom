// ---------------------------------------------------------------------------
// v18 S06 — the named first-value milestone.
//
// first_value_reached is the single server-verified, durable "value moment":
// a workspace exported its first real handoff packet. These tests protect the
// three properties the pack requires of that milestone:
//   • it is a REGISTERED canonical event (an unregistered one is silently
//     dropped, giving a believable permanent zero);
//   • it is SERVER-fired only (never client-spoofable via POST /api/events);
//   • its emission is behind a removable feature flag that defaults on but can
//     be rolled back with "-first_value_event" and no deploy.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { CANONICAL_EVENTS, CLIENT_EVENTS } = require('../lib/analytics');

test('first_value_reached is a registered canonical event with a real definition', () => {
  assert.ok(CANONICAL_EVENTS.first_value_reached, 'the milestone must be registered or the events route drops it');
  assert.match(CANONICAL_EVENTS.first_value_reached, /first[- ]value|handoff/i);
});

test('first_value_reached is server-fired only — never client-spoofable', () => {
  // A client could otherwise POST a fake value moment and corrupt the north-star.
  assert.equal(CLIENT_EVENTS.has('first_value_reached'), false);
});

test('the first_value_event flag defaults on', () => {
  // Fresh env with no FEATURE_FLAGS override: the metric works out of the box.
  const saved = process.env.FEATURE_FLAGS;
  delete process.env.FEATURE_FLAGS;
  delete require.cache[require.resolve('../lib/flags')];
  const { enabled } = require('../lib/flags');
  assert.equal(enabled('first_value_event'), true);
  if (saved === undefined) delete process.env.FEATURE_FLAGS; else process.env.FEATURE_FLAGS = saved;
  delete require.cache[require.resolve('../lib/flags')];
});

test('the first_value_event flag can be rolled back without a deploy', () => {
  const saved = process.env.FEATURE_FLAGS;
  process.env.FEATURE_FLAGS = '-first_value_event';
  delete require.cache[require.resolve('../lib/flags')];
  const { enabled } = require('../lib/flags');
  assert.equal(enabled('first_value_event'), false, 'a "-flag" prefix must silence the emission');
  if (saved === undefined) delete process.env.FEATURE_FLAGS; else process.env.FEATURE_FLAGS = saved;
  delete require.cache[require.resolve('../lib/flags')];
});
