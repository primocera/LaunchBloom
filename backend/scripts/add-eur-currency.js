#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Add EUR (currency_options.eur) to the SAME six live Stripe prices the app
// already uses — the ones STRIPE_PRICE_* point at.
//
// Why this exists: the Stripe DASHBOARD "add another currency" flow creates a
// NEW price id, leaving the app's configured price USD-only — so an EU checkout
// fails with "The price specified only supports `usd`". The Stripe API, unlike
// the Dashboard, can add a currency to an EXISTING price in place. This does
// exactly that, to the exact ids the app charges, so no env var has to change.
//
// Idempotent: re-running just re-sets the same EUR amount. Read-safe otherwise —
// it never touches the USD base amount, the interval, or anything else.
//
// Usage (must be the LIVE key + the LIVE price ids — pull them first):
//   vercel env pull .env.production            # gets live key + live price ids
//   node -r dotenv/config backend/scripts/add-eur-currency.js dotenv_config_path=.env.production
// or set STRIPE_SECRET_KEY + STRIPE_PRICE_* in the environment and run:
//   node backend/scripts/add-eur-currency.js
// Then confirm with:  npm run verify-prices
// ---------------------------------------------------------------------------

require('dotenv').config();

const Stripe = require('stripe');
const { PRICES, STRIPE_ENV } = require('../lib/plan-catalog');

function fail(msg) { console.error(`  ✗ ${msg}`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set — nothing to do.');
    process.exit(2);
  }

  const stripe = Stripe(key);
  const account = await stripe.accounts.retrieve();
  const livemode = !key.startsWith('sk_test');
  console.log(`Stripe account : ${account.id}`);
  console.log(`Mode           : ${livemode ? 'LIVE' : 'TEST'}`);
  console.log('Action         : add EUR currency_options to each configured price\n');

  if (!livemode) {
    console.log('NOTE: this is a TEST-mode key. It will only affect TEST prices.\n' +
                '      Re-run with the LIVE key to fix production checkout.\n');
  }

  const problems = [];

  for (const [plan, intervals] of Object.entries(STRIPE_ENV)) {
    for (const [interval, envVar] of Object.entries(intervals)) {
      const priceId = process.env[envVar];
      const eur = PRICES[plan].eur[interval];
      const cents = Math.round(eur * 100);
      const label = `${plan}/${interval}`;

      if (!priceId) {
        problems.push(`${label}: ${envVar} is not set`);
        fail(`${label}: ${envVar} not set — skipped`);
        continue;
      }

      try {
        const before = await stripe.prices.retrieve(priceId, { expand: ['currency_options'] });
        if (before.currency !== 'usd') {
          problems.push(`${label}: base currency is ${before.currency.toUpperCase()}, expected USD — left untouched`);
          fail(`${label} (${priceId}): base is ${before.currency.toUpperCase()}, not USD — left untouched`);
          continue;
        }
        const updated = await stripe.prices.update(priceId, {
          currency_options: { eur: { unit_amount: cents } },
        });
        const nowEur = updated.currency_options && updated.currency_options.eur;
        if (nowEur && nowEur.unit_amount === cents) {
          ok(`${label} (${priceId}) — EUR ${eur} added (${cents}c) alongside USD ${before.unit_amount / 100}`);
        } else {
          problems.push(`${label}: update did not stick`);
          fail(`${label} (${priceId}): EUR did not persist after update`);
        }
      } catch (err) {
        problems.push(`${label}: ${err.code || err.message}`);
        fail(`${label} (${priceId}): ${err.code || err.message}`);
      }
    }
  }

  console.log('');
  if (problems.length) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('All six prices now carry EUR. Run `npm run verify-prices` to confirm, then retry checkout.');
}

main().catch((err) => {
  console.error('add-eur-currency failed:', err.message);
  process.exit(2);
});
