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

## Owner step 3 — apply migration 039 (additive uniqueness) — SV-21-01 / v21

File: `backend/migrations/039_stripe_ownership_enforcement.sql`. Adds a **partial
unique index** on `customers(app_user_id)` so `onConflict: 'app_user_id'` becomes
a safe canonical billing conflict key. Additive, idempotent, reversible.

1. **Preflight (read-only)** — run the duplicate-detection query in the file
   header. It MUST return **zero rows**. If it returns any `app_user_id` with
   `> 1` rows, reconcile those by hand first — never pick an arbitrary winner.
2. **Apply** — run the migration body. `CREATE UNIQUE INDEX` fails closed if any
   duplicate slipped through, which is the intended safety.
3. **Verify** — `customers_app_user_id_key` exists.
- **Rollback** (data-safe) is in the file header.

## Owner step 4 — flip enforcement on (`STRIPE_OWNERSHIP_ENFORCED=1`) — the last switch

The price-only fallback is now sunset by a **reversible env flag**, not by
deleting code (so it can be rolled back instantly if anything is wrong):

- Confirm `GET /api/admin/readiness` reports `ownership.state = "fallback_enabled"`
  with `ownership.blockers = []` — i.e. migration applied, backfill complete
  (`unbackfilledCount = 0`) and **zero** `ambiguous` rows. Only then:
- Set `STRIPE_OWNERSHIP_ENFORCED=1` in production. From that moment:
  - an unstamped Stripe object on a configured Scalvya price is **no longer**
    adopted (`legacy_price` stops granting ownership) — only an exact stamp or an
    explicit `legacy_mapped` row is ours;
  - the local `customers` row is keyed and linked by the stable **app_user_id**
    (email is mutable display data only), and `checkout.session.completed`
    verifies the live Stripe Customer's exact source + this-user stamp before
    persisting.
- Re-check readiness: `ownership.state` must read `"enforcement_active"` with
  `ownership.paid_ready = true`. To roll back, unset the flag.

Until the flag is set, the runtime keeps the fallback, and every use is measured
by the `legacy_price_ownership_fallback` ops-signal so the remaining legacy
population is observable. `paid_ready` is **fail-closed**: it is `true` only in
`enforcement_active`.

## Do NOT

- Do not apply the migration or run `--apply` from CI or a deploy hook.
- Do not adopt any object by email or price during backfill.
- Do not mutate or delete a foreign (Mellowa/Frost) object.
- Do not flip the fallback off (`STRIPE_OWNERSHIP_ENFORCED=1`) while migration 038
  or 039 is unapplied, the backfill is incomplete, or any `ambiguous` mapping row
  is unresolved — `GET /api/admin/readiness` `ownership.blockers` must be empty
  first.
