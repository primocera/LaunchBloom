# Billing and webhooks

## B1. Email uniqueness blocks checkout for returning users (High, confirmed in code; confirm schema live)

**Where:** `backend/migrations/001_initial_schema.sql:17` (`email text not null unique`), `backend/routes/payments.js:230-246`, `backend/routes/webhooks.js:571-581`, `backend/routes/account.js` (deletion never removes the `customers` row).

**What:** Under enforcement the customer upsert uses `onConflict: 'app_user_id'`. The table still has a UNIQUE constraint on `email`. When a new user id arrives with an email that already sits on another row, the insert violates the email constraint, the upsert returns an error, and checkout answers `CHECKOUT_UNAVAILABLE` with `retryable: true`. Retrying never helps.

**How a user gets there:**
1. They delete their account (the `customers` row is kept), sign up again with the same email, and try to subscribe.
2. User A changes their login email; user B later registers A's old address.
3. `customer.updated` from Stripe sets an email that exists on another row: `onCustomerUpdated` throws, and Stripe retries the event for days.

**Fix:** Drop the UNIQUE constraint on `customers.email` (keep a plain index) now that `app_user_id` is the key, or on account deletion null/anonymise the email and `app_user_id` link. Make `onCustomerUpdated` tolerate a conflict. First confirm migration 038 did not already drop `customers_email_key`.

**Test to add:** pglite test: row with email X and user U1 exists, upsert `{app_user_id: U2, email: X}` must succeed.

## B2. Subscription webhook can null out `customer_id` (High, confirmed)

**Where:** `backend/routes/webhooks.js:708-717`.

**What:** `onSubscriptionUpdated` looks up the customer and ignores the error. If the read fails or returns nothing, it upserts the whole mirror row with `customer_id: null`, replacing a good link. Entitlement is resolved through `customer_id`, so the subscriber becomes Free. Nothing relinks it until the next subscription event that happens to read successfully (`checkout.session.completed` only fires at first purchase).

**Fix:** Treat a read error as retryable (throw, as the stale check already does). When no customer is found, leave `customer_id` out of the upsert payload so an existing link survives.

**Test to add:** existing linked row + lookup error must throw; lookup miss must keep the old `customer_id`.

## B3. Account deletion continues after a failed Stripe cancellation (High, confirmed)

**Where:** `backend/routes/account.js:266-302`, then steps 2 and 3.

**What:** If the cancel step is `failed` or `skipped` (Stripe unreachable, ownership unreadable, customer lookup threw), the route still deletes all data and the auth user. The subscription keeps renewing and the person can no longer sign in to stop it. The receipt says "contact support", which is honest but leaves a live charge on a deleted account.

**Fix:** Stop before any destructive step unless cancellation is `ok`. Return the receipt with a retry message. Only the `missing` case (no live billing account) should proceed.

## B4. Same-second and concurrent webhook deliveries can leave a stale mirror (High, confirmed logic; frequency unknown)

**Where:** `backend/routes/webhooks.js:523-538` (strict `>` on a one-second timestamp), `:313-347` (`claimEvent`).

**What:** Two weaknesses combine.
- `event.created` has one-second resolution. A no-trial checkout produces `created` (status `incomplete`) and `updated` (status `active`) in the same second. If `updated` is processed first, the later-arriving `created` is not "stale" and overwrites the row with `incomplete`.
- The stale check and the upsert are separate statements, so two deliveries processed at once can both pass the check.
- `claimEvent` lets a second delivery of the same event run while the first is still `processing`, and ignores its own update errors.

The pull-based reconciler (`npm run reconcile:webhooks`) would repair this, but it is manual.

**Fix (simplest robust form):** in the subscription handlers, retrieve the subscription from Stripe and mirror that current state instead of the event payload. Ordering then stops mattering. Cheaper alternative: on a timestamp tie, refetch. Make the claim atomic (`insert ... on conflict do nothing` returning the row, or a conditional update with a short lease).

## B5. Enforcement is one unvalidated env var, default off (Medium, confirmed)

