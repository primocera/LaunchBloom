# V19 Current-HEAD Baseline (Prompt 00 — Scalvya)

> Machine-verifiable before-state for the v19 Final Elevation pack. **No application
> behavior was changed to produce this document.** It records what is true at the
> current HEAD so that every later v19 change can be measured against it.
> The single canonical release truth remains `docs/launch/launch-state.json`
> (rendered to `docs/LAUNCH_STATE.md`); this file does not compete with it.

## 1. Exact before-state

| Field | Value |
|---|---|
| Repository | primocera/LaunchBloom (Scalvya) |
| Branch | `v19` (cut from `main`) |
| HEAD SHA | `1a89ce0d84d3e46ce02c6b771dc56e88341dc51a` (`1a89ce0`) |
| Working tree | clean for tracked files (only untracked `*.docx` prompt packs and stray `*.txt` env notes; no tracked changes) |
| Most recent product-code commit | `163fd6d` — `test(e2e): run authenticated matrix single-worker for a deterministic gate` |
| Commits after that | docs-only (`1a89ce0`, `aed3d24`, `0ae6403`, `017ece2`, `2280de4`) |
| Frozen candidate (launch-state) | `017ece27baa3d9b200bc920b5e7f194299d9b91c` (`017ece2`, v18 candidate) |
| Baseline SHA (launch-state) | `a11afda` |
| Migrations on disk | 39 files (37 numbered `001-037` applied set + 2 non-applied: `CHECK_APPLIED.sql`, `E2E_MARKER.sql`) |
| Timestamp (UTC) | 2026-08-16 |

## 2. Baseline quality gate — commands and results (run at HEAD `1a89ce0`)

