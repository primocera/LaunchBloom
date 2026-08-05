# Cross-app Stripe isolation matrix (XAPP-01)

Scalvya (`primocera/LaunchBloom`) and Mellowa (`primocera/Mellowa`) share **one
Stripe account**. A shared account is **not** permission to infer ownership from
an email. This matrix records the Scalvya-side contract with code references and
test names. It was produced without opening the Mellowa repository — the two
apps are audited separately and no code, env value, price id or credential is
copied between them.

> **Scope note.** This document covers only the **Scalvya** half. The symmetric
> Mellowa-side checks (its own metadata namespace, its own foreign-event
> filtering, its own recovery logic) live in the Mellowa repository and are
> **NOT auditable from here**. The final cross-app sign-off requires running the
> mirror of these tests in Mellowa; until then, treat the Mellowa column below
> as *unverified in this session*.

## The Scalvya ownership contract

| # | Isolation property | How Scalvya enforces it (code) | Test |
|---|---|---|---|
| 1 | Customer/session/subscription carry a Scalvya namespace | Customer `metadata.source = 'launchbloom'` + `app_user_id`; Checkout Session `metadata.scalvya='1'` + `app_user_id`; `subscription_data.metadata.app_user_id` — `backend/routes/payments.js` | `billing-idempotent-customer.test.js` ("verified no customer …"), `cross-app-isolation.test.js` |
| 2 | Idempotency key is app + stable user id, never email | `stripeCustomerIdempotencyKey()` → `scalvya:customer:create:<uuid>` — `payments.js` | `cross-app-isolation.test.js` ("idempotency key is app-namespaced …") |
| 3 | Recovery never adopts a foreign customer | `recoverScalvyaCustomer()` matches `source='launchbloom'` **and** `app_user_id` — a foreign `source` (e.g. `mellowa`) with the same email/user id is skipped — `payments.js` | `cross-app-isolation.test.js` ("recovery matches only Scalvya-owned metadata …"), `billing-idempotent-customer.test.js` ("a foreign-product customer … is never adopted") |
| 4 | Multiple candidates fail closed, never arbitrary selection | `CustomerReconciliationRequiredError` — `payments.js` | `cross-app-isolation.test.js`, `billing-idempotent-customer.test.js` ("multiple recovery candidates …") |
| 5 | Foreign webhook event acknowledged, never mutated/emailed/counted | `isOurSubscription()` / `isOurCharge()` (presence of our stamp or our price; unknown → foreign, fail safe) + `ignoreForeign()` emits a `foreign_event_ignored` ops-signal and returns without DB/email/analytics — `backend/routes/webhooks.js` | `cross-app-isolation.test.js` ("a foreign subscription … is NOT ours", "a charge is ours only with our stamp") |
| 6 | Product/price ownership on every configured price | `pricePlans()` maps only the configured `STRIPE_PRICE_*` env ids to a plan; an unconfigured (foreign) price returns undefined — `backend/routes/customers.js` | `cross-app-isolation.test.js` ("every configured Stripe price maps to a Scalvya plan"), `customers-unknown-price.test.js` |
| 7 | Logs expose opaque ids only (no email/PII) | `redactEmail()`, `ops-signal` field allowlist + email scrub — `customers.js`, `lib/ops-signal.js` | `billing-privacy.test.js`, `billing-idempotent-customer.test.js` ("logs … leak neither the full email nor a secret") |

## Symmetrical negative tests (Scalvya side)

`backend/tests/cross-app-isolation.test.js` and
`backend/tests/billing-idempotent-customer.test.js` cover: **same email**
(foreign customer sharing the buyer's email is never adopted), **same-looking
user id** (a foreign `source` with the same `app_user_id` value is not ours),
**foreign product/price** (unconfigured price is not honoured, foreign
subscription is not ours), **missing app metadata** (unstamped event → foreign,
fail safe), **deleted customer** (stale link recovers deterministically), and
**multiple candidate recovery** (reconciliation-required, no arbitrary pick).

## Gaps / required follow-up

- **Mellowa mirror not run here.** Add the symmetric negative tests in the
  Mellowa repo (its own namespace tag, foreign-event filter, recovery). The
  cross-app claim is only fully proven once both repos pass their own matrix.
- **Owner env.** `E2E_FORBIDDEN_SUPABASE_REFS` (auth E2E) and the live
  `STRIPE_PRICE_*` allowlist are owner-configured; this matrix proves the code
  path, not the deployed configuration (owner verifies with `npm run
  verify-prices` against the live key).
