# Billing state contract matrix (SC-P1-08)

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: backend/tests/fixtures/billing-state-matrix.js
     Regenerate: `node backend/tests/fixtures/billing-state-matrix.js`
     Verified byte-for-byte by backend/tests/billing-state-matrix.test.js. -->

Every named billing state, its expected account label, allowed AI actions,
checkout behavior, trial eligibility, export access, and user-facing message.
Each row is cross-checked against the fixtures; entitlement claims are also
driven through `resolveCanonicalEntitlement()` so they cannot drift from code.

| Scenario | Account label | Allowed AI actions | Checkout behavior | Trial eligible | Export access | User-facing message |
| --- | --- | --- | --- | --- | --- | --- |
| Verified Free | Free | Blocked (paywall) | Allowed — starts 3-day trial | Yes | Always (own data) | You are on the free plan. |
| Eligible first trial | Free (trial available) | Blocked until trial starts | Allowed — 3-day trial applied | Yes | Always (own data) | Start your free 3-day trial. |
| Already-used trial | Free (trial used) | Blocked (paywall) | Allowed — no second trial, pay today | No | Always (own data) | Your free trial was already used. |
| Active current plan | Pro | Allowed (plan limits) | Blocked — ALREADY_SUBSCRIBED (no duplicate) | No | Always (own data) | Your Pro plan is active. |
| Active retired price | Studio (legacy price) | Allowed (plan limits) | Blocked — ALREADY_SUBSCRIBED | No | Always (own data) | Your Studio plan is active. |
| Retired + current overlap | Studio (overlap, reconciling) | Allowed (highest valid plan) | Blocked — ALREADY_SUBSCRIBED | No | Always (own data) | Your Studio plan is active. |
| Past due (dunning) | Past due | Blocked until payment recovers | Allowed — recover via billing portal, no new trial | No | Always (own data) | Your payment failed. Update your card to restore access. |
| Cancel at period end (before expiry) | Pro (ends at period end) | Allowed until expiry | Blocked — ALREADY_SUBSCRIBED | No | Always (own data) | Your plan is active until the end of the billing period. |
| Fully canceled / expired | Free (canceled) | Blocked (paywall) | Allowed — resubscribe, no new trial | No | Always (own data) | Your plan has ended. |
| Unknown price | No access (price unmapped) | Blocked (paywall) | Blocked — checkout fails closed on an unmapped entitling price | No | Always (own data) | We could not match your subscription to a plan. Contact support. |
| Foreign product (shared Stripe account) | Free (no valid entitlement) | Blocked (paywall) | Allowed — starts a genuine plan | Depends on prior trial | Always (own data) | You are on the free plan. |
| Database / verification outage | Unchanged (verification unavailable) | Unchanged — fail-closed, retry | Blocked — no Stripe session while unverifiable | Unknown (not evaluated) | Always (own data) | We could not verify your plan right now. No access change was made. Please try again. |
| Replayed / out-of-order webhook | Unchanged (reconciled to current state) | Unchanged | Not applicable | Not applicable | Always (own data) | (no user-facing message — server reconciliation only) |
| Checkout idempotency | Depends on current plan | Unchanged | No duplicate Stripe session for an already-active plan or replayed key | No (existing subscriber) | Always (own data) | You already have an active subscription. Manage or change your plan from billing. |
| Billing portal return | Depends on current plan | Unchanged | Not applicable | Not applicable | Always (own data) | (returns to the server-configured app URL; any client return URL is ignored) |

## Automated coverage

| Scenario | Layer / test files |
| --- | --- |
| Verified Free | `entitlement-canonical.test.js` |
| Eligible first trial | `billing-trial-eligibility.test.js`, `payments.test.js` |
| Already-used trial | `billing-trial-eligibility.test.js` |
| Active current plan | `entitlement-canonical.test.js`, `payments.test.js` |
| Active retired price | `entitlement-canonical.test.js` |
| Retired + current overlap | `entitlement-canonical.test.js` |
| Past due (dunning) | `entitlement-canonical.test.js`, `webhook-ordering.test.js` |
| Cancel at period end (before expiry) | `entitlement-canonical.test.js` |
| Fully canceled / expired | `entitlement-canonical.test.js` |
| Unknown price | `entitlement-canonical.test.js`, `customers-unknown-price.test.js`, `payments.test.js` |
| Foreign product (shared Stripe account) | `entitlement-canonical.test.js`, `webhook-isolation.test.js` |
| Database / verification outage | `entitlement-fail-closed.test.js`, `payments.test.js` |
| Replayed / out-of-order webhook | `webhook-ordering.test.js`, `subscription-state.test.js` |
| Checkout idempotency | `payments.test.js`, `idempotency.test.js` |
| Billing portal return | `legacy-customer-portal.test.js` |

## Honesty of evidence

- Entitlement rows above are synthetic (`cus_synthetic_*`); no real customer,
  email or live Stripe id appears anywhere in the fixtures or tests.
- Unit/integration coverage uses **pure functions and mocked** Supabase/Stripe.
  No test in this matrix observes a live charge or a real subscription. A mock
  is never reported as an observed live result.
- The signed-in browser matrix (`npm run test:e2e:auth`) is the only layer that
  touches a real (non-production, seeded) database. It refuses to run against
  production, a forbidden project ref, an unrecognized target, or a non-local
  base URL — see `docs/RUNBOOK_AUTH_E2E.md` and `backend/lib/e2e-guard.js`.

