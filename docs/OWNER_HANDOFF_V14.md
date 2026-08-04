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
- **Nine-transition live-money rehearsal**: owner-only — see `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`.

## 4. To formally re-pin the v14 candidate (owner step)

The manifest (`docs/launch/launch-state.json`) is still pinned to the v13 candidate `5523187`; `npm run launch:drift` correctly reports code drift (`backend/tests/*`, `package.json`). To cut the v14 candidate:

1. Confirm frozen SHA `81993ff` and a clean tree.
2. Re-run the required checks at `81993ff` and record each with `observed_at_sha: 81993ff` + an evidence reference. **A check whose code changed may not be carried forward** — re-run it or mark it `not_run`. (Public Playwright: re-run, or record the bundle-unchanged carry-forward with the identical `index-B75XUgt7` hash as the argument.)
3. Re-observe the owner evidence at the deployed `81993ff`: production readiness (`ready=true`), migrations applied (unchanged — no new migration in v14, so `git diff 5523187..81993ff -- backend/migrations/` is empty), and a quick signed-in re-walk focused on the **new fail-closed billing paths** (a transient DB error must now fail closed with the safe "not charged" copy, never show Free or open a second trial).
4. Set `candidate.sha`, `head_at_generation` and every `observed_at_sha` to `81993ff`; update the evidence prose (test count is now **786**, bundle hash unchanged).
5. `npm run launch:gate` (do **not** hand-edit verdicts) → `npm run launch:render` → commit docs only.

## 5. Verdict (computed, not declared)

- **Capped beta:** **CONDITIONAL — owner re-observation required.** All local automated checks pass at `81993ff` and the shipped frontend is unchanged, but a clean capped-beta GO requires re-observing the owner evidence (production readiness + the fail-closed billing re-walk) and recording the public Playwright result at the new SHA. Nothing here should be read as that evidence.
- **Public paid:** **NO-GO.** Three items stand: the open router advisory `P1-router-rsc-csrf-advisory` (not reachable — proven in §5 of the manifest — but neither accepted nor closed; accepting it with your named rationale + revisit date moves this to CONDITIONAL GO), the skipped authenticated matrix, and the un-run nine-transition live-money rehearsal.

**Router advisory (GHSA-qwww-vcr4-c8h2):** not reachable — proof recorded in the blocker `reachability_evidence`: every `app-src` router import is `react-router-dom`, a single declarative `<BrowserRouter>`, zero RSC/SSR indicators, pure client SPA. No safe forward patch on 7.x (fix is a breaking 7.11.0 downgrade or a react-router-8/React-19/Vite-7 migration). Your decision: accept (named rationale + revisit date) **or** schedule the router-8 migration.

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
