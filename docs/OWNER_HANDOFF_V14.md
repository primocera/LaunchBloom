> **SUPERSEDED (v15).** This v14 handoff is pinned to the prior candidate
> `81993ff`. The current canonical handoff is **`docs/OWNER_HANDOFF_V15.md`**
> (candidate `b234dad`), and the single source of truth is
> `docs/launch/launch-state.json` / `docs/LAUNCH_STATE.md`. Kept only as history.

# Owner handoff — v14 launch hardening (SC-07 + LAUNCH-01)

> Prepared by Claude Code on branch `v14`. This document contains **no live
> action**. Every deploy, migration, Stripe/Supabase mutation and live-money
> step below is **owner-only** and must be run by you with real credentials.
> Nothing here may be read as production/authenticated/live evidence — those
> statuses are only true after *you* run them against the real environment.

## 1. Frozen candidate

| Field | Value |
|---|---|
| Candidate SHA (v14, frozen) | `81993ffb4bbcd358e0e2a3ede9e85540581c4352` (`81993ff`) |
| Branch | `v14` |
| Rollback SHA (pre-v14 `main`) | `fb67e9b0bdec1c615d72f865de5fe94dd8d9fa3e` (`fb67e9b`) |
| Prior candidate (v13) | `552318709c04f37f0a455acdd4c734fd5cd31abc` (`5523187`) |
| Frontend bundle | `index-B75XUgt7.js` / `index-Ck_SQ1wq.css` — **byte-identical to the v13 candidate** |

**What changed in v14 (all four commits):**

- `a27b5de` SC-02/03 — billing fails closed on trial/customer uncertainty; billing errors redacted (no `err.message`, no full-email logs).
- `00569f2` SC-04 — launch-evidence validator now rejects stale prose SHAs / bundle hashes; new `observed_production` status; manifest prose cleaned.
- `dd3dff0` SC-06 — canonical Scalvya product docs + content contract (retired brand names + AI "send-ready" promises blocked).
- `81993ff` SC-05 — router-advisory reachability proof + `npm run audit` script.

The **only** shipped-frontend impact is comment-only edits in `app-src`; the built bundle hash is unchanged, so v13's public browser evidence still describes the exact bytes being served.

## 2. Local gate — run at the frozen SHA (all green)

Fresh `npm ci`, then:

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASSED LOCALLY (exit 0) |
| Unit/contract/safety | `npm test` | PASSED LOCALLY — 786/786 |
| Build | `npm run build:app` | PASSED LOCALLY — bundle `index-B75XUgt7` |
| Stale-bundle | `npm run check:app-fresh` | PASSED LOCALLY — app/ matches app-src/ |
| Export integrity | `npm run test:export` | PASSED LOCALLY — 15/15 |
| Launch integrity | `npm run launch:verify` | OK |
| Prod dep audit | `npm run audit` | 2 high (react-router RSC-mode CSRF, **not reachable** — see §5) |

## 3. Checks that are BLOCKED for me (owner/CI must run)

- **Public Playwright** (`npm run test:e2e`): NOT RUN — the browser binary is not installed in this environment and I did not download binaries. Because the frontend bundle is byte-identical to the v13 candidate (which recorded 52/0), you may either re-run it once (`npx playwright install chromium && npm run test:e2e`) or record a bundle-unchanged carry-forward.
- **Authenticated matrix** (`npm run test:e2e:auth`): BLOCKED — needs a disposable non-production Supabase project with the `E2E_MARKER.sql` opt-in (see `docs/RUNBOOK_AUTH_E2E.md`). The runner refuses production/unrecognized targets and exits non-zero rather than skipping.
- **Production readiness / config gate** (`GET /api/admin/readiness`): owner-only — needs production secrets.
- **Eight-transition live-money rehearsal** (the ordered recovery sequence, steps A–H): owner-only — see `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`.

## 4. Candidate is pinned to `81993ff` (done)

The manifest (`docs/launch/launch-state.json`) is pinned to the v14 candidate
`81993ff`. The v13 candidate `5523187` is recorded only as prior history
(`historical_shas`). At the pinned candidate:

- `npm run launch:verify` → OK (one active launch truth; verdict recomputed).
- `npm run launch:gate` → **capped_beta: GO**, **public_paid: CONDITIONAL GO** (computed, not declared).
- `npm run launch:drift` → none (HEAD matches candidate except documentation).
- Required checks are pinned to `81993ff` with `786` unit tests; the frontend
  bundle is `index-B75XUgt7` (byte-identical carry-forward from `5523187`).

There is nothing left to re-pin for the v14 candidate. Owner-only deployment and
rollback instructions are preserved in **LAUNCH-01** below. Any future code change
creates a *new* candidate and returns the gate to NO-GO until it is re-cut and
re-evidenced (`how_to_create_a_new_candidate` in the manifest).

## 5. Verdict (computed, not declared)

