# Runbook — Incidents & Monitoring (owner-operated)

Lightweight incident response for a paid service. Monitoring detects failures
**without accessing customer content**: no emails, campaign/asset text, evidence
URLs or payment details appear in any alert, log category or readiness report.

## Signals (secret-safe)

| Signal | Source | Healthy | Alert when |
|--------|--------|---------|------------|
| Core service up | `GET /health` | `status: ok` | non-200 / timeout |
| Config presence + migrations | `GET /api/admin/readiness` → `checks` | `ready: true` | any `blocker` not ok |
| Email outbox backlog | readiness → `live.outbox_backlog` | ~0 | `signals.outbox_backlog` = warn/stop |
| Webhook failures (24h) | readiness → `live.webhook_failures_24h` | 0 | `signals.webhook_failures_24h` = warn/stop |
| AI spend vs ceiling | readiness → `live.spend_over_ceiling` | `false` | `signals.ai_spend` = warn/stop |
| Reservation leakage | readiness → `live.reservation_leakage` | 0 | `signals.reservation_leakage` = warn/stop |
| Overall operational status | readiness → `operational_status` | `ok` | `warn` (look) / `stop` (intervene) |
| Bundle freshness | `npm run check:app-fresh` | fresh | stale bundle on `main` |

`operational_status` is `ok` / `warn` / `stop`, computed in
`backend/lib/readiness-thresholds.js`. `warn` means look now; `stop` means
intervene using the kill switch for the affected subsystem below.

## Emergency kill switches (fail-safe, reversible)

All are environment variables. Setting them degrades one subsystem without
taking editing or export offline; unsetting them restores normal operation.

| Switch | Effect | Set when |
|--------|--------|----------|
| `AI_GENERATION_PAUSED=1` | Refuse all AI generation (503 `GENERATION_PAUSED`); editing/export still work | `signals.ai_spend` = stop, or a spend/provider incident |
| `SIGNUP_PAUSED=1` | Refuse all new signups (403 `SIGNUP_PAUSED`) | an auth/abuse incident, or to freeze the cohort instantly |
| `BETA_INVITE_CAP=<n>` | Cap the cohort at n accounts; a missing/invalid value **fails closed** (refuses signups) | to size or hold the beta |
| `MAX_AI_CALLS_PER_DAY=<n>` | The hard daily generation BRAKE (distinct from the spend alarm) | to tighten the ceiling |

## Alert content policy

- Structured category + count + request ID only. **Never** raw provider error
  bodies, customer identifiers or content.
- User-facing errors show a request ID and a recovery action, not the underlying
  provider message.

## Response

1. Acknowledge; capture the request ID and the failing signal.
2. Triage category: billing / email / spend / core service / data-rights.
3. Contain (e.g. pause spend, hold sends) — owner-authorized only.
4. Recover using the matching journey in
   [RUNBOOK_TRANSACTION_REHEARSAL.md](./RUNBOOK_TRANSACTION_REHEARSAL.md).
5. Record: incident owner, timeline, root cause, rollback taken, follow-up.

## First response by subsystem

Each row: the switch to stop the bleed, the read-only data to inspect (no
customer content), and when to escalate.

| Subsystem | Stop the bleed | Inspect (read-only) | Escalate when |
|-----------|----------------|---------------------|----------------|
| Billing / webhooks | none needed (idempotent + ordering-guarded); never re-charge to "fix" a charge | `/api/admin/readiness` → `webhook_failures_24h`; `ops-signal reconciliation_correction` / `webhook_failed` log lines; `stripe_events` status | a paying user lacks access, or failures don't clear on Stripe retry |
| AI spend | `AI_GENERATION_PAUSED=1` | `signals.ai_spend`, `live.ai_spend_24h_usd` vs ceiling; `reservation_leakage` | spend passes the ceiling with generation still on, or leakage keeps climbing |
| Email | hold sends via the outbox; check suppression is honoured | `/api/admin/email-outbox`; `signals.outbox_backlog` | dead-letter backlog grows, or a suppressed address is mailed |
| Auth / abuse | `SIGNUP_PAUSED=1` | login rate-limit hits; `signals` overall; signup 403 codes (`BETA_FULL`, `SIGNUP_PAUSED`, `COHORT_*`) | credential-stuffing, or the cohort cap is bypassed |
| Export | none (export is read-only, no AI spend); re-run the export | `check:app-fresh`; export-integrity test in the release-candidate workflow | a paid deliverable renders corrupt or truncated |