**Where:** `backend/lib/stripe-ownership.js:59-61`; no check in `backend/lib/launch-config.js`.

**What:** Production depends on `STRIPE_OWNERSHIP_ENFORCED=1`. If it is missing after a Vercel env edit or a new environment, the app silently goes back to email-keyed customers and the price-only ownership fallback. Rows written in that state lack `app_user_id`, so they vanish again when the flag returns.

**Fix:** Make enforced the default and fail the production startup check when it is off. Then delete the pre-enforcement branches (see T4): roughly ten `if (enforced) ... else ...` pairs in payments, webhooks, customers and account.

## B6. Invoice emails use the wrong staleness clock (Medium, confirmed logic)

**Where:** `backend/routes/webhooks.js:825-831`, `:894-900`.

**What:** `invoice.paid` and `invoice.payment_failed` are skipped when the subscription row has a newer `stripe_event_at`. That timestamp is written by subscription events, which Stripe emits around the same moment. If `customer.subscription.updated` (to `past_due`) is handled first, the "payment failed, action needed" email is dropped. Same for the recovery email. A dunning email that never sends is involuntary churn.

**Fix:** Do not compare across object types. Dedupe on the invoice id (already done in `sendLifecycleEmail`) and, for `payment_failed`, check the invoice's own current status if a guard is still wanted.

## B7. Dormant lifetime-Pro grant (Medium, confirmed)

**Where:** `backend/routes/customers.js:208-218`.

**What:** Any `payments` row with `status = 'succeeded'` grants Pro forever. Nothing in the app writes that table (top-ups deliberately avoid it). It is an inherited ConversionForge rule that now only serves as a way to grant lifetime access by inserting one row.

**Fix:** Remove the branch after confirming the production table is empty.

## B8. SDK API version and webhook payload version differ (Low to medium, confirmed)

**Where:** `backend/lib/stripe.js:18` pins `2023-10-16`; webhook payloads arrive in the account's newer shape (the code comments mention `2026-04-22`).

**What:** Two shape bugs were already patched (`current_period_*`, `invoice.subscription`). One remains: `webhooks.js:745` and `:751` read `subscription.current_period_end` directly, so on the newer shape the cancellation email has no period end and its dedupe key ends in an empty value.

**Fix:** Use the same item-level fallback as `subscriptionMirrorRow`. Longer term, set the webhook endpoint's API version to match the SDK, or upgrade the SDK (`stripe ^14` is old) and pin both together. Refetching the object (B4) also removes this class of bug.

## B9. Unused billing endpoints (Low, confirmed no frontend caller)

**Where:** `POST /api/payments/cancel-subscription`, `GET /api/payments/subscription/:id`, `GET /api/customers/:id`.

**What:** No reference in `app-src`. The billing portal is the canonical path. `GET /api/customers/:id` checks ownership by email and returns `select('*')`. These are attack surface with no user.

**Fix:** Delete them and their tests.

## B10. Smaller items

- **Trial reuse (Low):** trial eligibility is per account. A new account with a new card gets another 3-day trial and 20 actions. Acceptable at this size; Stripe Radar or a card-fingerprint check closes it later.
- **Top-up refunds (Low):** only a full refund revokes a pack; a failed revoke only emits an ops signal; already-used actions are not clawed back. Fine as policy, but write it down.
- **`customer.updated` copies Stripe's email into `customers.email` (Low after B5):** harmless once email is display-only, but today it feeds the metering window lookup (see M3).

## B11. Decision to challenge: the shared Stripe account

About 1,000 lines (`stripe-ownership.js`, most of `webhooks.js`, the customer recovery in `payments.js`, migrations 038 to 040, the reconciler) exist because Scalvya, Mellowa and Frost share one Stripe account and every endpoint receives every product's events. The logic is careful, but each new event type needs a new ownership rule, and a mistake leaks money events across products.

A separate Stripe account per product removes the whole category. It costs a customer migration, which is cheapest now while the paying cohort is near zero. Recommended before any real paid growth.
