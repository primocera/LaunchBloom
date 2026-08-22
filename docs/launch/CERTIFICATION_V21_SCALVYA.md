# Exact-SHA Release Certification — Scalvya (v21 / SV-21-01)

> Independent certification per `Scalvya_MVP_Launch_Closure_v21.docx` **Prompt 3**,
> run in `primocera/LaunchBloom` only. Mellowa (Prompt 2) is a separate repository
> and is **out of scope** here — no evidence, migration, Stripe object or verdict
> is combined across products. This document is **code + local evidence**; every
> production/owner item below is truthfully **NOT RUN** until the owner attaches
> redacted production evidence. A truthful CONDITIONAL/NO-GO here is a successful
> certification result, not a failure.

## 1. Candidate identity

| Field | Value |
|---|---|
| Repository | `primocera/LaunchBloom` |
| Branch | `v21` |
| Implementation SHA (this closure) | **`e1179d8`** (built on audited HEAD `d55722b`) |
| Pinned frozen candidate (unchanged) | `24d350c` (v19) — see `docs/launch/launch-state.json` |
| Runtime | Node `v24.15.0`, npm `11.12.1` |
| Migrations on disk | `001-039` (+ 2 unnumbered non-applied); **applied range still `001-037`** |
| Served bundle | `index-Cq2NTdSE.js` + `index-KNfjvmSJ.css` (unchanged — no frontend change) |

**Candidate status:** `e1179d8` is a **backend code + migration change**, so by the
manifest's own rule it constitutes a **new candidate** and does **not** move the
pinned frozen candidate `24d350c`. A new RC must be cut by the owner before the
pinned SHA advances; this certification does **not** freeze one or promote a verdict.

## 2. Change scope since the last promoted candidate & invalidated evidence

Closes the v21 doc's Prompt 1 (Stripe ownership / billing identity), built on the
v20 SV-01 ownership service. **All behavioural change is gated behind
`STRIPE_OWNERSHIP_ENFORCED` (default OFF)**, so with the flag unset the runtime is
byte-for-byte the prior behaviour.

- **A** — `customers.findCustomerRow` (canonical app_user_id lookup, fail-closed on
  read error / multiple rows); `payments.ensureStripeCustomer`, `ownsSubscription`,
  `hadTrialOrActiveSubscription` and `account.js` billing/portal/delete routed
  through it; `onConflict:'app_user_id'` under enforcement.
- **B** — `webhooks.classifyInvoiceOwnership` replaces the price-only `isOurInvoice`;
  ownership decided by the subscription, unavailable reads fail closed (retryable).
- **C** — enforced `checkout.session.completed` verifies exact source + app_user_id
  before persisting; never relinks by email.
- **D** — migration `039` (additive partial UNIQUE index), `ownership-readiness`
  classifier surfaced on `GET /api/admin/readiness`, runbook + launch-state updated.

**Invalidated:** none of the prior candidate's carried-forward evidence is
invalidated for the **pinned** candidate (that remains `24d350c`). For the **new**
`e1179d8` candidate, the automated code gate below was RE-RUN at this SHA; no prior
production owner evidence may be carried onto it without a fresh deployed
observation at `e1179d8`.

## 3. Automated evidence table (re-run at `e1179d8`)

| Gate | Command | Result | Status |
|---|---|---|---|
| Lint | `npm run lint` | 0 errors / 0 warnings | ✅ passed_locally |
| Unit / contract / safety | `npm test` | **997 pass / 0 fail / 0 skip** (978 prior + 19 new SV-21-01) | ✅ passed_locally |
| Production build | `npm run build:app` | success — `index-Cq2NTdSE` (unchanged) | ✅ passed_locally |
| Bundle freshness | `npm run check:app-fresh` | app/ matches app-src/ | ✅ passed_locally |
| Launch-state integrity | `npm run launch:verify` | OK — verdicts recomputed, active doc in sync | ✅ passed_locally |

New SV-21-01 regression/adversarial coverage (`backend/tests/stripe-ownership-enforcement.test.js`, 19 tests) exercises the doc's scenarios: configured price + foreign stamp ignored; exact stamp accepted; legacy_price owning OFF / dropped ON; unavailable DB/Stripe reads fail closed (retryable); trusted mirror accepted, foreign-stamped mirror rejected; wrong-user checkout customer never adopted even with matching email; multiple app_user_id rows fail closed; fail-closed paid readiness. Existing suites (webhook-isolation 14, webhook-ordering, cross-app-isolation, stripe-ownership, billing-idempotent-customer, entitlement-*) remain green — email-change, two-products-one-email, concurrent race and redelivery-idempotency scenarios are covered there.

> Not run locally (owner/CI, unchanged from prior candidate policy): public browser
> E2E, authenticated seeded matrix, export-integrity, hero-contrast, router
> reachability — these are pinned to their SHA in `launch-state.json` and must be
> re-run for `e1179d8` in the fail-closed release-candidate workflow before this SHA
> is promoted, because backend billing code changed.

