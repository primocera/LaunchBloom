# GO / NO-GO — Scalvya v9 Release Candidate

**Status legend (kept distinct, never conflated):** `PASSED LOCALLY` · `CONFIGURED`
· `VERIFY IN CI` · `OBSERVED LIVE` · `OUTSTANDING (owner)`.

This gate freezes and documents v9. It adds **no new scope** — remaining work is
filed as severity-tagged follow-ups below.

## Frozen RC

- RC content commit: `20673ae` (SC-V9-11), sealed by this SC-V9-12 gate commit on branch `v9`.
- Reviewed baseline: `3339517` — confirmed as the branch point; no drift.
- v9 range: `e109af1..HEAD` (SC-00 → SC-12).
- Rules pinned: consistency `v8.1`, dependencies `v8.1`. Handoff packet `handoff-1`. Next-action `cna-1`.
- Built bundle hash: `9a0fd6018ba2ce2a` · migrations on disk: **35** (adds 034 finding audit, 035 handoff packet).

## Automated evidence — `PASSED LOCALLY` at the frozen commit

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | 0 errors (pre-existing warnings only) |
| Tests | `node --test "backend/tests/*.test.js"` | **355 pass / 0 fail** |
| Build | `npm run build:app` | success |
| Bundle freshness | `npm run check:app-fresh` | `app/` matches `app-src/` (normalized hash vs HEAD) |
| Full gate | `npm run check` | green end-to-end |

Test growth over v9: 306 → 355 (+49), incl. new pure suites: campaign-next-action,
version-diff, handoff-packet, review-workbench, a11y-contract, production-hardening,
and the analytics drop-guard.

## Config / release-check — `VERIFY IN CI`

`node backend/scripts/release-check.js --evidence` at this commit reports one
**blocker: `launch:config`** and externals `cron:secret`, `email:delivery`.

This is **fail-closed behaviour working as designed**: this shell runs in `test`
mode with no production secrets (BRAND_LEGAL_*, Supabase, Stripe, SESSION_SECRET,
Resend, CRON_SECRET absent). In CI/production with those set, the gate passes.
→ **Owner/CI action:** confirm `release-check` is green on the production
environment and required as a `main` status. Release-check never prints secret
values (presence booleans only) — verified by `production-hardening.test.js`.

## Live money/ops evidence — `OUTSTANDING (owner)`

Not runnable by the agent (no live provider mutation permitted). Gated on the
owner-operated rehearsal in
[RUNBOOK_TRANSACTION_REHEARSAL.md](./RUNBOOK_TRANSACTION_REHEARSAL.md): eligible/
prior trial, incomplete checkout, delayed/duplicate webhook, active, cancel,
payment failed, recovery, plan change, refund, plus export/delete drills and the
`/api/admin/readiness` live signals. **Required before cohort expansion.**

## Risk register

**P0 (block release): none.** Legal identity is fail-closed (SC-00); no customer
surface renders a placeholder or unknown price/plan; the `legal entity TBD` leak
is removed and locked by test. Analytics carry no content/PII (drop-guard +
privacy tests). Optimistic concurrency protects brief and asset edits.

**P1 (before cohort expansion):**
- Live transaction rehearsal evidence — *owner*, gated by runbook.
- Confirm `release-check` green + required on `main` in CI — *owner*.

**P2 (documented follow-ups, filed not built — no scope added here):**
- SC-05: per-channel prompt/schema version bumps + golden eval fixtures.
- SC-07: ZIP / real DOCX export (conditional on safe streaming/memory).
- SC-08: full lifecycle-email rewrite (overlaps SC-10 billing/support).
- SC-09: full shared-component-library migration across all routes.
- SC-11: admin cohort dashboard UI + live experiment wiring.

## Rollback triggers

- Any P0 regression, billing/legal/data-safety failure, or analytics content leak → revert the offending commit; v9 commits are independent and additive.
- Migrations 034/035 are additive columns only (no backfill, no destructive change) — safe to leave in place on rollback of app code.
- Stale bundle on `main` → `npm run check:app-fresh` fails the gate; rebuild.

## Verdict

- **GO** for merging the v9 RC to `main` on automated evidence: full gate green at the frozen commit, no P0.
- **NO-GO** for cohort/acquisition expansion until the owner records live
  charge/cancel/recovery/refund evidence (P1) and CI `release-check` is green on
  production config.

Signed: Claude Code (automated gate) · Owner sign-off: `__________`  Date: `__________`
