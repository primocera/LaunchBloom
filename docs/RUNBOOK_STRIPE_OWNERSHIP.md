# Runbook — explicit Stripe object ownership (SV-01 / v20)

Completes the ownership-architecture trio deferred at v19. The **code, schema and
tooling** are landed on branch `v20`; the two production-data steps (applying the
migration and flipping the price-only fallback off) are **owner-only** and remain
**NOT RUN** until the steps below are executed against production.

## What already ships in code (no owner action)

- **One canonical typed ownership service** — `backend/lib/stripe-ownership.js`.
  Pure, dependency-free. Returns a typed state per object
  (`owned` / `foreign` / `legacy_mapped` / `legacy_price` / `ambiguous` /
  `unavailable`) — never a loose boolean. `routes/webhooks.js`,
  `routes/payments.js` and the reconciler all delegate to it, so there is one
  ownership rule, not four. Behaviour is identical to the prior inline logic
  (verified: 978/978 unit tests, including the 55 billing/isolation tests).
- Email and price are **never** sufficient ownership proof; a peer-product stamp
  is positive proof an object is **not** ours; a conflicting exact+foreign stamp
  is **ambiguous** and never adopted.

## Owner step 1 — apply migration 038 (additive, reversible)

File: `backend/migrations/038_stripe_object_ownership.sql`. Additive & idempotent:
adds `customers.app_user_id` (promoted from existing metadata) and the
`stripe_object_ownership` legacy-map table. It moves no money and deletes no rows.

1. **Preflight (read-only)** — run the preflight query in the file header; record
   `customers_total`, `with_meta_user`, `with_stripe`.
2. **Apply** — run the migration body in the Supabase SQL editor.
3. **Verify** — run the verify queries; `backfilled_app_user_id` must equal the
   preflight `with_meta_user`, and `stripe_object_ownership` must exist.
4. Re-run `backend/migrations/CHECK_APPLIED.sql`; then bump the manifest
   `migrations.range` to `001-038` and record the applied evidence.
- **Rollback** (data-safe) is in the file header.

## Owner step 2 — inventory & backfill legacy Stripe objects

Script: `backend/scripts/backfill-stripe-ownership.js`. Requires step 1 applied,
the **live** Stripe key and the service-role Supabase key. PII-free (opaque ids +
counts only). Never runs automatically on deploy.

```
# READ-ONLY inventory first — classify, count, decide nothing is surprising:
node backend/scripts/backfill-stripe-ownership.js

# Bounded backfill (default 50/run). Stamps exact source+app_user_id onto safe
# legacy matches and records an explicit mapping row; ambiguous objects are
# recorded status='ambiguous' for reconciliation and NEVER adopted:
node backend/scripts/backfill-stripe-ownership.js --apply --max 50
# Re-run with --cursor <resume_cursor> from the receipt for the next batch.
```

Reconcile every `status='ambiguous'` row by hand before step 3. Ambiguous objects
**block paid expansion** on purpose — do not adopt by guesswork.

## Owner step 3 — sunset the price-only fallback (the last switch)

Only after steps 1–2 show **zero unmapped legacy subscriptions on a configured
price** (all either exact-stamped `owned` or explicitly `legacy_mapped`):

- Remove the `LEGACY_PRICE` branch from
  `stripe-ownership.classifySubscription` (and the `isOurInvoice` price fallback
  in `routes/webhooks.js`), so an unstamped object is adopted **only** through an
  explicit verified mapping. Add/adjust tests; run `npm run check`.

Until then the runtime keeps the fallback, and every use is already measured by
the `legacy_price_ownership_fallback` ops-signal so the remaining legacy
population is observable.

## Do NOT

- Do not apply the migration or run `--apply` from CI or a deploy hook.
- Do not adopt any object by email or price during backfill.
- Do not mutate or delete a foreign (Mellowa/Frost) object.
- Do not flip the fallback off while any `ambiguous` mapping row is unresolved.
