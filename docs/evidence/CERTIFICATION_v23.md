# v23 exact-SHA release certification (Prompt 4)

**Repository:** primocera/LaunchBloom (Scalvya)
**Branch:** `v23`
**Candidate to freeze (code):** `a5df7af301d299234adda12ce2bb2bc02b1d6b68`
**Certified (UTC):** 2026-09-21
**Certifier posture:** independent release certifier. No missing evidence was
interpreted as a pass. No live money, migration, cancellation, refund, secret
rotation or deploy was performed.

---

## Phase 1 — candidate identity

- Branch `v23`, HEAD `a5df7af` (this doc + the runbook fix land as a docs-only
  follow-up; both are non-code, so they do not invalidate the code candidate).
- Working tree is clean of product/code changes.
- **Drift from the prior pinned candidate `e9618f3`** (classified):
  - dependency: `package.json` / `package-lock.json` (express 4.22.3, body-parser
    1.20.8, qs 6.16.0 via `overrides`).
  - workflow: `.github/workflows/release-candidate.yml` (mandatory audit gate).
  - backend code: `backend/lib/launch-state.js`, `backend/lib/rehearsal.js`,
    `backend/scripts/check-audit.js`, + 3 test files.
  - docs/evidence only: the manifest, README, CLAUDE.md, scope note, runbook,
    evidence files.
  - **No `app-src/` / `app/` / `api/` change** — the served bundle stays
    `index-Cq2NTdSE` (browser + billing runtime paths carry forward byte-identical).
- **A new candidate SHA is REQUIRED.** A dependency + workflow + backend diff means
  the pinned candidate cannot be carried forward. The manifest still pins the
  pre-v23 candidate `e9618f3` and its per-check evidence is observed at `e9618f3`;
  re-pinning to `a5df7af` REQUIRES re-running the checks at `a5df7af` in the
  release-candidate workflow (below). That re-pin is deliberately NOT done by hand.

## Phase 2 — automated gates (run locally at `a5df7af`)

| Gate | Command | Result | Count / notes |
|---|---|---|---|
| Lint | `npm run lint` | ✅ pass | 0 errors, 0 warnings |
| Unit / contract | `npm test` | ✅ pass | **1039/1039**, 0 skipped (was 1016; +23 v23 tests) |
| Build | `npm run build:app` | ✅ pass | bundle `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css` (unchanged) |
| Stale-bundle | `npm run check:app-fresh` | ✅ pass | app/ matches app-src/ |
| Router guard | `npm run check:router` | ✅ pass | pure client SPA, no RSC/SSR indicators |
| Prod audit | `npm audit --omit=dev` | ✅ **0** | info/low/moderate/high/critical all 0 |
| Launch integrity | `npm run launch:verify` | ✅ pass | one active truth, evidence pinned, verdict recomputed |
| Launch gate | `npm run launch:gate` | ⚠️ exit 1 | capped_beta GO / public_paid CONDITIONAL GO (correct — not full GO) |
| Rehearsal | `npm run rehearsal:validate -- docs/evidence/2026-09-05-rehearsal-record.json` | ⚠️ exit 1 | **fails by design** — H before G (unordered) |

Owner/CI-only, NOT run here (needs live secrets / CI): the authenticated seeded
browser matrix (`test:e2e:auth`) at `a5df7af`, and the SHA-pinned audit/e2e
artifacts. These are produced by pushing `v23` / cutting `rc/v23` so the
release-candidate workflow runs them at the exact SHA — that is what re-pins every
check's `observed_at_sha` to `a5df7af`. Missing here = NOT RUN, never a pass.

## Dependency versions + audit

| Package | Before | After |
|---|---|---|
| express | 4.22.2 | **4.22.3** |
| body-parser | 1.20.6 | **1.20.8** |
| qs | 6.15.3 | **6.16.0** |

`npm audit --omit=dev` = **0** vulnerabilities. GHSA-x5fp-wj9c-mxmx (body-parser)
and GHSA-4mjr-xmp4-gh2g (qs) closed. Stays in the Express 4.x line.

## Phase 3/4 — verdicts (computed from evidence, not declared)

| Track | Verdict | Basis |
|---|---|---|
| **capped_beta** | **GO** | every required check green (carried forward + re-run needed at re-cut); no open P0; a supervised, invited cohort absorbs the ordered-recovery path |
| **public_paid** | **CONDITIONAL GO** | proceeds only over the accepted `live-money` risk: the ordered post-G H refund is not yet evidenced (recorded H predates E/F/G) |
| supervised paid MVP | **CONDITIONAL GO** | same accepted `live-money` risk; not a full GO |
| scale expansion | **NOT CERTIFIED** | out of scope — post-MVP; not merged into any MVP verdict |

## Owner-only, pending (see `docs/evidence/OWNER_CHECKLIST_v23.md`)

1. Freeze `a5df7af` as the RC (push `v23` / cut `rc/v23`) so the workflow re-runs
   every check + the mandatory audit + the authenticated matrix at that SHA, then
   re-pin the manifest candidate + check evidence to `a5df7af`.
2. Read-only migration 038-040 probe (app_user_id, non-partial UNIQUE arbiter,
   `stripe_ownership_uniqueness_ready()` = true) → then set
   `migrations.ownership_enforcement` accordingly.
3. Ordered post-G H refund (`POST_G_REFUND_H_TEMPLATE.md`), then re-validate.
4. Refund the €0.96 recovery charge and cancel the test subscription before renewal (~2026-10-02).
5. Data-rights export + delete drill on a test account.
6. Deploy parity: deploy exactly the certified SHA; confirm in the Vercel dashboard.

## Statements

- **No missing evidence was interpreted as a pass.** The rehearsal record fails
  the validator and the live-money condition is an accepted risk, not satisfied.
- The dependency audit was **not** carried forward across the new lockfile — it is
  0 at `a5df7af` and re-run as a mandatory RC gate.
- No evidence timestamp, migration status or owner attestation was altered to force
  a green result; the historical rehearsal record is preserved unchanged.
- supervised paid MVP and scale expansion are kept as **separate** verdicts.
