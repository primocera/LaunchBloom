// ---------------------------------------------------------------------------
// v13 SC-P1-08 — the billing state contract, as deterministic synthetic
// fixtures. This file is the SINGLE SOURCE OF TRUTH for the release matrix:
//
//   - docs/BILLING_STATE_MATRIX.md is RENDERED from renderMatrixDoc() below and
//     cross-checked byte-for-byte by billing-state-matrix.test.js, so the
//     document can never silently drift from the fixtures.
//   - every scenario whose crux is entitlement resolution carries an
//     `entitlement` block (mirrored subscription rows + expected outcome); the
//     same test drives resolveCanonicalEntitlement() with it and asserts the
//     documented plan, so the fixtures can never drift from the CODE either.
//   - every scenario names the test file(s) that actually exercise it
//     (`coveredBy`), at the correct layer, and that file's existence is
//     asserted. A scenario with no automated coverage would fail the test.
//
// Identities are redacted synthetic constants (cus_synthetic_*, no real email,
// no real Stripe id). Nothing here touches Stripe, Supabase or the network.
// ---------------------------------------------------------------------------

'use strict';

// The price→plan map the matrix reasons about. Mirrors routes/customers.js
// pricePlans() shape: current prices plus a retired-but-still-honored legacy
// price (STRIPE_PRICE_BUSINESS → studio). Any price id NOT in this map — a
// truly unknown price, or a foreign product's price on the shared Stripe
// account — grants nothing. That absence IS the product-isolation boundary.
const PRICE_PLANS = Object.freeze({
  price_starter_current: 'starter',
  price_pro_current: 'pro',
  price_studio_current: 'studio',
  price_business_legacy: 'studio', // retired price, still mapped and honored
});

const SUB = 'cus_synthetic_0001';