- **Capped beta:** **GO** (candidate re-pinned to `81993ff` on 2026-08-04; `launch:gate` computes GO, `launch:drift` none). Owner confirmed production readiness `ready=true`/0 blockers, and the browser/migrations/config-gate evidence is a valid carry-forward (byte-identical `git diff 5523187..81993ff` over `app/`, `backend/migrations/`, `launch-config.js`, `release-check.js`). Remaining before opening the cohort: deploy `81993ff` to production (LAUNCH-01 below) and, recommended, one manual fail-closed billing sanity check.
- **Public paid:** **CONDITIONAL GO** (computed 2026-08-04). No unaccepted blocker remains, but the public-paid launch proceeds *over* three required conditions that are only bypassed by named, visible accepted risks — never satisfied: the router advisory `P1-router-rsc-csrf-advisory` (**accepted** 2026-08-04, not reachable — no RSC — revisit at the router-8 migration), the skipped authenticated matrix (`authenticated-e2e`), and the un-run **eight-transition** live-money rehearsal (`live-money`). Each keeps its real status. Strongly recommended before opening *unrestricted* public signup: run the authenticated matrix and complete the rehearsal to convert those two from accepted risk to satisfied. Public paid is a separate explicit owner decision from the capped beta.

**Router advisory (GHSA-qwww-vcr4-c8h2):** not reachable — proof recorded in the blocker `reachability_evidence`: every `app-src` router import is `react-router-dom`, a single declarative `<BrowserRouter>`, zero RSC/SSR indicators, pure client SPA. No safe forward patch on 7.x (fix is a breaking 7.11.0 downgrade or a react-router-8/React-19/Vite-7 migration). **Accepted for the public-paid track on 2026-08-04** (Primoz Cerar, owner) with revisit at the router-8 / React-19 / Vite-7 migration or sooner if a 7.x backport ships; it stays visible and named, never closed.

---

# LAUNCH-01 — capped-beta deployment control (owner-supervised)

> This is launch-control **preparation**, not authorization for autonomous
> deployment. Present the plan, get explicit approval, then run only the
> approved target/SHA yourself.

## Pre-deploy verification (read-only; stop on any mismatch)

1. Print exact app, candidate SHA (`81993ff`), rollback SHA (`fb67e9b`), environment and tier (capped beta, invite-only).
2. Migrations applied — read-only schema check: `backend/migrations/CHECK_APPLIED.sql` reports `applied = true` across `001–037` (39 files on disk; two unnumbered files — `CHECK_APPLIED.sql`, `E2E_MARKER.sql` — are deliberately **not** part of the applied set and `E2E_MARKER.sql` must never touch production).
3. Production env presence/mode without printing values: `GET /api/admin/readiness` → `mode=production`, `ready=true`, `blockers=0`.
4. Stripe account/mode/product/price/currency contract, read-only: `npm run verify-prices` with the **live** key (all six USD (+EUR) pairs correct, products active, live mode).
5. Confirm: email sender + webhook endpoint, cron auth secret, AI spend ceiling (`AI_SPEND_DAILY_CEILING_USD`), `BETA_INVITE_CAP` (fails closed on missing/invalid), and a support route.

## Deployment authorization boundary

- Present the exact planned deploy + migrations.
- **Ask for explicit owner approval** before any deploy, migration, live Stripe mutation or live-money transaction.
- After approval, deploy only the approved target and SHA (`81993ff`).

## Post-deploy smoke test (Scalvya)

signup/login → free Brand Profile + Brief → first generation trial boundary → one asset → review → export → billing status → cancel/portal → **second-trial prevention** → **safe temporary-error copy** (force a transient billing read failure and confirm the 503 "not charged, drafts safe" path, no Free, no second trial).

## Monitoring — first 72 hours

5xx + checkout-failure rate · webhook failures/retries + event-order anomalies · duplicate customer/subscription indicators · unresolved AI usage reservations vs spend ceiling · email permanent failures/backlog · cross-account/RLS errors · time-to-first-value + value-loop completion · refund/support complaints about price, trial or charge date.

## Stop conditions (halt / roll back to `fb67e9b`)

any displayed/charged price or currency mismatch · duplicate subscription or trial · cross-account data exposure · unsafe AI output escaping a guard · migration/schema mismatch · webhook backlog that changes entitlement truth · unexplained material 5xx spike · readiness endpoint not `ready`.

## Rollback

- **Code:** v14 commits are independent and additive; revert the offending commit and rebuild `app/`, or reset the deploy to `fb67e9b`.
- **Data:** no migration introduced by v14 (`git diff 5523187..81993ff -- backend/migrations/` is empty) — nothing to roll back at the data layer.
- **Flags (reversible env vars):** `AI_GENERATION_PAUSED=1` stops generation; `SIGNUP_PAUSED=1` stops new signups; `BETA_INVITE_CAP` caps the cohort and fails closed.

## Beta scope

Invite-only and capped (`BETA_INVITE_CAP`); every participant contactable; manual support + refund kept available; do **not** uncap on vanity signup counts. Value evidence required before any uncap (activation → first reviewed asset, export/handoff rate, second campaign started, repeat weekly use). Public paid is a **separate explicit owner decision**.

## Final output

Keep a 72-hour launch log (timestamps, candidate SHA `81993ff`, observations, incidents, rollback decisions) ending in one of: CONTINUE CAPPED BETA · PAUSE/ROLL BACK · READY TO PLAN PUBLIC PAID.
