// v5 Prompt 18 — analytics: canonical event definitions, privacy redaction of
// properties, and the documented activation definition.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeProperties, CANONICAL_EVENTS, CLIENT_EVENTS, ACTIVATION } = require('../lib/analytics');

// v9 SC-11: every event the frontend fires via api.trackEvent MUST be an
// allowlisted client event, or POST /api/events silently drops it (204). This
// guard would have caught the SC-01..08 cockpit/review/library events being
// dropped before they were registered.
test('every frontend trackEvent name is an allowlisted client event', () => {
  const APP = path.join(__dirname, '..', '..', 'app-src');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (['.js', '.jsx'].includes(path.extname(e.name))) files.push(p);
    }
  })(APP);
  const fired = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/trackEvent\('([a-z_]+)'/g)) fired.add(m[1]);
  }
  const dropped = [...fired].filter((e) => !CLIENT_EVENTS.has(e));
  assert.deepEqual(dropped, [], `these fired events are not allowlisted (silently dropped): ${dropped.join(', ')}`);
});

test('every canonical event has a non-empty documented definition', () => {
  const required = [
    'landing_viewed', 'landing_pricing_viewed', 'signup_started', 'signup_completed',
    'email_verified', 'onboarding_completed', 'paywall_viewed', 'checkout_started',
    'checkout_completed', 'trial_started', 'first_generation', 'first_asset_saved',
    'campaign_created', 'limit_reached', 'subscription_activated', 'subscription_canceled',
    'feedback_submitted',
  ];
  for (const e of required) {
    assert.ok(CANONICAL_EVENTS[e], `missing canonical event: ${e}`);
    assert.ok(CANONICAL_EVENTS[e].length > 10, `definition too short: ${e}`);
  }
});

test('client-fireable events are a subset of canonical events', () => {
  for (const e of CLIENT_EVENTS) {
    assert.ok(CANONICAL_EVENTS[e], `client event not canonical: ${e}`);
  }
});

test('redaction drops sensitive keys and keeps safe facts', () => {
  const out = sanitizeProperties({
    plan: 'pro',
    interval: 'yearly',
    feature: 'asset_generations',
    count: 3,
    ok: true,
    // all of these must be stripped:
    password: 'hunter2',
    session_token: 'abc',
    email: 'a@b.com',
    prompt: 'write me a landing page',
    body_copy: 'Full generated body copy…',
    business_name: 'Acme',
  });
  assert.deepEqual(out, { plan: 'pro', interval: 'yearly', feature: 'asset_generations', count: 3, ok: true });
});

test('redaction drops nested objects and over-long strings', () => {
  const out = sanitizeProperties({ nested: { a: 1 }, list: [1, 2], long: 'x'.repeat(200), short: 'ok' });
  assert.deepEqual(out, { short: 'ok' });
});

test('redaction tolerates non-object input', () => {
  assert.deepEqual(sanitizeProperties(null), {});
  assert.deepEqual(sanitizeProperties('nope'), {});
  assert.deepEqual(sanitizeProperties([1, 2]), {});
});

test('activation requires verified + brand profile + a saved generation', () => {
  assert.equal(ACTIVATION.isActivated({ emailVerified: true, brandProfileComplete: true, savedGenerations: 1 }), true);
  assert.equal(ACTIVATION.isActivated({ emailVerified: true, brandProfileComplete: true, savedGenerations: 0 }), false);
  assert.equal(ACTIVATION.isActivated({ emailVerified: false, brandProfileComplete: true, savedGenerations: 5 }), false);
  assert.equal(ACTIVATION.isActivated({ emailVerified: true, brandProfileComplete: false, savedGenerations: 5 }), false);
  assert.ok(ACTIVATION.definition.length > 20);
});
