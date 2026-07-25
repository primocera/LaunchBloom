# GO / NO-GO — Scalvya v10 Release Candidate

**Status legend (kept distinct, never conflated):** `TESTED LOCALLY` ·
`CONFIGURED` · `VERIFIED IN CI` · `REHEARSED LIVE` · `OBSERVED OVER TIME` ·
`OUTSTANDING (owner)`.

Opened by SC-V10-00; sealed by SC-V10-08. This document is the single place a
v10 release claim may be made — a claim absent from here has not been made.

## Frozen RC

- Reviewed baseline: `4b6d55d` (v9 merge to `main`) — confirmed as the `v10`
  branch point at creation; **no drift**.
- RC content commit: `__________` (filled by SC-V10-08).
- Migrations on disk at baseline: **35** (`001`…`035`). v10 adds none yet.
- Built bundle hash: `__________` (filled by SC-V10-08 via `npm run check:app-fresh`).

## Automated evidence — `TESTED LOCALLY` at SC-V10-00

| Check | Command | Result |
|-------|---------|--------|
| Tests | `npm test` | **362 pass / 0 fail** (355 at baseline, +7 from SC-00) |

Growth over baseline: `webhook-ordering.test.js` (+7) — delayed, duplicate and
out-of-order Stripe deliveries against a stateful `subscriptions` fake.

Lint, production build and stale-bundle checks run on every PR and every push to
`main` in the existing non-secret CI job (`.github/workflows/ci.yml`, unchanged
since v9). Those are `VERIFIED IN CI`.

## Production configuration — `OUTSTANDING (owner)`, deliberately not in CI

`node backend/scripts/release-check.js --evidence` is **not** wired into CI, by
an explicit project decision: this repo runs on free tiers and a secret-bearing
job that can go red would both consume paid minutes and mail the owner on every
failure. The gate is therefore **owner-run against the production environment**,
with its output recorded in
[RUNBOOK_TRANSACTION_REHEARSAL.md](./RUNBOOK_TRANSACTION_REHEARSAL.md).

Consequence for wording, and it is not optional: no v10 document may describe
production configuration as `VERIFIED IN CI`. The strongest honest claim is
`CONFIGURED`, upgraded to `REHEARSED LIVE` only once the owner pastes a dated
release-check result. Fail-closed behaviour is unchanged — in a shell without
production secrets the check reports `launch:config` as a blocker by design.

## Money-path correctness — SC-V10-00

**Fixed:** `invoice.payment_failed` was the only Stripe handler with no
out-of-order guard, and it never wrote `stripe_event_at`
(`backend/routes/webhooks.js`). A late `payment_failed` delivered after the
recovery `invoice.paid` would flip a recovered subscription back to `past_due`,
revoking entitlement the customer had already paid for. It is now guarded by
`isStaleSubscriptionEvent` and stamps its event time like every other handler.

Severity: **P0-class** (wrong entitlement on a paying customer), reachable in
normal operation — Stripe guarantees neither ordering nor exactly-once delivery.
`TESTED LOCALLY`; live confirmation is journey 13 of the rehearsal runbook.

Unchanged and re-confirmed: the `stripe_events` ledger claims each event before
processing, acks duplicates without reprocessing, and returns 5xx on transient
DB failure so Stripe retries.

## Readiness endpoint

`/api/admin/readiness` (v9 SC-10) already meets the v10 bar: presence booleans
and bounded 24h counts only — no secret values, customer content, emails or
payment data. Re-verified by reading the route; locked by
`production-hardening.test.js`. **No change required in v10.**

## Risk register

**P0 (block release):** none open. The out-of-order entitlement bug above is
fixed and tested.

**P1 (before cohort expansion):**
- Live transaction rehearsal evidence, journeys 1–13 — *owner*, gated by runbook.
- Owner-run `release-check` against production config, dated — *owner*.

**P2 (carried from v9, filed not built):** per-channel prompt/schema version
bumps + golden fixtures; ZIP/DOCX export; lifecycle-email rewrite; shared
component library migration; admin cohort dashboard UI.

## Rollback

- v10 commits are independent and additive; revert the offending commit.
- SC-V10-00 changes no schema and adds no migration — nothing to unwind in data.
- The `payment_failed` guard is fail-safe in the conservative direction: if it
  misfires it *preserves* entitlement rather than revoking it.

## Verdict

- **NO-GO** for paid launch — SC-V10-01…08 are not started, and the P1 owner
  evidence is unrecorded.
- SC-V10-00 itself: **complete on automated evidence**, no P0 open.

Signed: Claude Code (automated gate) · Owner sign-off: `__________`  Date: `__________`
