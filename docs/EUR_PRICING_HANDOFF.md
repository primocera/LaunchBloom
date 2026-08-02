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
- Billing emails (`src/lib/email/billing-facts.ts`) format the *actual* Stripe price
  currency, and the landing schema markup is `priceCurrency: "EUR"` — EUR end to end.
- It has its own `npm run verify-prices` (`scripts/verify-stripe-prices.mjs`).

### Mellowa status: EUR confirmed live — no action

The owner ran a **live checkout test (2026-08-01) and it charged EUR**, which is the
ground truth. Mellowa is EUR-only and working; **do not port Scalvya's dual-currency
work** into it (that would be wrong for a single-currency product and would need
two prices, which is not what's wanted).

Note: the standalone `verify-stripe-prices` script can flag a mismatch if it's
pointed at a USD price id, but the **live charge is authoritative** over the script.
If ever re-checking, confirm against a real recent payment's currency in
Stripe → Payments, not just the script.

### Why Scalvya and Mellowa differ

Scalvya's product copy says USD (US-first) → it kept USD and *added* EUR for EU
buyers (dual-currency, region-switched). Mellowa's product copy says EUR everywhere →
it's simply EUR, one currency, no switching. Same lesson (displayed currency must
equal charged currency), opposite starting point.
