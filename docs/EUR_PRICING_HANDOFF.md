# EUR pricing — handoff for replicating in Mellowa

How Scalvya added region-based EUR/USD pricing, and exactly what to repeat in the
Mellowa repo. Same shared (EU-based) Stripe account, same ConversionForge-derived
stack, so this is mostly a copy — but read the **Mellowa-specific cautions** first.

## The problem this fixes

The Stripe account is **EU-based** (settles in EUR) but prices were authored only
in **USD**. Result: EU buyers were quoted and *charged* in USD, and their cards
failed 3DS looking like declines ("past due" invoices). Stripe **Adaptive Pricing
does NOT fix this** — it only localizes for buyers in a country *different* from
the account's, needs prices in the settlement currency, and ignores separate EUR
price objects. The fix is explicit multi-currency: attach EUR onto the *same*
Stripe price the app charges (`currency_options`), and have checkout pin EUR for
EU buyers.

## Scalvya reference commits (copy these changes)

- `b8809c9` region-based EUR/USD pricing (currency lib, dual-currency catalog, `/api/plans`, checkout, verify script, tests)
- `50b3062` pin EUR only for EU buyers; leave others to Adaptive Pricing
- `70fedff` checkout falls back to USD if a price has no EUR yet (never break checkout)
- `f03a392` `add-eur-currency` script (attach EUR onto existing prices)
- `1bd4b5a` expand `currency_options` so the script confirms its own write; git-ignore `.env.live`

## Code changes (mirror in Mellowa)

1. **`backend/lib/currency.js`** (NEW) — `EUR_COUNTRIES` (EU-27 + EEA), `currencyForCountry`,
   `currencyForRequest(req)` reading `x-vercel-ip-country` (Cloudflare fallback), fail-closed
   to USD. **Gated behind `EUR_PRICING_ENABLED`** — off ⇒ always USD, so deploy is inert until
   the flag is set. `eurEnabled()` exported.
2. **`backend/lib/plan-catalog.js`** — `PRICES` becomes `{plan:{usd:{monthly,yearly}, eur:{...}}}`.
   Add `money(amount, currency)` (`$`/`€`). `yearlySavings(plan, currency)`, `maxSavingsPct(currency)`.
   `publicCatalog(currency='usd')` returns that currency's display + a `currency` field, plus a
   `currency_note` gated on `EUR_PRICING_ENABLED`.
3. **`backend/routes/plans.js`** — `const currency = currencyForRequest(req)`, pass to
   `publicCatalog(currency)`. **Change caching**: `Cache-Control: private, max-age=300` +
   `res.vary('X-Vercel-IP-Country')` — never `public` again (a CDN would serve one region's
   currency to another).
4. **`backend/routes/payments.js`** — build `sessionParams` without currency; then
   `stripe.checkout.sessions.create(currency === 'eur' ? {...sessionParams, currency:'eur'} : sessionParams)`.
   **Pin EUR only for EU**; leave others unset so Adaptive Pricing localizes them. Wrap in a
   try/catch that, on a StripeInvalidRequestError whose message mentions currency+usd/eur,
   retries WITHOUT currency (USD fallback) so checkout never hard-breaks.
5. **`backend/scripts/verify-stripe-prices.js`** — retrieve with `expand:['currency_options']`;
   assert base currency `usd` + `currency_options.eur` present and matching for every price.
6. **`backend/scripts/add-eur-currency.js`** (NEW) — one-shot idempotent: for each `STRIPE_PRICE_*`,
   `stripe.prices.update(id, { currency_options:{ eur:{ unit_amount: cents }}, expand:['currency_options'] })`.
   The Stripe **Dashboard makes a NEW price** when you "add a currency"; the **API edits in place** —
   that's why this script exists.
7. **`package.json`** — `"add-eur-prices": "node backend/scripts/add-eur-currency.js"`.
8. **`.gitignore`** — add `.env.live`, `.env.production`, `.env.*.local`.
9. **Tests** — port `backend/tests/currency.test.js` (NEW) and the dual-currency updates in
   `plan-catalog.test.js`, `pricing-contract.test.js`, `payments.test.js` (EU→EUR, non-EU pins
   nothing, USD fallback, flag-off ⇒ USD).

## Ops steps (owner)

1. **Pick Mellowa's EUR amounts** from ITS OWN USD prices — do NOT reuse Scalvya's numbers.
   Convert at the ECB rate (Scalvya used 1 USD = 0.8707 on 2026-07-31; use a current rate),
   monthly to cents, yearly to whole euros. Put them in Mellowa's `plan-catalog` `PRICES.eur`.
2. **Attach EUR to Mellowa's live prices** with the script. Create a git-ignored `.env.live`
   holding Mellowa's live `STRIPE_SECRET_KEY` + Mellowa's `STRIPE_PRICE_*` ids, then:
   ```
   node -r dotenv/config backend/scripts/add-eur-currency.js dotenv_config_path=.env.live
   node -r dotenv/config backend/scripts/verify-stripe-prices.js dotenv_config_path=.env.live
   ```
   Confirm `Mode: LIVE`, the correct account, and all ✓. Then **delete `.env.live`**.
3. **Keep USD as the default** currency on each price; add EUR alongside. **Adaptive Pricing can
   stay ON** (account-wide, already enabled) — it serves non-EU buyers; EU is pinned to EUR.
4. **Vercel** → set `EUR_PRICING_ENABLED=1` on the Mellowa project → redeploy.
5. **Test**: fresh EU email, **no VPN** → EUR shown and charged. Non-EU → USD.

## Mellowa-specific cautions

- **Different prices/plans.** Mellowa's plan names, amounts, and number of prices differ. Adjust
  `PRICES`, `STRIPE_ENV`, and `PLAN_LIMITS` mappings to Mellowa's actual catalog — don't assume
  starter/pro/studio.
- **Shared Stripe account.** Mellowa's price IDs are different objects in the same account. Only
  touch Mellowa's price IDs. Adaptive Pricing is already on account-wide.
- **Per-customer currency pinning.** Stripe pins currency to a customer on first transaction, so
  only NEW customers see EUR — test with a fresh `+alias` email, never a reused one.
- **Rollback.** Unset `EUR_PRICING_ENABLED` and redeploy ⇒ back to USD-only instantly. The USD
  fallback in checkout means a half-configured state never errors.
- **Key hygiene.** Any live key placed in a local file should be rolled afterwards. Never commit
  `.env.live`.