Run exactly as configured, no repairs made first:

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **0 errors / 0 warnings** |
| Unit / contract / safety | `npm test` | **961 tests, 961 pass, 0 fail, 0 skipped, 0 todo** |
| Production build | `npm run build:app` | **success** — `index-C2TMZ4Jk.js` + `index-KNfjvmSJ.css` (105 modules) |
| Stale-bundle check | `npm run check:app-fresh` | **app/ up to date with app-src/** (normalized hash match vs HEAD) |
| Router reachability | `npm run check:router` | **pure client SPA — no RSC/SSR/server-router indicators** |
| Launch-state integrity | `npm run launch:verify` | **OK** — one active truth, evidence pinned, verdict recomputed |
| Production dependency audit | `npm run audit` (`npm audit --omit=dev`) | **0 vulnerabilities** |

E2E suites (`test:e2e`, `test:e2e:auth`, `test:e2e:a11y`) are **local-only by design** (CI stays lean;
see `package.json` comments and `docs/RUNBOOK_AUTH_E2E.md`). Their last recorded results at the frozen
candidate `017ece2` are public 57 pass / authenticated matrix 45/45 / axe 0 serious-critical — recorded in
`docs/launch/launch-state.json` and `test-results/e2e-auth-evidence.json`. They are **not re-asserted here**;
re-running them is part of cutting a v19 candidate if product code changes.

The bundle and unit-test counts match the frozen-candidate record exactly, i.e. the HEAD carries **no
uncommitted product drift** away from the recorded truth.

## 3. Open issues (from `launch-state.json`, current at HEAD)

| ID | Severity | Status | Note |
|---|---|---|---|
| `P1-router-rsc-csrf-advisory` | P1 | **accepted** (owner) | GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF). Not reachable — no RSC/SSR; `npm audit` now reports 0. Reachability guard enforces it. `review_by` 2026-11-04. |
| `P1-live-money-unrehearsed` | P1 | **accepted** (owner) | Full 8-transition (A–H) live-money rehearsal `not_run`; real $11.31 charge confirms trial→paid. Refund + step G (late `payment_failed` after recovery) unrehearsed. Owner-only. |
| `live_money_rehearsal` (owner_evidence) | — | **not_run** | Same item; gates `public_paid`. Claude Code must never perform live money. |
| all other P0/P1 blockers | — | **closed** | migration truth, entitlement/renewal, authenticated-E2E, hero contrast, spend ceiling. |

## 4. Release-evidence freshness

| Evidence | State | Basis |
|---|---|---|
| Automated gate (lint/unit/build/fresh/router/audit/integrity) | **fresh** at HEAD | re-run 2026-08-16, all green |
| Public + authenticated + axe E2E | **carried forward** from candidate `017ece2` | local-only; re-run required only if v19 changes product code |
| Migrations applied (001-037) | **observed** (owner, 2026-07-28), carried forward | `git diff` over `backend/migrations/` empty since |
| Production readiness (`GET /api/admin/readiness`) | **observed_production** (owner, 2026-08-04), carried forward | config-gate code byte-identical |
| Live-money 8-transition rehearsal | **not_run / accepted risk** | owner-only |
| Resend suppression | **live_rehearsed** (owner, 2026-07-28) | real Resend |

## 5. v19 scope map — where each in-scope prompt would touch

This pack targets **two repositories**. Only **Scalvya** (this repo) is checked out here, so the
`MW-*` prompts (primocera/Mellowa) are **out of scope in this environment** and are neither executed
nor claimed. In-scope Scalvya prompts and their concrete surfaces:

| Prompt | Primary files / surfaces |
|---|---|
| LB-01 Stripe object-graph ownership | `backend/routes/webhooks.js`, `payments.js`, `customers.js`, `backend/lib/stripe.js`, `backend/lib/webhook-reconcile.js`, cross-app/webhook/ordering/reconcile tests |
| LB-02 draft & storage governance | `backend/routes/auth.js`, `backend/lib/auth.js`, `app-src/lib/local-drafts.js`, `app-src/lib/api.js`, studios generator, `AskBox.jsx`, `TrialPaywall.jsx`, storage-inventory test |
| LB-03 readiness + rehearsal evidence (owner gate) | `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`, `backend/scripts/validate-rehearsal.js`, `validate-readiness.js`, `/api/admin/readiness`, launch-state schema |
| LB-04 immutable RC workflow | `.github/workflows/release-candidate.yml`, `backend/scripts/launch-state.js`, `release-check.js`, `scripts/e2e-auth.mjs` |
| LB-05 SLOs / reconciliation / scale | `docs/SLOS.md`, `backend/lib/webhook-reconcile.js`, `backend/scripts/reconcile-stripe-webhooks.js`, `/api/admin/readiness` |
| LB-06 beta scorecard decision engine | `backend/lib/` scorecard/cohort, admin report + CSV, `docs/BETA_SCORECARD*.md`, `BETA_WEEKLY_DECISION*.md` |
| LB-07 UX/content acceptance | `content-contract.test.js`, `app-src/routes/Landing.jsx`, five studios, Review/Library/Export, `paywall-reasons.js` |
| XAPP-01/02/03 (Scalvya side) | `docs/XAPP_ISOLATION_MATRIX*.md`, `docs/THREAT_MODEL.md`, `e2e/a11y-axe.spec.js`, cohort/decision docs |
| FINAL-01 | `docs/launch/launch-state.json`, verdict/handoff docs |

## 6. Non-goals and invariants for v19

- **Do not fork the canonical flow** Brand Profile → Campaign Brief → Create → Review → Library → Export.
- **Do not add features** not asked for; only close genuine gaps and build on existing work.
- **Do not re-do already-implemented work** (memory + git history show v6–v18 already shipped the
  bulk of this pack; the v19 pass is verification + genuine-gap closure only).
- **Never** weaken a test/threshold/ownership rule/safety guard/privacy boundary/billing invariant/release gate.
- **Never** perform live money, production deletion, or destructive production mutation.
- **Never** relabel skipped / not_run / configured / owner-accepted-risk as passed.
- Keep **one** canonical release truth (`launch-state.json`); do not create a second competing register.
- Owner-only live-money and production-readiness evidence stays owner-run.

## 7. Verdict for Prompt 00

**Completed.** A trustworthy before-state is recorded; the ordinary full gate is green at HEAD
`1a89ce0`; no application behavior was changed. The v19 pack proceeds as a verification-and-genuine-gap
pass on top of the frozen v18 candidate, with all owner-only live evidence left in its true state.
