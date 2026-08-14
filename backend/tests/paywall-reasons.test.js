// ---------------------------------------------------------------------------
// v18 S13 — the one typed paywall reason contract (app-src/lib/paywall-reasons.js).
//
// A paywall must never open with an ad-hoc string: every monetisation boundary
// resolves to exactly one reason in a closed set, and the resolver maps the
// server 402 codes onto it. These tests lock that mapping and the fail-safe:
// unknown/loading eligibility never invents a trial it hasn't verified.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'app-src', 'lib', 'paywall-reasons.js'),
).href;
const load = () => import(modUrl);

test('the reason set is closed and every reason has renderable copy', async () => {
  const { PAYWALL_REASONS, PAYWALL_REASON_KEYS } = await load();
  const expected = [
    'trial_required', 'trial_expired', 'quota_reached', 'export_not_in_plan',
    'payment_past_due', 'cancelled', 'permission_denied',
  ];
  assert.deepEqual([...PAYWALL_REASON_KEYS].sort(), [...expected].sort());
  for (const key of expected) {
    const r = PAYWALL_REASONS[key];
    assert.ok(r.title && r.title.length > 5, `${key} needs a title`);
    assert.ok(r.lead && r.lead.length > 5, `${key} needs a lead`);
    // Every reason reassures that work is retained — the pack forbids erasing inputs.
    assert.match(r.lead, /work is saved|nothing has changed/i, `${key} must not imply lost work`);
    assert.ok(r.cta, `${key} needs a cta`);
  }
});

test('server 402 codes map to the right reason', async () => {
  const { resolvePaywallReason } = await load();
  assert.equal(resolvePaywallReason({ code: 'UPGRADE' }), 'quota_reached');
  assert.equal(resolvePaywallReason({ code: 'EXPORT_NOT_IN_PLAN' }), 'export_not_in_plan');
  assert.equal(resolvePaywallReason({ code: 'PAYMENT_PAST_DUE' }), 'payment_past_due');
  assert.equal(resolvePaywallReason({ code: 'SUBSCRIPTION_CANCELLED' }), 'cancelled');
  assert.equal(resolvePaywallReason({ code: 'PERMISSION_DENIED' }), 'permission_denied');
});

test('the first-generation credits boundary splits on trial eligibility', async () => {
  const { resolvePaywallReason } = await load();
  assert.equal(resolvePaywallReason({ code: 'CREDITS', trialEligible: true }), 'trial_required');
  assert.equal(resolvePaywallReason({ code: 'CREDITS', trialEligible: false }), 'trial_expired');
});

test('an explicit valid reason always wins over inference', async () => {
  const { resolvePaywallReason } = await load();
  assert.equal(resolvePaywallReason({ reason: 'payment_past_due', code: 'CREDITS', trialEligible: true }), 'payment_past_due');
});

test('an unknown reason string is ignored, not trusted', async () => {
  const { resolvePaywallReason } = await load();
  // A junk reason must fall through to code/eligibility resolution, never render as-is.
  assert.equal(resolvePaywallReason({ reason: 'free_money', code: 'UPGRADE' }), 'quota_reached');
});

test('unknown eligibility never promises a charge — defaults to the trial path, not subscribe', async () => {
  const { resolvePaywallReason } = await load();
  // null (still loading): show the trial path; the component gate suppresses any
  // charge claim until the server confirms, so this cannot over-promise access.
  assert.equal(resolvePaywallReason({ trialEligible: null }), 'trial_required');
  assert.equal(resolvePaywallReason({}), 'trial_required');
});

test('paywallCopy returns a safe default for a bad key rather than undefined', async () => {
  const { paywallCopy } = await load();
  assert.ok(paywallCopy('nonsense').title, 'a bad key must still render a header');
});
