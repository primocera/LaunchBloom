# v23 release certification — final record (corrected by v24)

> **This is the final state of the v23 certification.** The v23 release candidate
> `176a7c6` is **superseded**: v24 (SV-24-01, 2026-09-23) changed executable code,
> so no v23 commit may be the release candidate. The one current launch truth is
> [`docs/LAUNCH_STATE.md`](../LAUNCH_STATE.md), rendered from
> `docs/launch/launch-state.json`. The original v23 Prompt 4 text (written at
> `a5df7af` before the re-cut) is kept verbatim at the bottom under a
> Historical heading and is **not** current truth.

**Repository:** primocera/LaunchBloom (Scalvya)
**Record updated (UTC):** 2026-09-23
**v23 superseded candidate:** `176a7c6859364ee0fd904bc900ec93e159b70197` (bundle `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css`)
**Next candidate:** none frozen — v24 FINAL SHA pending the owner RC (`docs/evidence/OWNER_CHECKLIST_v24.md`)

## Current verdict (computed by `npm run launch:gate`)

- **Capped beta:** **NO-GO** — pending owner RC. Release-integrity hold, not a
  product regression: no candidate is frozen at an exact SHA and no required
  check is observed at the v24 FINAL SHA yet.
- **Public paid:** **NO-GO** — pending owner RC, exact-SHA deploy parity
  (`GET /health` version) and post-deploy readiness at the v24 FINAL SHA.
- Supervised paid MVP: **PENDING** — same exact-SHA RC and deploy evidence; no
  billing evidence is missing (see below).
- Scale expansion: **NOT CERTIFIED** — no mature cohort evidence; never merged
  into an MVP verdict.

## What v23 genuinely established (production evidence that carries forward)

The v24 diff touches no billing, entitlement, webhook, AI, migration or
mail-suppression runtime, so these observations stay valid and the live-money
rehearsal is **not** repeated:

| Evidence | Result | Redacted reference |
|---|---|---|
| Production dependency audit (v23 tree) | `npm audit --omit=dev` = 0 (express 4.22.3 / body-parser 1.20.8 / qs 6.16.0) | `docs/evidence/2026-09-21-dependency-security-patch.md` |
| Unit / contract tests (v23 tree) | 1039/1039, 0 skipped | release-candidate runs below |
| Migration 038-040 probe (read-only, owner) | `app_user_id` uuid present, 0 duplicate non-null rows, `customers_app_user_id_key` non-partial UNIQUE, `stripe_ownership_uniqueness_ready()` = true | `docs/evidence/2026-09-21-migration-038-040-probe.json` |
| Live-money rehearsal — eight-transition, ordered A–H | complete and time-monotone; H refund `re_3UBD6L…` at 2026-09-05T16:11Z, after G (01:15Z); `npm run rehearsal:validate` passes | `docs/evidence/2026-09-05-rehearsal-record.json` |
| Authenticated readiness (owner) | 2026-09-21T16:54Z: HTTP 200, `ready=true`, 0 blockers, `ownership.state=enforcement_active`, `paid_ready=true` — observed on the deployed docs-only descendant `b6414f2` | `docs/evidence/2026-09-21-readiness.json` |

Blocker `P1-live-money-unrehearsed` is closed; no P0/P1 blocker is open or accepted.

## v24 corrections — release integrity, not product

