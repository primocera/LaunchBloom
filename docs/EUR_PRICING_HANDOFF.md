# EUR pricing — Scalvya implementation + Mellowa status

Records how Scalvya added region-based EUR/USD pricing, and — after checking the
Mellowa (dailyflowai) repo — what Mellowa actually needs (spoiler: not this).

## The problem this fixes (Scalvya)

The shared Stripe account is **EU-based** (settles in EUR) but Scalvya's prices
were authored only in **USD**. EU buyers were quoted and *charged* in USD, and
their cards failed 3DS looking like declines ("past due" invoices). Stripe
**Adaptive Pricing does NOT fix this** — it only localizes for buyers in a country
*different* from the account's, needs prices in the settlement currency, and
ignores separate EUR price objects. Scalvya's fix: explicit multi-currency —
attach EUR onto the *same* Stripe price the app charges (`currency_options`), and
have checkout pin EUR for EU buyers, USD for the rest.

## Scalvya implementation (commits)

- `b8809c9` region-based EUR/USD pricing (currency lib, dual-currency catalog, `/api/plans`, checkout, verify script, tests)
- `50b3062` pin EUR only for EU buyers; leave others to Adaptive Pricing
- `70fedff` checkout falls back to USD if a price has no EUR yet (never break checkout)
- `f03a392` `add-eur-currency` script (attach EUR onto existing prices)
- `1bd4b5a` expand `currency_options` so the script confirms its own write; git-ignore `.env.live`

Key files: `backend/lib/currency.js` (NEW, region→currency, gated on `EUR_PRICING_ENABLED`),
`backend/lib/plan-catalog.js` (`PRICES` per-currency + `money()` + `publicCatalog(currency)`),
`backend/routes/plans.js` (currency-aware + `private` cache/Vary), `backend/routes/payments.js`
(pin EUR only for EU + USD fallback), `backend/scripts/{verify-stripe-prices,add-eur-currency}.js`.

Stripe ops: added EUR `currency_options` to the 6 live prices via the API (Dashboard
makes a NEW price; the API edits in place), kept USD default, Adaptive Pricing left ON,
`EUR_PRICING_ENABLED=1` in Vercel. Verified live and working.

## Mellowa (dailyflowai) — DOES NOT need the above

Checked 2026-08-02. Mellowa is a **different stack** (Next.js + TypeScript) and is
**EUR-only by design** — do not port Scalvya's dual-currency code into it.

- `src/lib/stripe/plans.ts` pins `BILLING_CONTRACT = { currency: "eur", monthly 999,
  yearly 5999 }`; `PRICING` shows €9.99/mo and €59.99/yr. One paid plan (PRO), not
  starter/pro/studio.
- `src/app/api/stripe/checkout/route.ts` passes **no** currency — it relies on the
  Stripe price simply *being* EUR. No region detection, no `currency_options`, no
  `EUR_PRICING_ENABLED` flag. Everyone pays EUR.
- The code comments *claimed* the live prices were corrected from USD to EUR — but
  a live verify on 2026-08-02 showed they were **still USD** (999/5999 **usd**)
  behind the €9.99/€59.99 labels. The correction had not actually reached the live
  env. (This also explains EU card declines in the launch rehearsal.)
- It already has its own `npm run verify-prices` (`scripts/verify-stripe-prices.mjs`)
  asserting the live prices match the EUR `BILLING_CONTRACT`.

### What Mellowa actually needed (done 2026-08-02): repoint the env

Ran Mellowa's verify with the live key → both prices FAIL as `usd`. Correct **EUR**
prices already existed on the products (999 eur / 5999 eur), just never wired into
the env. So no new code and no new prices — just repoint the two Vercel vars:

```
STRIPE_PRICE_PRO_MONTHLY = price_1TxjJI0YzvSNMCpN3nWPw01Y
STRIPE_PRICE_PRO_YEARLY  = price_1TxjNa0YzvSNMCpN8H7bU79j
```

Redeploy, then archive the old USD prices (`price_1TvRDS…`, `price_1TvREH…`).
Because Mellowa's checkout charges the price's OWN currency (no currency passed),
the fix is "the price must BE eur" — NOT Scalvya's currency_options approach. To
re-check: `node scripts/verify-stripe-prices.mjs <env-file>` → all OK/eur.

### Why the approaches differ

Scalvya targets USD-first and wanted EUR *added* for EU buyers → dual-currency +
region switching. Mellowa is EUR-only → the price is just EUR, no switching. Same
underlying lesson (displayed currency must equal charged currency), different fix.