// Each scenario documents the release contract for one billing state.
// Columns (matrix doc): accountLabel, aiActions, checkout, trialEligible,
// exportAccess, message. `entitlement` (optional) makes the plan claim
// executable; `coveredBy` names the automated coverage.
const SCENARIOS = Object.freeze([
  {
    key: 'verified_free',
    name: 'Verified Free',
    accountLabel: 'Free',
    aiActions: 'Blocked (paywall)',
    checkout: 'Allowed — starts 3-day trial',
    trialEligible: 'Yes',
    exportAccess: 'Always (own data)',
    message: 'You are on the free plan.',
    entitlement: { rows: [], expect: { plan: null, unmapped: false, anomalies: [] } },
    coveredBy: ['entitlement-canonical.test.js'],
  },
  {
    key: 'eligible_first_trial',
    name: 'Eligible first trial',
    accountLabel: 'Free (trial available)',
    aiActions: 'Blocked until trial starts',
    checkout: 'Allowed — 3-day trial applied',
    trialEligible: 'Yes',
    exportAccess: 'Always (own data)',
    message: 'Start your free 3-day trial.',
    coveredBy: ['billing-trial-eligibility.test.js', 'payments.test.js'],
  },
  {
    key: 'already_used_trial',
    name: 'Already-used trial',
    accountLabel: 'Free (trial used)',
    aiActions: 'Blocked (paywall)',
    checkout: 'Allowed — no second trial, pay today',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your free trial was already used.',
    coveredBy: ['billing-trial-eligibility.test.js'],
  },
  {
    key: 'active_current_plan',
    name: 'Active current plan',
    accountLabel: 'Pro',
    aiActions: 'Allowed (plan limits)',
    checkout: 'Blocked — ALREADY_SUBSCRIBED (no duplicate)',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your Pro plan is active.',
    entitlement: {
      rows: [{ status: 'active', stripe_price_id: 'price_pro_current', stripe_subscription_id: `${SUB}_a` }],
      expect: { plan: 'pro', unmapped: false, anomalies: [] },
    },
    coveredBy: ['entitlement-canonical.test.js', 'payments.test.js'],
  },
  {
    key: 'active_retired_price',
    name: 'Active retired price',
    accountLabel: 'Studio (legacy price)',
    aiActions: 'Allowed (plan limits)',
    checkout: 'Blocked — ALREADY_SUBSCRIBED',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your Studio plan is active.',
    entitlement: {
      rows: [{ status: 'active', stripe_price_id: 'price_business_legacy', stripe_subscription_id: `${SUB}_b` }],
      expect: { plan: 'studio', unmapped: false, anomalies: [] },
    },
    coveredBy: ['entitlement-canonical.test.js'],
  },
  {
    key: 'retired_plus_current_overlap',
    name: 'Retired + current overlap',
    accountLabel: 'Studio (overlap, reconciling)',
    aiActions: 'Allowed (highest valid plan)',
    checkout: 'Blocked — ALREADY_SUBSCRIBED',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your Studio plan is active.',
    entitlement: {
      rows: [
        { status: 'active', stripe_price_id: 'price_business_legacy', stripe_subscription_id: `${SUB}_b`, stripe_event_at: '2026-08-01T00:00:00Z' },
        { status: 'active', stripe_price_id: 'price_pro_current', stripe_subscription_id: `${SUB}_c`, stripe_event_at: '2026-08-02T00:00:00Z' },
      ],
      // Highest valid entitlement wins (studio > pro) regardless of which row is
      // newer; the overlap is reported for reconciliation, never a lockout.
      expect: { plan: 'studio', unmapped: false, anomalies: ['overlapping_subscriptions'] },
    },
    coveredBy: ['entitlement-canonical.test.js'],
  },
  {
    key: 'past_due',
    name: 'Past due (dunning)',
    accountLabel: 'Past due',
    aiActions: 'Blocked until payment recovers',
    checkout: 'Allowed — recover via billing portal, no new trial',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your payment failed. Update your card to restore access.',
    entitlement: {
      rows: [{ status: 'past_due', stripe_price_id: 'price_pro_current', stripe_subscription_id: `${SUB}_a` }],
      expect: { plan: null, unmapped: false, anomalies: [] },
    },
    coveredBy: ['entitlement-canonical.test.js', 'webhook-ordering.test.js'],
  },
  {
    key: 'cancel_at_period_end',
    name: 'Cancel at period end (before expiry)',
    accountLabel: 'Pro (ends at period end)',
    aiActions: 'Allowed until expiry',
    checkout: 'Blocked — ALREADY_SUBSCRIBED',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your plan is active until the end of the billing period.',
    entitlement: {
      // cancel_at_period_end is a flag on a row whose status is STILL active;
      // access holds until Stripe flips it to canceled.
      rows: [{ status: 'active', stripe_price_id: 'price_pro_current', stripe_subscription_id: `${SUB}_a` }],
      expect: { plan: 'pro', unmapped: false, anomalies: [] },
    },
    coveredBy: ['entitlement-canonical.test.js'],
  },
  {
    key: 'canceled_expired',
    name: 'Fully canceled / expired',
    accountLabel: 'Free (canceled)',
    aiActions: 'Blocked (paywall)',
    checkout: 'Allowed — resubscribe, no new trial',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'Your plan has ended.',
    entitlement: {
      rows: [{ status: 'canceled', stripe_price_id: 'price_pro_current', stripe_subscription_id: `${SUB}_a` }],
      expect: { plan: null, unmapped: false, anomalies: [] },
    },
    coveredBy: ['entitlement-canonical.test.js'],
  },
  {
    key: 'unknown_price',
    name: 'Unknown price',
    accountLabel: 'No access (price unmapped)',
    aiActions: 'Blocked (paywall)',
    checkout: 'Blocked — checkout fails closed on an unmapped entitling price',
    trialEligible: 'No',
    exportAccess: 'Always (own data)',
    message: 'We could not match your subscription to a plan. Contact support.',
    entitlement: {
      rows: [{ status: 'active', stripe_price_id: 'price_unknown_zzz', stripe_subscription_id: `${SUB}_a` }],
      // Never silently grant an unmapped price; flag it for operations.
      expect: { plan: null, unmapped: true, anomalies: ['unmapped_price'] },
    },
    coveredBy: ['entitlement-canonical.test.js', 'customers-unknown-price.test.js', 'payments.test.js'],
  },
  {
    key: 'foreign_product',
    name: 'Foreign product (shared Stripe account)',
    accountLabel: 'Free (no valid entitlement)',
    aiActions: 'Blocked (paywall)',
    checkout: 'Allowed — starts a genuine plan',
    trialEligible: 'Depends on prior trial',
    exportAccess: 'Always (own data)',
    message: 'You are on the free plan.',
    entitlement: {
      // A different app's product on the same Stripe account: its price id can
      // never appear in our map, so it can never entitle or raise a plan.
      rows: [{ status: 'active', stripe_price_id: 'price_foreign_app_prod', stripe_subscription_id: `${SUB}_x` }],
      expect: { plan: null, unmapped: true, anomalies: ['unmapped_price'] },
    },
    coveredBy: ['entitlement-canonical.test.js', 'webhook-isolation.test.js'],
  },
  {
    key: 'database_outage',
    name: 'Database / verification outage',
    accountLabel: 'Unchanged (verification unavailable)',
    aiActions: 'Unchanged — fail-closed, retry',
    checkout: 'Blocked — no Stripe session while unverifiable',
    trialEligible: 'Unknown (not evaluated)',
    exportAccess: 'Always (own data)',
    message: 'We could not verify your plan right now. No access change was made. Please try again.',
    // Not a pure-resolver case: the outage is a thrown error inside
    // resolveEntitlement, surfaced as the explicit 'unavailable' state.
    coveredBy: ['entitlement-fail-closed.test.js', 'payments.test.js'],
  },
  {
    key: 'replayed_out_of_order_webhook',
    name: 'Replayed / out-of-order webhook',
    accountLabel: 'Unchanged (reconciled to current state)',
    aiActions: 'Unchanged',
    checkout: 'Not applicable',
    trialEligible: 'Not applicable',
    exportAccess: 'Always (own data)',
    message: '(no user-facing message — server reconciliation only)',
    coveredBy: ['webhook-ordering.test.js', 'subscription-state.test.js'],
  },
  {
    key: 'checkout_idempotency',
    name: 'Checkout idempotency',
    accountLabel: 'Depends on current plan',
    aiActions: 'Unchanged',
    checkout: 'No duplicate Stripe session for an already-active plan or replayed key',
    trialEligible: 'No (existing subscriber)',
    exportAccess: 'Always (own data)',
    message: 'You already have an active subscription. Manage or change your plan from billing.',
    coveredBy: ['payments.test.js', 'idempotency.test.js'],
  },
  {
    key: 'portal_return',
    name: 'Billing portal return',
    accountLabel: 'Depends on current plan',
    aiActions: 'Unchanged',
    checkout: 'Not applicable',
    trialEligible: 'Not applicable',
    exportAccess: 'Always (own data)',
    message: '(returns to the server-configured app URL; any client return URL is ignored)',
    coveredBy: ['legacy-customer-portal.test.js'],
  },
]);