## Entitlement verification unavailable (`PLAN_UNAVAILABLE`) — v13 SC-P0-01

When the plan lookup itself fails (Supabase unreachable/erroring), the system
answers **"we could not verify"**, never "you are on the free plan".

- **API:** `503` with `{ code: 'PLAN_UNAVAILABLE', retryable: true }` and the
  copy *"We couldn’t verify your plan right now. No access change was made.
  Please try again."* No raw provider text is returned.
- **Checkout fails closed:** `POST /api/payments/create-checkout-session`
  creates **no** Stripe Checkout Session and no Stripe customer in this state,
  so an outage can never produce a duplicate subscription. Same for an entitling
  subscription sitting on a price id that maps to no plan.
- **Reads are non-destructive:** `verify-plan` returns `active: null` (never
  `false`), and the app keeps the access it is already showing.
- **Retry behaviour:** the app retries `/api/auth/me` once automatically
  (~1.5 s) and then stops and shows an explicit "Try again" action — bounded, no
  indefinite spinner. Account → Plan & billing shows the same notice + retry.

**Inspect (read-only):** `plan_unavailable` log lines (path + `req_id`),
`PLAN_LOOKUP_FAILED` (redacted email + message) and `STRIPE_PRICE_UNMAPPED`
(redacted email, statuses, price ids) — the last one is a **configuration**
alert: a live price id is missing from the `STRIPE_PRICE_*` env vars. Fix the env
var; do not grant plans by hand.

**Escalate when:** `plan_unavailable` persists after Supabase recovers, or
`STRIPE_PRICE_UNMAPPED` fires for a real customer (they are being blocked from
checkout and read as unmapped until the env var is corrected).

**Support reply:** confirm no charge and no access change occurred, ask them to
retry, and quote the `req_id` from their error notice.

## Reconciliation — missed / out-of-order webhooks (v18 S05)

Two read-only reconcilers, both fail-closed and idempotent. Neither ever
re-charges or invents entitlement; on the shared Stripe account both use the
exact `webhooks.isOurSubscription` ownership rule, so a peer product's
subscription is never adopted.

| Tool | Detects | Talks to Stripe? |
|------|---------|------------------|
| `npm run reconcile:webhooks` | a Stripe subscription whose create/update webhook was never delivered → **missing_local** (no local row) or **status_drift** (stale local status) | yes (read-only `subscriptions.list`) |
| `node backend/scripts/reconcile-entitlements.js` | impossible/ambiguous states in rows we already mirror (overlap, unmapped price) | no |

**When to run:** after a `webhook_failures_24h` spike that does not clear on
Stripe retry, after a Stripe outage, or when a paying user reports missing
access but Stripe shows them active.

**Procedure:**
1. `npm run reconcile:webhooks -- --json` — dry-run, read-only. Exit `1` means
   findings exist; `2` means BLOCKED (missing `STRIPE_SECRET_KEY`/Supabase env —
   never read as "0 in sync").
2. Review the reason-coded findings (opaque subscription ids only, no email).
3. Repair only if warranted: `RECONCILE_OWNER_MODE=1 npm run reconcile:webhooks -- --apply`.
   The repair upserts the local mirror via the **one** canonical
   `subscriptionMirrorRow` projection (idempotent), emits an
   `ops-signal reconciliation_correction` per fix, and deliberately does **not**
   send lifecycle email — reconciliation is a data-sync, not an event replay.
4. Re-run the dry-run to confirm `missing_local` / `status_drift` are `0`.

**Escalate when:** findings persist after `--apply`, or a foreign subscription
count changes unexpectedly (possible metadata/ownership regression).

## External processors

Adopt an external log/alert processor **only after** its subprocessor and
privacy disclosures are updated. Until then, keep signals in-app and secret-safe.

## Support expectations

Honest support only — no SLA is published unless it is operationally staffed.
Billing/legal/support copy distinguishes automatic system state from
owner/manual evidence.
