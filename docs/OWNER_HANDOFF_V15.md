# Owner handoff — v15 final launch closure

> Prepared by Claude Code on branch `v15`. This document contains **no live
> action**. Every deploy, migration, Stripe/Supabase mutation and live-money
> step below is **owner-only** and must be run by you with real credentials.
> Nothing here may be read as production/authenticated/live evidence — those
> statuses are only true after *you* run them against the real environment.
> The single source of truth is `docs/launch/launch-state.json`
> (`docs/LAUNCH_STATE.md` is its rendered view).

## 1. Frozen candidate

| Field | Value |
|---|---|
| Candidate SHA (v15, frozen) | `b234dad77a72910d4c94555eb0a2c410c2a0a1a9` (`b234dad`) |
| Branch | `v15` |
| Rollback SHA (prior candidate) | `81993ffb4bbcd358e0e2a3ede9e85540581c4352` (`81993ff`) |
| Frontend bundle | `index-B75XUgt7.js` / `index-Ck_SQ1wq.css` — **byte-identical to the prior candidate** |

**What v15 changed (all documentation/backend/test only — no frontend source):**

- `d70d81b` SC-01 — one active launch truth + an active-document integrity scanner.
- `16e2b06` SC-02 — idempotent Stripe customer creation + read-only orphan recovery.
- `f72514a` SC-03 — authenticated matrix refuses a live Stripe key; billing-failure journey.
- `e8ba74d` SC-04 — canonical eight-transition (A–H) rehearsal matrix + record schema/validator.
- `6748c18` SC-05 — RSC-reachability guard + accepted-risk review-date enforcement.
- `b234dad` XAPP-01 — Scalvya-side cross-app Stripe isolation matrix.

`git diff 81993ff..b234dad` over `app/`, `backend/migrations/`,
`backend/lib/launch-config.js` and `backend/scripts/release-check.js` is
**EMPTY**, so the served bundle, applied migrations and production config-gate
are byte-identical to the prior candidate.

## 2. Local gate — re-run at the frozen SHA (all green)

Fresh `npm ci`, then:

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASSED LOCALLY (0 errors, 0 warnings) |
| Unit/contract/safety | `npm test` | PASSED LOCALLY — 850/850 |
| Build | `npm run build:app` | PASSED LOCALLY — bundle `index-B75XUgt7` (unchanged) |
| Stale-bundle | `npm run check:app-fresh` | PASSED LOCALLY — app/ matches app-src/ |
| Router reachability | `npm run check:router` | PASSED LOCALLY — pure client SPA, no RSC indicators |
| Export integrity | `npm run test:export` | PASSED LOCALLY — 15/15 |
| Public browser | `npm run test:e2e` | RE-RUN FRESH — 50 clean; the 2 documented specs flaked under parallel load and passed single-worker in isolation (25/25) |
| Launch integrity | `npm run launch:verify` | OK |
| Prod dep audit | `npm run audit` | 2 high (react-router RSC-mode CSRF, **accepted, not reachable** — see §5) |

## 3. Checks that are BLOCKED for me (owner/CI must run)

- **Authenticated matrix** (`npm run test:e2e:auth`): BLOCKED — needs a disposable non-production Supabase project (`E2E_MARKER.sql` opt-in). The runner refuses production/unrecognized targets **and a live Stripe key**, and exits non-zero rather than skipping. See `docs/RUNBOOK_AUTH_E2E.md`.
- **Production readiness / config gate** (`GET /api/admin/readiness`): owner-only — needs production secrets. Re-confirm on the deployed `b234dad`.
- **Eight-transition (A–H) live-money rehearsal**: owner-only — see `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`; record with `docs/evidence/rehearsal-record.template.json` and `npm run rehearsal:validate`.

## 4. Candidate is pinned to `b234dad` (done)

The manifest is pinned to the v15 candidate `b234dad`; the prior candidate
`81993ff` is recorded only as history. At the pinned candidate:

- `npm run launch:verify` → OK · `npm run launch:gate` → **capped_beta: GO**, **public_paid: CONDITIONAL GO** · `npm run launch:drift` → none.

## 5. Verdict (computed, not declared)

- **Capped beta:** **GO** (candidate `b234dad`; `launch:gate` computes GO). Owner-confirmed production readiness carries forward (config-gate code byte-identical); a quick re-confirm on the deployed `b234dad` is recommended before opening the cohort.
- **Public paid:** **CONDITIONAL GO.** No unaccepted blocker remains, but three required conditions are only bypassed by named accepted risks, never satisfied: the router advisory `P1-router-rsc-csrf-advisory` (accepted, not reachable — mechanically guarded by `npm run check:router`, review_by 2026-11-04), the authenticated matrix (`skipped`), and the eight-transition live-money rehearsal (`not_run`). Run the last two to convert them from accepted risk to satisfied before opening unrestricted public signup.

---

# LAUNCH-01 — capped-beta deployment control (owner-supervised)

> Launch-control **preparation**, not authorization for autonomous deployment.
> Present the plan, get explicit approval, then run only the approved target/SHA
> (`b234dad`) yourself. The full pre-deploy / deploy-authorization / post-deploy
> smoke / 72-hour monitoring / stop-conditions / rollback / beta-scope checklists
> from the prior handoff still apply verbatim, with the candidate SHA `b234dad`
> and rollback SHA `81993ff`; nothing at the data layer changed
> (`git diff 81993ff..b234dad -- backend/migrations/` is empty).
