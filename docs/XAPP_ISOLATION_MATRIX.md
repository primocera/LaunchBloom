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
| 1 | Customer/session/subscription carry a Scalvya namespace | Customer `metadata.source = 'launchbloom'` + `app_user_id`; Checkout Session `metadata.scalvya='1'` + `app_user_id`; **`subscription_data.metadata.source = 'launchbloom'` + `app_user_id`** (LB-V17-02 — the subscription is now self-identifying by exact source, not a bare key) — `backend/routes/payments.js` | `billing-idempotent-customer.test.js`, `cross-app-isolation.test.js` |
| 2 | Idempotency key is app + stable user id, never email | `stripeCustomerIdempotencyKey()` → `scalvya:customer:create:<uuid>` — `payments.js` | `cross-app-isolation.test.js` ("idempotency key is app-namespaced …") |
| 3 | Recovery never adopts a foreign customer | `recoverScalvyaCustomer()` matches `source='launchbloom'` **and** `app_user_id` — a foreign `source` (e.g. `mellowa`) with the same email/user id is skipped — `payments.js` | `cross-app-isolation.test.js` ("recovery matches only Scalvya-owned metadata …"), `billing-idempotent-customer.test.js` ("a foreign-product customer … is never adopted") |
| 4 | Multiple candidates fail closed, never arbitrary selection | `CustomerReconciliationRequiredError` — `payments.js` | `cross-app-isolation.test.js`, `billing-idempotent-customer.test.js` ("multiple recovery candidates …") |
| 5 | Foreign webhook event acknowledged, never mutated/emailed/counted | **LB-V17-02 exact ownership:** `ownsSubscription()` accepts ours ONLY via exact `metadata.source='launchbloom'` / `scalvya='1'`; a foreign stamp (`source`≠ours, `app`≠ours, `supabase_user_id`, `mellowa`/`frost`) fails closed; a configured Scalvya price with **no** foreign stamp is a narrow, *measured* legacy fallback. `isOurCharge()` is async and exact: our stamp, else a trusted parent (the charge's Stripe customer is one we own). A **bare `app_user_id` key is no longer proof.** `ignoreForeign()` emits `foreign_event_ignored` and returns with no DB/email/analytics — `backend/routes/webhooks.js` | `cross-app-isolation.test.js` ("only an EXACT source/scalvya stamp …", "a foreign stamp blocks the legacy price fallback", "a charge is ours only via an exact stamp or a customer we own"), `webhook-isolation.test.js` |
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

**LB-V17-02 additions (exact-ownership per object):** a **bare/empty
`app_user_id`** key is now dropped (previously accepted as our stamp); a
**foreign stamp** (`supabase_user_id`/`source=mellowa`) blocks the legacy price
fallback even on a configured price; **charge/dispute** ownership is proven by an
exact stamp or a **trusted parent** (the charge's Stripe customer is one we own —
only our stamped checkout ever writes `customers.stripe_customer_id`), never a
bare key or a price match. Object provenance: **Customer/Session** → exact
`source`/`scalvya` stamp; **Subscription** (created/updated/deleted/trial_will_end)
→ `ownsSubscription()`; **Invoice** → mirrored subscription or configured price;
**Charge/Dispute** → `isOurCharge()` exact stamp or owned-customer parent;
**Portal** → server-config return URL + owned customer only.

## Gaps / required follow-up

- **Mellowa mirror not run here.** Add the symmetric negative tests in the
  Mellowa repo (its own namespace tag, foreign-event filter, recovery). The
  cross-app claim is only fully proven once both repos pass their own matrix.
- **Owner env.** `E2E_FORBIDDEN_SUPABASE_REFS` (auth E2E) and the live
  `STRIPE_PRICE_*` allowlist are owner-configured; this matrix proves the code
  path, not the deployed configuration (owner verifies with `npm run
  verify-prices` against the live key).
