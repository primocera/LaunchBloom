#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Verify that every configured Stripe price actually COSTS what the app says.
//
// Read-only. Exits non-zero on any mismatch.
//
// Why this exists: the release check verified that STRIPE_PRICE_* were SET,
// never what they cost. Verifying presence is not verifying correctness. In the
// sibling product this exact gap shipped live prices in the wrong currency —
// which not only mischarged people (Stripe does not convert; the bank does, at
// its own rate, plus a foreign-transaction fee) but BROKE CHECKOUT outright:
// an EU card asked to authorise a foreign-currency charge failed after 3DS with
// `setup_intent_authentication_failure` / `generic_decline`, which reads exactly
// like a card problem and is not one.
//
// Usage:
//   node backend/scripts/verify-stripe-prices.js
//   npm run verify-prices
//
// The account id and live/test mode are printed FIRST and always. Diagnosing
// the wrong Stripe account is the single most expensive mistake here, and a
// test-mode key silently answers every question with the wrong data.
// ---------------------------------------------------------------------------

require('dotenv').config();

const Stripe = require('stripe');
const { PRICES, STRIPE_ENV } = require('../lib/plan-catalog');

// The app quotes USD (base) and EUR (EU/EEA) — every Stripe Price must carry
// BOTH: USD as the price's own currency and EUR under currency_options.eur.
const BASE_CURRENCY = 'usd';
const EXPECTED_INTERVAL = { monthly: 'month', yearly: 'year' };

function fail(msg) { console.error(`  ✗ ${msg}`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.warn(`  ! ${msg}`); }

// v13 SC-P0-03: EUR is a REQUIRED pair once the EUR launch is switched on —
// a missing or wrong EUR price is then a hard failure, because the pricing page
// would quote euros the checkout cannot honour. While EUR is off, EUR gaps are
// reported as warnings (USD is the only currency anyone can be charged in).
const EUR_REQUIRED = process.env.EUR_PRICING_ENABLED === '1';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set — nothing to verify.');
    process.exit(2);
  }

  const stripe = Stripe(key);
  const problems = [];
  const warnings = [];
  const productsByPlan = {};
  let pairsChecked = 0;

  // ── which account are we even talking to? ────────────────────────────────
  const account = await stripe.accounts.retrieve();
  const livemode = !key.startsWith('sk_test');
  console.log(`Stripe account : ${account.id}`);
  console.log(`Mode           : ${livemode ? 'LIVE' : 'TEST'}`);
  console.log(`Expected       : ${BASE_CURRENCY.toUpperCase()} base + EUR currency_options`);
  console.log(`EUR launch     : ${EUR_REQUIRED ? 'ENABLED — every EUR pair is REQUIRED' : 'disabled — EUR gaps are warnings'}\n`);

  if (!livemode) {
    console.log('NOTE: this is a TEST-mode key. Test prices say nothing about what\n' +
                '      live customers are charged. Re-run with the live key to verify\n' +
                '      production pricing.\n');
  }

  for (const [plan, intervals] of Object.entries(STRIPE_ENV)) {
    for (const [interval, envVar] of Object.entries(intervals)) {
      const priceId = process.env[envVar];
      const expectedUsd = PRICES[plan].usd[interval];
      const expectedEur = PRICES[plan].eur[interval];
      const label = `${plan}/${interval}`;

      if (!priceId) {
        problems.push(`${label}: ${envVar} is not set`);
        fail(`${label}: ${envVar} not set`);
        continue;
      }

      let price;
      try {
        // currency_options is not returned by default — it must be expanded.
        price = await stripe.prices.retrieve(priceId, { expand: ['currency_options'] });
      } catch (err) {
        problems.push(`${label}: ${priceId} could not be fetched (${err.code || err.message})`);
        fail(`${label}: ${priceId} — ${err.code || err.message}`);
        continue;
      }

      const actualUsd = price.unit_amount / 100;
      const issues = [];
      const softIssues = [];
      pairsChecked += 1; // the USD pair

      // Base currency: USD.
      if (price.currency !== BASE_CURRENCY) {
        issues.push(`base currency is ${price.currency.toUpperCase()}, expected ${BASE_CURRENCY.toUpperCase()}`);
      }
      if (actualUsd !== expectedUsd) {
        issues.push(`USD charges ${actualUsd}, app displays ${expectedUsd}`);
      }

      // Product ownership: every price of a plan must hang off ONE product, and
      // that product must be active. A price pointing at another product (or an
      // archived one) is how a plan silently sells the wrong thing.
      const productId = typeof price.product === 'string' ? price.product : price.product?.id;
      if (!productId) {
        issues.push('price has no product');
      } else if (productsByPlan[plan] && productsByPlan[plan] !== productId) {
        issues.push(`product ${productId} differs from ${plan}'s other price (${productsByPlan[plan]})`);
      } else {
        productsByPlan[plan] = productId;
      }

      // EUR must be present under currency_options and match the catalog, or an
      // EU checkout (which sets currency:'eur') fails outright.
      const eurOpt = price.currency_options && price.currency_options.eur;
      const eurIssues = [];
      pairsChecked += 1; // the EUR pair
      if (!eurOpt) {
        eurIssues.push("EUR is not configured on this price (add it via Stripe → the price → 'Add another currency')");
      } else if (eurOpt.unit_amount / 100 !== expectedEur) {
        eurIssues.push(`EUR charges ${eurOpt.unit_amount / 100}, app displays ${expectedEur}`);
      } else if (eurOpt.recurring && eurOpt.recurring.interval
          && eurOpt.recurring.interval !== EXPECTED_INTERVAL[interval]) {
        eurIssues.push(`EUR bills per ${eurOpt.recurring.interval}, expected per ${EXPECTED_INTERVAL[interval]}`);
      }
      (EUR_REQUIRED ? issues : softIssues).push(...eurIssues);

      if (price.recurring?.interval !== EXPECTED_INTERVAL[interval]) {
        issues.push(`bills per ${price.recurring?.interval || 'one-time'}, expected per ${EXPECTED_INTERVAL[interval]}`);
      }
      if (!price.active) {
        issues.push('price is ARCHIVED in Stripe — checkout will fail');
      }

      if (issues.length) {
        problems.push(`${label}: ${issues.join('; ')}`);
        fail(`${label} (${priceId}) — ${issues.join('; ')}`);
      } else {
        const eurText = eurOpt ? `EUR ${eurOpt.unit_amount / 100}` : 'EUR missing';
        ok(`${label} — USD ${actualUsd} + ${eurText} /${price.recurring.interval} · product ${productId}`);
      }
      if (softIssues.length) {
        warnings.push(`${label}: ${softIssues.join('; ')}`);
        warn(`${label}: ${softIssues.join('; ')} (not fatal while EUR_PRICING_ENABLED is off)`);
      }
    }
  }

  console.log('');
  console.log(`Plan/currency pairs checked: ${pairsChecked} (${Object.keys(STRIPE_ENV).length} plans × 2 intervals × 2 currencies)`);
  if (warnings.length) {
    console.warn(`${warnings.length} warning(s) — these become HARD FAILURES with EUR_PRICING_ENABLED=1:`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
  if (problems.length) {
    console.error(`${problems.length} pricing problem(s) found:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('All configured Stripe prices match the displayed catalog.');
}

main().catch((err) => {
  console.error('verify-stripe-prices failed:', err.message);
  process.exit(2);
});
