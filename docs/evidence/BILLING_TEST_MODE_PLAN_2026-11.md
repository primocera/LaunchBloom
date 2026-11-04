# Billing test-mode plan (2026-11) — the separate plan step 7 requires

`OWNER_CHECKLIST_v24.md` step 7: the billing-runtime diff from `176a7c6` is
**non-empty**, so the 2026-09-05 live-money A–H evidence does not carry forward
by itself and a separate billing plan is required. This is that plan. It runs in
**Stripe test mode only — no live money**.

## What changed in billing-runtime files since `176a7c6`

| Change | Files | Since | Touches subscription state? |
|---|---|---|---|
| Em/en dashes replaced in comments and strings | 13 billing files | before 2026-11 (already in prod `50b703e`) | no |
| Metering settles before the response is sent | `backend/lib/plan-limits.js` | before 2026-11 (in prod) | no (usage ledger only) |
| `/api/legal` exposes registration number + VAT ID | `backend/routes/plans.js` | `6111cf9` | no |
| Invoice webhooks resolve the dahlia subscription reference and **send email only** (receipt, payment failed, recovered); status still comes only from `customer.subscription.*` | `backend/routes/webhooks.js` | `a0f8fda` | **no** — the status writes were removed, not added |
| Yearly plans meter the monthly allowance per monthly cycle; `usage.resets_at` | `backend/lib/usage.js`, `backend/lib/plan-limits.js` | `a0f8fda` | no (usage window only) |
| Account delete/export include `generation_jobs`; receipt text; a failed workspace delete is reported instead of an "ok" receipt | `backend/routes/account.js` | `6111cf9`, `a0f8fda`, review-fixes commit | no (Stripe cancellation step unchanged) |

Checkout (`payments.js`), the billing portal, customer ownership, entitlement
(`subscription-state.js`) and migrations are unchanged.

## Preconditions — stop if any is false

1. `backend/.env` uses a **test** Stripe key (`sk_test_…`) and points at the
   **non-production** Supabase project (the e2e project from
   `docs/RUNBOOK_AUTH_E2E.md`). Never run this against the production database.
2. `NODE_ENV=development`. `ANTHROPIC_API_KEY` empty, so generation uses the
   built-in mock (no AI cost). `RESEND_API_KEY` empty: emails are recorded in
   `email_events` with status `skipped` instead of being sent — that row is the
   evidence.
3. `npm run dev` (API on :3002) and `npm run dev:app` running.
4. `stripe listen --forward-to localhost:3002/api/webhooks/stripe`; put the
   printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart the API.

Evidence query used below (run in the non-production project's SQL editor):
```sql
select email_type, status, category, created_at from email_events order by created_at desc limit 10;
select stripe_subscription_id, status, current_period_start, current_period_end
  from subscriptions order by stripe_event_at desc limit 5;
```

## Checks

**T1 — failed renewal: payment-failed email, status from subscription.updated**
1. Sign up locally, verify, open a studio, start the trial with card
   `4000 0000 0000 0341` (attaches, every charge fails), monthly Starter.
2. `stripe subscriptions update <sub_id> --trial-end=now`
3. Expect in the `stripe listen` log: `invoice.payment_failed` → 200 and
   `customer.subscription.updated` → 200.
4. Expect: `email_events` has a `payment_failed` row (category `transactional`);
   `subscriptions.status` = `past_due`. Generation shows the paywall.

**T2 — recovery: recovered email, status back to active**
1. Account & billing → Manage billing → add card `4242 4242 4242 4242` as default.
2. `stripe invoices pay <in_id>` (the failed invoice from T1).
3. Expect: `invoice.paid` → 200, `customer.subscription.updated` → 200;
   `email_events` has `payment_recovered`; `subscriptions.status` = `active`;
   generation works again.

**T3 — trial invoice does not change status**
1. New account, start a trial with `4242…`.
2. Expect: the $0 `invoice.paid` → 200, `subscriptions.status` stays `trialing`,
   no `payment_succeeded` email row (only `trial_started`).

**T4 — yearly plan meters monthly**
1. New account, yearly Pro with `4242…`; `stripe subscriptions update <sub_id> --trial-end=now`.
2. Generate one asset.
3. Expect: `GET /api/account/billing` → `usage.ai_actions` = 1 and
   `usage.resets_at` ≈ one month after `current_period_start` (not one year);
   the Account page shows "resets <that date>". One `usage_events` row with
   status `succeeded` (counted once).

**T5 — account deletion**
1. With the T4 account: Account → Data → Delete account.
2. Expect the receipt: `stripe_cancellation` ok (subscription canceled in the
   Stripe test dashboard), `workspace_data` ok, `generation_results` ok,
   `auth_user` ok. `customer.subscription.deleted` → 200.

**Stop condition:** any webhook answering non-2xx, any status other than the
expected one, or a missing email row. Stop, record it, do not ship.

## Record

| # | observed_at_utc | operator | result (passed/failed) | evidence (event ids / row ids, redacted) | expected → observed |
|---|---|---|---|---|---|
| T1 | — | — | NOT RUN | — | — |
| T2 | — | — | NOT RUN | — | — |
| T3 | — | — | NOT RUN | — | — |
| T4 | — | — | NOT RUN | — | — |
| T5 | — | — | NOT RUN | — | — |

When all five pass on the frozen FINAL SHA, step 7 is satisfied for this
release: the live A–H evidence stays valid for everything the diff does not
touch, and this record covers what it does.