const COLUMNS = Object.freeze([
  ['name', 'Scenario'],
  ['accountLabel', 'Account label'],
  ['aiActions', 'Allowed AI actions'],
  ['checkout', 'Checkout behavior'],
  ['trialEligible', 'Trial eligible'],
  ['exportAccess', 'Export access'],
  ['message', 'User-facing message'],
]);

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

/**
 * Render docs/BILLING_STATE_MATRIX.md deterministically from SCENARIOS. The test
 * compares the committed file against this output byte-for-byte, so editing the
 * doc by hand (without the fixtures) fails, and vice versa.
 */
function renderMatrixDoc() {
  const lines = [];
  lines.push('# Billing state contract matrix (SC-P1-08)');
  lines.push('');
  lines.push('<!-- GENERATED FILE — do not edit by hand.');
  lines.push('     Source of truth: backend/tests/fixtures/billing-state-matrix.js');
  lines.push('     Regenerate: `node backend/tests/fixtures/billing-state-matrix.js`');
  lines.push('     Verified byte-for-byte by backend/tests/billing-state-matrix.test.js. -->');
  lines.push('');
  lines.push('Every named billing state, its expected account label, allowed AI actions,');
  lines.push('checkout behavior, trial eligibility, export access, and user-facing message.');
  lines.push('Each row is cross-checked against the fixtures; entitlement claims are also');
  lines.push('driven through `resolveCanonicalEntitlement()` so they cannot drift from code.');
  lines.push('');

  const header = `| ${COLUMNS.map(([, label]) => label).join(' | ')} |`;
  const divider = `| ${COLUMNS.map(() => '---').join(' | ')} |`;
  lines.push(header);
  lines.push(divider);
  for (const s of SCENARIOS) {
    const cells = COLUMNS.map(([key]) => escapeCell(s[key]));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Automated coverage');
  lines.push('');
  lines.push('| Scenario | Layer / test files |');
  lines.push('| --- | --- |');
  for (const s of SCENARIOS) {
    lines.push(`| ${escapeCell(s.name)} | ${s.coveredBy.map((f) => `\`${f}\``).join(', ')} |`);
  }
  lines.push('');
  lines.push('## Honesty of evidence');
  lines.push('');
  lines.push('- Entitlement rows above are synthetic (`cus_synthetic_*`); no real customer,');
  lines.push('  email or live Stripe id appears anywhere in the fixtures or tests.');
  lines.push('- Unit/integration coverage uses **pure functions and mocked** Supabase/Stripe.');
  lines.push('  No test in this matrix observes a live charge or a real subscription. A mock');
  lines.push('  is never reported as an observed live result.');
  lines.push('- The signed-in browser matrix (`npm run test:e2e:auth`) is the only layer that');
  lines.push('  touches a real (non-production, seeded) database. It refuses to run against');
  lines.push('  production, a forbidden project ref, an unrecognized target, or a non-local');
  lines.push('  base URL — see `docs/RUNBOOK_AUTH_E2E.md` and `backend/lib/e2e-guard.js`.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = { PRICE_PLANS, SCENARIOS, COLUMNS, renderMatrixDoc };

// `node backend/tests/fixtures/billing-state-matrix.js` regenerates the doc.
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const out = path.join(__dirname, '..', '..', '..', 'docs', 'BILLING_STATE_MATRIX.md');
  fs.writeFileSync(out, renderMatrixDoc(), 'utf8');
  console.log(`wrote ${out}`);
}
