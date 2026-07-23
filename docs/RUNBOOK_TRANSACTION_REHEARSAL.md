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
- `npm run release:evidence` attached (JSON, presence-only): `__________`
- `/api/admin/readiness` `ready: true`, `blockers: 0`: `__________`

## Journeys to rehearse (record anonymized IDs only — never card data)

| # | Journey | Expected system state | Evidence (event/entitlement/receipt ID) | Owner | Result |
|---|---------|----------------------|------------------------------------------|-------|--------|
| 1 | Eligible 3-day trial starts | `trialing`, entitlement = trial limits | | | ☐ |
| 2 | Prior-trial user pays today | charged today, no second trial | | | ☐ |
| 3 | Incomplete checkout abandoned | no entitlement granted | | | ☐ |
| 4 | Delayed webhook (out of order) | reconciles to correct plan | | | ☐ |
| 5 | Active subscription | plan entitlement active | | | ☐ |
| 6 | Cancel at period end | access until period end, then downgrade | | | ☐ |
| 7 | Canceled | reverts to free/limited, no charge | | | ☐ |
| 8 | Payment failed | dunning state, entitlement held per policy | | | ☐ |
| 9 | Recovery / reactivate | entitlement restored, no double charge | | | ☐ |
| 10 | Plan change (up/down) | proration + new limits correct | | | ☐ |
| 11 | Refund / support (manual) | owner-authorized, receipt recorded | | | ☐ |
| 12 | Duplicate webhook event | idempotent, no double entitlement/charge | | | ☐ |

## Data-rights drills

- Account export across every v8/v9 table produced: `__________` (owner)
- Account delete produced a deletion receipt; re-export returns empty: `__________`
- Cancellation + deletion **failure** cannot report false success — verified: ☐

## Sign-off

- Owner: `__________`  Date: `__________`
- Verdict: ☐ GO for cohort expansion ☐ NO-GO (blockers below)
- Open blockers (owner, deadline, acceptance evidence, rollback): `__________`
