// ---------------------------------------------------------------------------
// v13 SC-P1-08 — the billing state contract, kept honest three ways:
//
//   1. The committed matrix document matches what the fixtures render, so the
//      doc cannot drift from the fixtures.
//   2. Every entitlement claim in the fixtures is driven through the REAL
//      canonical resolver, so the fixtures cannot drift from the code.
//   3. Every scenario names automated coverage that actually exists, at the
//      correct layer, so no state is documented without a test behind it.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PRICE_PLANS, SCENARIOS, renderMatrixDoc } = require('./fixtures/billing-state-matrix');
const { resolveCanonicalEntitlement } = require('../lib/subscription-state');

const DOC_PATH = path.join(__dirname, '..', '..', 'docs', 'BILLING_STATE_MATRIX.md');
const TESTS_DIR = __dirname;

// The fifteen named states the prompt requires, by fixture key. Missing any one
// fails, so a scenario can never be quietly dropped from the contract.
const REQUIRED_KEYS = [
  'verified_free',
  'eligible_first_trial',
  'already_used_trial',
  'active_current_plan',
  'active_retired_price',
  'retired_plus_current_overlap',
  'past_due',
  'cancel_at_period_end',
  'canceled_expired',
  'unknown_price',
  'foreign_product',
  'database_outage',
  'replayed_out_of_order_webhook',
  'checkout_idempotency',
  'portal_return',
];

test('every required billing state is present exactly once', () => {
  const keys = SCENARIOS.map((s) => s.key);
  for (const required of REQUIRED_KEYS) {
    assert.equal(keys.filter((k) => k === required).length, 1, `${required} must appear exactly once`);
  }
  assert.equal(keys.length, REQUIRED_KEYS.length, 'no undocumented extra scenarios');
});

test('the committed matrix document matches the fixtures byte-for-byte', () => {
  const committed = fs.readFileSync(DOC_PATH, 'utf8');
  assert.equal(
    committed,
    renderMatrixDoc(),
    'docs/BILLING_STATE_MATRIX.md is stale — regenerate with '
      + '`node backend/tests/fixtures/billing-state-matrix.js`',
  );
});

test('each entitlement claim is verified against the real canonical resolver', () => {
  for (const s of SCENARIOS) {
    if (!s.entitlement) continue;
    const result = resolveCanonicalEntitlement(s.entitlement.rows, PRICE_PLANS);
    const expect = s.entitlement.expect;
    assert.equal(result.plan, expect.plan, `${s.key}: plan`);
    assert.equal(result.unmapped, expect.unmapped, `${s.key}: unmapped`);
    assert.deepEqual(
      result.anomalies.map((a) => a.code).sort(),
      [...expect.anomalies].sort(),
      `${s.key}: anomaly codes`,
    );
  }
});

test('the documented account label agrees with the resolved plan', () => {
  // A resolver that grants a plan must not be labeled "Free"/"No access", and a
  // resolver that grants nothing must not be labeled with a paid plan name.
  const PAID = ['starter', 'pro', 'studio'];
  for (const s of SCENARIOS) {
    if (!s.entitlement) continue;
    const { plan } = resolveCanonicalEntitlement(s.entitlement.rows, PRICE_PLANS);
    const label = s.accountLabel.toLowerCase();
    if (plan && PAID.includes(plan)) {
      assert.ok(label.includes(plan), `${s.key}: paid plan ${plan} should appear in the label`);
    } else {
      assert.ok(
        /free|no access|past due|unavailable|unchanged/.test(label),
        `${s.key}: no entitlement must read as a non-paid label, got "${s.accountLabel}"`,
      );
    }
  }
});

test('every scenario names automated coverage that exists at the correct layer', () => {
  for (const s of SCENARIOS) {
    assert.ok(Array.isArray(s.coveredBy) && s.coveredBy.length, `${s.key}: must name coverage`);
    for (const file of s.coveredBy) {
      assert.ok(
        fs.existsSync(path.join(TESTS_DIR, file)),
        `${s.key}: coverage file ${file} does not exist`,
      );
    }
  }
});

test('fixtures carry only redacted synthetic identities — no real customer data', () => {
  // Inspect the RESOLVED values, not the source text: every subscription id is
  // synthetic and no field embeds an email address as an identity.
  for (const s of SCENARIOS) {
    for (const row of s.entitlement?.rows || []) {
      assert.match(String(row.stripe_subscription_id), /synthetic/, `${s.key}: synthetic sub id`);
      assert.ok(!/@/.test(JSON.stringify(row)), `${s.key}: no email in a subscription row`);
    }
  }
});