## 4. Owner evidence table (production) — NOT RUN

| Action | Required for | Real status | Stop condition |
|---|---|---|---|
| Apply migration `038` (app_user_id + legacy map) | bounded paid | **NOT RUN** | preflight counts recorded; verify `backfilled_app_user_id` == `with_meta_user` |
| Apply migration `039` (partial UNIQUE index) | bounded paid | **NOT RUN** | duplicate-preflight returns **zero** rows before `CREATE UNIQUE INDEX` |
| Backfill legacy Stripe objects (`scripts/backfill-stripe-ownership.js`) | bounded paid | **NOT RUN** | read-only inventory first; bounded `--apply`; every ambiguous row reconciled |
| Set `STRIPE_OWNERSHIP_ENFORCED=1` | bounded paid | **NOT RUN** | readiness `ownership.state == fallback_enabled`, `blockers == []` first; then must read `enforcement_active` / `paid_ready:true` |
| Eight-transition live-money rehearsal (A–H) | bounded paid | **NOT RUN** (partially rehearsed — real $11.31 charge) | refund + step G (late payment_failed after recovery) with out-of-order webhooks |
| `GET /api/admin/readiness` against deployed `e1179d8` | capped beta + bounded paid | **NOT RUN** | 200, ready=true, 0 blockers at the deployed SHA |

Claude Code produced the commands, verifications and stop conditions only. **Owner
executes; Claude never applies a migration, runs the backfill, moves live money or
deploys.**

## 5. Open blocker register

| ID | Sev | Affected tier | Real status | Closure test |
|---|---|---|---|---|
| SV-21-migrations-not-applied | P1 | bounded paid | open (NOT RUN) | 038+039 applied & verified; readiness `ownership.blockers == []` |
| SV-21-enforcement-off | P1 | bounded paid | open (by design) | after backfill, `STRIPE_OWNERSHIP_ENFORCED=1`; readiness `enforcement_active` |
| P1-live-money-unrehearsed | P1 | bounded paid | accepted risk (owner) | full A–H rehearsal with redacted evidence |
| P1-router-rsc-csrf-advisory | P1 | public paid | accepted risk (owner) | react-router 8 migration or audit-clean confirmation |
| new-RC-not-cut | P1 | bounded paid | open | owner cuts & freezes an RC at `e1179d8` and re-runs the full SHA-pinned gate |

## 6. Verdicts (independent per tier)

- **Product capability:** **STRONG** — the canonical billing-identity/ownership
  closure is coherent, gated and reversible; no material product defect surfaced.
- **Capped beta:** **GO (unchanged, on the pinned candidate `24d350c`).** v21 with
  the flag OFF is byte-identical beta behaviour; adopting `e1179d8` for beta only
  requires the standard deployed-readiness re-run at that SHA.
- **Bounded paid:** **CONDITIONAL GO → effectively NO-GO until owner steps run.**
  The code path for stable-identity, ownership-enforced billing exists and is
  proven locally, but bounded paid **requires** migrations 038+039 applied, the
  backfill complete with zero ambiguous rows, `STRIPE_OWNERSHIP_ENFORCED=1`
  observed as `enforcement_active`, the A–H live-money rehearsal, and a deployed
  readiness observation at `e1179d8`. Until that owner evidence is attached, the
  honest verdict is **NO-GO for a new paid expansion at this SHA**.
- **Unrestricted scale:** **NO-GO** — only MVP/code evidence exists; mature cohort
  and 10x capacity evidence are out of scope (deferred per the v21 appendix).

## 7. Rollback & kill-switch

- **Code:** revert `e1179d8` and rebuild `app/` (no frontend change; bundle
  unchanged). Independent, additive commit.
- **Data:** migrations 038/039 are additive & reversible (drop index / drop
  column / drop table — headers carry data-safe rollback). Not applied here.
- **Flag:** `STRIPE_OWNERSHIP_ENFORCED` is the single reversible switch — unset it
  to instantly return to the price-only fallback with no code change.
- **Existing kill switches unchanged:** `AI_GENERATION_PAUSED`, `SIGNUP_PAUSED`,
  `BETA_INVITE_CAP`, launch-config fail-closed.

## 8. Next single owner action

**Cut and freeze a release candidate at `e1179d8`, run the SHA-pinned release
gate, then apply migration 038 (preflight → apply → verify) on a disposable
environment first.** Everything else (039, backfill, enforcement flip, live-money
rehearsal) follows the ordered checklist in `docs/RUNBOOK_STRIPE_OWNERSHIP.md`.
Do not open a paid expansion until readiness reports `ownership.state =
enforcement_active` with `paid_ready: true` at the deployed candidate.
