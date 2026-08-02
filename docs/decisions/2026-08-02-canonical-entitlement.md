# Decision record — canonical entitlement across overlapping Stripe subscriptions

Date: 2026-08-02 · Prompt: SC-P0-02 (v13) · Depends on: SC-P0-01 (`resolveEntitlement`)

## Problem

A customer can hold more than one mirrored `subscriptions` row in an entitling
status (`active`, `trialing`):

- a retired price sitting beside the current one (seen live 2026-08-02),
- an overlapping upgrade where the old subscription has not yet been canceled,
- a trialing row beside an active paid row,
- rows for prices we cannot map (misconfigured env, or another product on the
  shared Stripe account).

Before this change, `resolveEntitlement()` took **the first entitling row whose
price maps**, ordered by `stripe_event_at DESC`. That is "newest mapped row".

## Options compared

| Option | Rule | Verdict |
|---|---|---|
| A. Newest mapped row | order by `stripe_event_at` desc, first mapped wins | **Rejected.** Silently downgrades: a Studio customer who reactivated an old Starter sub, or whose Starter row simply received a later event (an invoice touch), loses Studio. Also depends on a nullable timestamp. |
| B. Highest valid entitlement | among rows that are entitling AND map to one of our prices, take the highest plan rank | **Chosen.** Cannot silently downgrade while two valid rows coexist. Worst case we over-grant to a customer who is genuinely paying us twice — a billing anomaly to reconcile, never a lockout. |
| C. Stripe "primary"/current subscription | call Stripe at read time and use its notion of the current subscription | **Rejected.** Stripe has no "primary subscription" concept; this would add a live API call on every plan read (latency + rate limits + a new failure mode that SC-P0-01 just closed). |
| D. Event-order-based canonical record | the row whose `stripe_event_at` is newest *wins the whole account* | **Rejected.** Same downgrade hazard as A, plus it makes entitlement depend on webhook delivery order — exactly what SC-V12-04 removed. |

## Chosen policy

**Highest valid entitlement wins**, encoded once in the pure resolver
`resolveCanonicalEntitlement(rows, pricePlans)` in `backend/lib/subscription-state.js`.

1. Consider only rows in `ENTITLING_STATUSES` (`active`, `trialing`). Everything
   else (`past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired`,
   `paused`, unknown status) is non-entitling — unchanged from SC-V12-04.
   `cancel_at_period_end` does not change status, so a canceling-but-still-paid
   customer stays entitled for the rest of the period.
2. Map each candidate to a plan: `trialing` → `trial` on any price; `active` →
   the plan its price maps to, or nothing. **An unmapped price never grants
   access** — that is also our shared-Stripe product isolation: a foreign
   product's price id is not in `STRIPE_PRICE_*`, so it can never entitle.
3. Rank: `trial(1) < starter(2) < pro(3) < studio(4)`. Highest rank wins.
4. Deterministic tie-break inside the same rank, so the answer never depends on
   database row order: newest `stripe_event_at` first (missing timestamp sorts
   last), then `stripe_subscription_id` ascending, then `stripe_price_id`.
5. Anomalies are computed **separately from access**. A customer keeps the
   safest valid entitlement while the overlap is reported.

## Named outcomes

| Situation | Access | Anomaly |
|---|---|---|
| No customer / no entitling row | `free` | — |
| One entitling mapped row | that plan | — |
| Retired (unmapped) price + current mapped row | the mapped plan | `unmapped_price` |
| Two mapped rows, different levels | the **higher** plan | `overlapping_subscriptions` |
| Trialing + active paid | the paid plan | `overlapping_subscriptions` |
| Entitling rows, none mapped | `unmapped` (no access, checkout blocked) | `unmapped_price` |
| Foreign product price | not granted (treated as unmapped) | `unmapped_price` |
| `past_due` / expired / incomplete | `free` | — |
| Lookup failed (db/provider) | `unavailable` (fail closed, SC-P0-01) | `PLAN_LOOKUP_FAILED` |

Anomalies are emitted as one redacted structured line
(`code: BILLING_ANOMALY`) with a masked email for correlation, opaque
subscription/price ids, and never a raw address.

## Surfaces bound to this source of truth

`resolveEntitlement()` in `backend/routes/customers.js` is the only caller of the
resolver, and every billing surface goes through it:

- checkout prevention — `routes/payments.js` (`resolveEntitlement`)
- account display — `routes/account.js`, `routes/auth.js` (`planFor`)
- usage allowance — `lib/plan-limits.js` `planGate` (`planFor`)
- support/ops tooling — `backend/scripts/reconcile-entitlements.js`

## Reconciliation

`backend/scripts/reconcile-entitlements.js` is **read-only by default**. It lists
accounts with overlapping/unmapped entitling rows and what the canonical policy
grants each. It performs no Stripe calls and no writes. Destructive cleanup is
not implemented: `--apply` refuses unless `RECONCILE_OWNER_MODE=1` is set, and
even then it only prints the plan it *would* execute. Missing Supabase env =
exit 2 (BLOCKED), never a green "0 anomalies".