1. **No CI run ever had head SHA `176a7c6`.** GitHub Actions returns zero runs
   for it (API query 2026-09-23). v23 prose claimed every required check re-ran at
   `176a7c6`; the green runs were on its docs-only descendants:

   | Run | head_sha | Conclusion | Required jobs |
   |---|---|---|---|
   | [35558190476](https://github.com/primocera/LaunchBloom/actions/runs/35558190476) | `26c95b2` | **failure** (candidate-gate failed at Code-drift) | candidate-gate failure, authenticated-e2e success |
   | [35624269093](https://github.com/primocera/LaunchBloom/actions/runs/35624269093) | `3739e10` | success | candidate-gate success, authenticated-e2e success |
   | [35630538498](https://github.com/primocera/LaunchBloom/actions/runs/35630538498) | `502ec4e` | success | candidate-gate success, authenticated-e2e success |

   `26c95b2` was therefore never "CI-green". The manifest now records every run
   in `rc_runs`, and `launch:verify` rejects any `passed_ci` claim or frozen
   candidate without a green run at that exact SHA.
2. **Deploy parity was executable-tree parity, not exact-SHA parity.** Production
   served `b6414f2`, and `/health` exposed no version. v24 adds a redacted
   `version` to `GET /health` (the short `VERCEL_GIT_COMMIT_SHA`).
3. **This certificate and the v23 owner checklist were never validated.**
   `active_documents` listed only `docs/LAUNCH_STATE.md`. Both files are now
   active documents: the scan checks candidate, verdict, step status, bundle,
   the A–H count and blocker status in them.

## Historical record (superseded) — v23 Prompt 4 certification as written at a5df7af on 2026-09-21

> Verbatim, not current truth. Its candidate, its CONDITIONAL GO and its
> 'rehearsal fails by design' reflect the state before the v23 re-cut and the
> owner's H-timestamp correction; see the sections above.

**Repository:** primocera/LaunchBloom (Scalvya)
**Branch:** `v23`
**Candidate to freeze (code):** `a5df7af301d299234adda12ce2bb2bc02b1d6b68`
**Certified (UTC):** 2026-09-21
**Certifier posture:** independent release certifier. No missing evidence was
interpreted as a pass. No live money, migration, cancellation, refund, secret
rotation or deploy was performed.

---

### Phase 1 — candidate identity

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

### Phase 2 — automated gates (run locally at `a5df7af`)

| Gate | Command | Result | Count / notes |
|---|---|---|---|
| Lint | `npm run lint` | ✅ pass | 0 errors, 0 warnings |
| Unit / contract | `npm test` | ✅ pass | **1039/1039**, 0 skipped (was 1016; +23 v23 tests) |
| Build | `npm run build:app` | ✅ pass | bundle `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css` (unchanged) |
| Stale-bundle | `npm run check:app-fresh` | ✅ pass | app/ matches app-src/ |
| Router guard | `npm run check:router` | ✅ pass | pure client SPA, no RSC/SSR indicators |
| Prod audit | `npm audit --omit=dev` | ✅ **0** | info/low/moderate/high/critical all 0 |
| Launch integrity | `npm run launch:verify` | ✅ pass | one active truth, evidence pinned, declared verdict = computed |
| Launch gate | `npm run launch:gate` | ⚠️ exit 1 | **NO-GO — stale candidate**: the manifest still pins `e9618f3`; the gate's drift check reports 11 code files changed since it was pinned. This is the honest "re-cut required" signal, not a verdict on the evidence (see below). |
| Rehearsal | `npm run rehearsal:validate -- docs/evidence/2026-09-05-rehearsal-record.json` | ⚠️ exit 1 | **fails by design** — H before G (unordered) |

**Two different questions, kept apart (as the system intends):**
- `launch:verify` / `computeVerdicts` (evidence-based, no live drift) →
  **capped_beta GO / public_paid CONDITIONAL GO**. This is the verdict the
  *evidence* supports and what the re-cut candidate will carry.
- `launch:gate` (adds live git drift) → **NO-GO for both**, solely because the
  pinned candidate `e9618f3` is now stale relative to the v23 code HEAD. Freezing
  the new candidate `a5df7af` (Phase 3 re-cut) clears the staleness; the
  evidence-based verdict above then stands.

Owner/CI-only, NOT run here (needs live secrets / CI): the authenticated seeded
browser matrix (`test:e2e:auth`) at `a5df7af`, and the SHA-pinned audit/e2e
artifacts. These are produced by pushing `v23` / cutting `rc/v23` so the
release-candidate workflow runs them at the exact SHA — that is what re-pins every
check's `observed_at_sha` to `a5df7af`. Missing here = NOT RUN, never a pass.

### Dependency versions + audit

| Package | Before | After |
|---|---|---|
| express | 4.22.2 | **4.22.3** |
| body-parser | 1.20.6 | **1.20.8** |
| qs | 6.15.3 | **6.16.0** |

`npm audit --omit=dev` = **0** vulnerabilities. GHSA-x5fp-wj9c-mxmx (body-parser)
and GHSA-4mjr-xmp4-gh2g (qs) closed. Stays in the Express 4.x line.

### Phase 3/4 — verdicts (computed from evidence, not declared)

| Track | Verdict | Basis |
|---|---|---|
| **capped_beta** | **GO** | every required check green (carried forward + re-run needed at re-cut); no open P0; a supervised, invited cohort absorbs the ordered-recovery path |
| **public_paid** | **CONDITIONAL GO** | proceeds only over the accepted `live-money` risk: the ordered post-G H refund is not yet evidenced (recorded H predates E/F/G) |
| supervised paid MVP | **CONDITIONAL GO** | same accepted `live-money` risk; not a full GO |
| scale expansion | **NOT CERTIFIED** | out of scope — post-MVP; not merged into any MVP verdict |

### Owner-only, pending (see `docs/evidence/OWNER_CHECKLIST_v23.md`)

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

### Statements

- **No missing evidence was interpreted as a pass.** The rehearsal record fails
  the validator and the live-money condition is an accepted risk, not satisfied.
- The dependency audit was **not** carried forward across the new lockfile — it is
  0 at `a5df7af` and re-run as a mandatory RC gate.
- No evidence timestamp, migration status or owner attestation was altered to force
  a green result; the historical rehearsal record is preserved unchanged.
- supervised paid MVP and scale expansion are kept as **separate** verdicts.
