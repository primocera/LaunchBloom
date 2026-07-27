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

// The app quotes USD everywhere (landing, paywall, account, emails, legal).
const EXPECTED_CURRENCY = 'usd';
const EXPECTED_INTERVAL = { monthly: 'month', yearly: 'year' };

function fail(msg) { console.error(`  ✗ ${msg}`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set — nothing to verify.');
    process.exit(2);
  }

  const stripe = Stripe(key);
  const problems = [];

  // ── which account are we even talking to? ────────────────────────────────
  const account = await stripe.accounts.retrieve();
  const livemode = !key.startsWith('sk_test');
  console.log(`Stripe account : ${account.id}`);
  console.log(`Mode           : ${livemode ? 'LIVE' : 'TEST'}`);
  console.log(`Expected       : ${EXPECTED_CURRENCY.toUpperCase()}\n`);

  if (!livemode) {
    console.log('NOTE: this is a TEST-mode key. Test prices say nothing about what\n' +
                '      live customers are charged. Re-run with the live key to verify\n' +
                '      production pricing.\n');
  }

  for (const [plan, intervals] of Object.entries(STRIPE_ENV)) {
    for (const [interval, envVar] of Object.entries(intervals)) {
      const priceId = process.env[envVar];
      const expectedAmount = PRICES[plan][interval];
      const label = `${plan}/${interval}`;

      if (!priceId) {
        problems.push(`${label}: ${envVar} is not set`);
        fail(`${label}: ${envVar} not set`);
        continue;
      }

      let price;
      try {
        price = await stripe.prices.retrieve(priceId);
      } catch (err) {
        problems.push(`${label}: ${priceId} could not be fetched (${err.code || err.message})`);
        fail(`${label}: ${priceId} — ${err.code || err.message}`);
        continue;
      }

      const actualAmount = price.unit_amount / 100;
      const issues = [];

      if (price.currency !== EXPECTED_CURRENCY) {
        issues.push(`currency is ${price.currency.toUpperCase()}, app displays ${EXPECTED_CURRENCY.toUpperCase()}`);
      }
      if (actualAmount !== expectedAmount) {
        issues.push(`charges ${actualAmount}, app displays ${expectedAmount}`);
      }
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
        ok(`${label} — ${price.currency.toUpperCase()} ${actualAmount}/${price.recurring.interval}`);
      }
    }
  }

  console.log('');
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
