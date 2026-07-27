# Owner evidence worksheet — v11

Three things cannot be proven from this repository, from a test, or by Claude
Code: whether real money moves correctly, whether real email obeys suppression,
and whether a spend cap is actually configured in production. Each needs a
human with credentials.

**Claude Code must never perform any step in this file.** No live charge, no
refund, no provider-side email action, no production setting change.

Fill in each `__________`. When a section is complete, update the matching
entry in `docs/launch/launch-state.json` and re-run `npm run launch:gate`.

Record **anonymized** evidence only: no full card numbers, no customer email
addresses, no full Stripe customer ids (last 4 characters are enough), no
message bodies. Screenshots must be cropped to the state being proven.

---

## A · Live money rehearsal

Detailed steps are in `docs/RUNBOOK_TRANSACTION_REHEARSAL.md` (journeys 1–13).
This sheet records the **outcome** of each transition. Use the lowest-priced
plan and refund yourself at the end.

**Candidate SHA under test:** `__________`  ·  **Environment:** production
**Run started (UTC):** `__________`  ·  **Operator:** `__________`

| # | Transition | Expected app state | Expected Stripe state | Expected email | Observed | Evidence ref |
|---|---|---|---|---|---|---|
| 1 | Checkout → trial starts | plan `trial`, charge date shown | `trialing`, trial_end set | trial-started | `______` | `______` |
| 2 | Trial → first charge | plan matches purchased tier | `active`, invoice paid | receipt | `______` | `______` |
| 3 | Cancel at period end | access retained, end date shown | `cancel_at_period_end: true` | cancellation confirm | `______` | `______` |
| 4 | Reactivate before period end | access retained, no new charge | `cancel_at_period_end: false` | none expected | `______` | `______` |
| 5 | Payment fails | state `past_due`, honest copy | `past_due` | dunning | `______` | `______` |
| 6 | Recovery after failure | entitlement restored | `active` | recovery/receipt | `______` | `______` |
| 7 | Late `payment_failed` **after** recovery | entitlement **retained** | unchanged | none | `______` | `______` |
| 8 | Refund | access per policy | `refunded` | refund confirm | `______` | `______` |
| 9 | Full cancel | read-only history retained | `canceled` | end-of-access | `______` | `______` |

Row 7 is the one that matters most: it is the live confirmation of the v10
SC-00 out-of-order webhook fix. Stripe guarantees neither ordering nor
exactly-once delivery, so this is reachable in normal operation, not a
hypothetical.

**Stop condition:** if any row shows entitlement granted without payment, or
revoked after a successful payment, **stop the rehearsal**, refund, and open a
P0. Do not continue to the next row.

**Cleanup performed (refund issued, test subscription removed):** `__________`

---

## B · Resend suppression after migration `036`

Prove that an unsubscribe suppresses **optional** mail while **billing and
security** mail still arrives. Both halves are required: suppressing everything
is a compliance failure in the other direction.

**Precondition — `036_email_suppressions.sql` is applied:** `__________`
(if it is not applied, unsubscribe writes fail and marketing mail fails closed —
safe, but not the intended behaviour, and this test would pass for the wrong
reason)

| # | Action | Expected | Observed | Evidence ref |
|---|---|---|---|---|
| 1 | Send a product/marketing message to a test address | delivered; carries List-Unsubscribe + One-Click headers | `______` | `______` |
| 2 | Use the one-click unsubscribe (POST, no login) | 2xx; suppression row written | `______` | `______` |
| 3 | Trigger the same marketing message again | **not delivered**; suppressed | `______` | `______` |
| 4 | Trigger a billing/receipt message | **delivered** | `______` | `______` |
| 5 | Trigger a security/verification message | **delivered** | `______` | `______` |
| 6 | Check the Resend dashboard for the suppressed send | recorded as suppressed, not bounced/failed | `______` | `______` |

**Provider-level evidence to capture:** the Resend delivery log line for rows 3
and 4, with the recipient address redacted to its domain.

---

## C · Daily AI spend ceiling

`AI_SPEND_DAILY_CEILING_USD` is now **required** by the production release
check (`npm run release:check`). An absent, zero, negative, non-numeric or
absurd value fails closed — see `backend/tests/spend-ceiling-gate.test.js`.

| Item | Value / result | Evidence ref |
|---|---|---|
| Ceiling set in the production environment (USD/day) | `__________` | `__________` |
| `npm run release:check` shows `[PASS] ai:spend_ceiling` in production | `__________` | `__________` |
| `/api/admin/readiness` reports `ai_spend_ceiling_usd` non-null | `__________` | `__________` |
| Observed 24h spend at the time of check | `__________` | `__________` |

Choose the number deliberately: it should comfortably exceed a normal day for
the capped beta cohort and still be a figure you would be willing to lose in a
single bad day.

---

## D · Alert thresholds and the kill procedure

Agree these before the beta opens, not during an incident.

| Signal | Where it is visible | Threshold | Who acts | First action |
|---|---|---|---|---|
| AI spend (24h) | `/api/admin/readiness` → `ai_spend_24h_usd` | `______` | `______` | set `AI_GENERATION_PAUSED=1` |
| Spend over ceiling | `spend_over_ceiling: true` | any | `______` | pause generation, then investigate |
| Email outbox backlog | `outbox_backlog` | `______` | `______` | check the cron worker |
| Webhook failures (24h) | `webhook_failures_24h` | `______` | `______` | replay from the Stripe dashboard |
| Entitlement mismatch | support report | any | `______` | reconcile from Stripe as canonical |

**Kill switch:** `AI_GENERATION_PAUSED=1` stops new reservations with
`GENERATION_PAUSED` (see `backend/tests/spend-guard.test.js`). It does not
cancel in-flight work and does not touch billing.

**Recovery:** unset the variable, confirm `/api/admin/readiness` is clean, then
re-check the spend ledger for the affected window before re-opening generation.

---

## Sign-off

| Section | Complete | Date | Owner |
|---|---|---|---|
| A · live money | `______` | `______` | `______` |
| B · suppression | `______` | `______` | `______` |
| C · spend ceiling | `______` | `______` | `______` |
| D · alerts and kill switch | `______` | `______` | `______` |

Until every section is complete, `public_paid` stays **NO-GO**. That is the
gate working, not a formality.
