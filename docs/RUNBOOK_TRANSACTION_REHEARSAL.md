# Runbook — Paid Transaction Rehearsal (owner-operated)

**Purpose:** prove, on a frozen commit, that every real money path works before
expanding acquisition. Automated release checks (`npm run check`,
`npm run release:evidence`, `GET /api/admin/readiness`) are necessary but **not a
GO**. This rehearsal is the GO.

> ⚠️ Claude Code must not run any step that mutates live Stripe, Supabase,
> Vercel, Resend, DNS or cron. Every step below is **owner-operated** with
> explicit authorization. Refunds and destructive actions are never automated.

## Freeze

- Frozen commit SHA: `__________`
- `/api/admin/readiness` `ready: true`, `blockers: 0`: `__________`

### Production config gate — owner-run (v10 SC-00)

This project deliberately keeps **no secret-bearing CI job**, so the production
configuration gate is run by the owner against the production environment and
its output pasted here. CI proves the *code*; this proves the *configuration*.

```bash
# In a shell carrying the PRODUCTION env (never commit the output verbatim —
# it is presence-only by design, but treat it as operational data).
node backend/scripts/release-check.js --evidence
```

- Result (`ready` / blocker list): `__________`
- Run at (UTC): `__________`  ·  Against commit: `__________`
- Status word for this run — pick exactly one: `configured` · `rehearsed live` ·
  `observed over time`. **Never** `verified in CI`: no CI job runs this.

## Journeys to rehearse (record anonymized IDs only — never card data)

Record the UTC timestamp of the *observed system state*, not of the Stripe
action — an out-of-order delivery is only proven by the gap between them.

| # | Journey | Expected system state | Evidence (event/entitlement/receipt ID) | Observed at (UTC) | Owner | Result |
|---|---------|----------------------|------------------------------------------|-------------------|-------|--------|
| 1 | Eligible 3-day trial starts | `trialing`, entitlement = trial limits | | | | ☐ |
| 2 | Prior-trial user pays today | charged today, no second trial | | | | ☐ |
| 3 | Incomplete checkout abandoned | no entitlement granted | | | | ☐ |
| 4 | Delayed webhook (out of order) | reconciles to correct plan | | | | ☐ |
| 5 | Active subscription | plan entitlement active | | | | ☐ |
| 6 | Cancel at period end | access until period end, then downgrade | | | | ☐ |
| 7 | Canceled | reverts to free/limited, no charge | | | | ☐ |
| 8 | Payment failed | dunning state, entitlement held per policy | | | | ☐ |
| 9 | Recovery / reactivate | entitlement restored, no double charge | | | | ☐ |
| 10 | Plan change (up/down) | proration + new limits correct | | | | ☐ |
| 11 | Refund / support (manual) | owner-authorized, receipt recorded | | | | ☐ |
| 12 | Duplicate webhook event | idempotent, no double entitlement/charge | | | | ☐ |
| 13 | Late `payment_failed` after recovery | stays `active` — entitlement **not** revoked | | | | ☐ |

Journey 13 is the v10 SC-00 regression: replay a `invoice.payment_failed` whose
`created` predates the recovery `invoice.paid` (Stripe CLI
`stripe events resend <evt_id>`). Covered locally by
`backend/tests/webhook-ordering.test.js`; this row is the live confirmation.

## SC-V12-04 · Ordered recovery sequence (run as one continuous rehearsal)

Run these transitions **in order on a single subscription**, using a real
low-value Scalvya plan, only after the owner deliberately starts the run. Record
the observed app entitlement (`/api/admin/readiness` and a signed-in check of
`planFor`) and the lifecycle email for each. **$ = costs real money; C = requires
explicit owner confirmation before proceeding.** Never put secrets, full customer
identifiers or card data in evidence.

| Step | Action | Cost/Confirm | Expected Stripe state | Expected app entitlement | Expected email | Evidence |
|---|---|---|---|---|---|---|
| A | Start eligible trial | C | `trialing` | `trial` limits | `trial_started` | |
| B | Trial converts to paid | $ | `active` | mapped plan | `payment_succeeded` | |
| C | Cancel at period end | C | `active`, `cancel_at_period_end=true` | plan held to period end | `cancellation_scheduled` | |
| D | Reactivate (undo cancel) | C | `active`, `cancel_at_period_end=false` | plan continues | (none required) | |
| E | Force a failed payment | $ | `past_due` | **entitlement withheld** | `payment_failed` | |
| F | Recover (pay open invoice) | $ | `active` | plan restored | `payment_recovered` | |
| G | Replay a LATE `payment_failed` (created before F) | C | **stays `active`** | **entitlement NOT revoked** | (none) | |
| H | Refund the last charge | $, C | `active` unless you also cancel | unchanged by the refund alone | (none) | |

**Abort conditions — stop the run and follow Rollback below if:**
- entitlement is granted while `past_due` (step E), or withheld while `active`;
- step G flips the subscription back to `past_due` (the regression);
- any step sends a duplicate email or double-charges;
- `/api/admin/readiness` shows `webhook_failures_24h > 0` attributable to the run.

**What proves G:** the operator log shows a
`ops-signal {"signal":"reconciliation_correction",…"reason":"stale_out_of_order_skipped"}`
line for the late event and the row stays `active`. Covered locally by
`backend/tests/webhook-ordering.test.js` and `webhook-lifecycle.test.js`; this
sequence is the live confirmation. Refunds and disputes are acknowledged but
change no entitlement on their own (`backend/tests/webhook-lifecycle.test.js`).

## Rollback (per journey)

If any journey above lands in a wrong state, the customer comes first and the
code second:

1. **Restore the customer** — set the correct entitlement manually in Stripe,
   confirm it in `/api/admin/readiness`, and tell the customer what happened and
   what was preserved. Never leave a paid customer without access while
   debugging.
2. **Stop the bleed** — if the wrong state is reachable by others, revert the
   offending commit (v10 commits are independent and additive) and redeploy.
3. **Requeue, don't re-charge** — replay the missed events with
   `stripe events resend`; the `stripe_events` ledger makes replay safe. Never
   create a second charge to "fix" a first one.
4. **Record it** — event IDs, timestamps and the corrective action go in the
   incident log (`RUNBOOK_INCIDENTS.md`); no customer content, no card data.

## Data-rights drills

- Account export across every v8/v9 table produced: `__________` (owner)
- Account delete produced a deletion receipt; re-export returns empty: `__________`
- Cancellation + deletion **failure** cannot report false success — verified: ☐

## Sign-off

- Owner: `__________`  Date: `__________`
- Verdict: ☐ GO for cohort expansion ☐ NO-GO (blockers below)
- Open blockers (owner, deadline, acceptance evidence, rollback): `__________`
