# v23 + v24 prompt compliance checklist — Scalvya (for reviewers)

**Owners:** Primoz Cerar & Tjasa Kumer
**Repository:** primocera/LaunchBloom · **FINAL SHA:** `9be75d1b03d5e2cd59c6757c0b2903ef6f09e064` (= `main`, deployed)
**Evidence branch:** `evidence/v24` (non-deploying) · **Written:** 2026-09-23

Each requirement from the two owner prompt documents was checked against the
code, the workflow runs and the evidence files, not against commit messages.
A ✅ needs an evidence reference. **NOT RUN** means no evidence exists yet, and
**N/A** means the item belongs to the other repository (Mellowa). Items marked
**DONE (v23)** were shipped earlier; their names or paths were re-checked here.

## A. `Finalni_MVP_Release_Popravki_Scalvya_v24` — Prompt 1 (code, commit `9be75d1`)

| # | Requirement (from the doc) | Status | Evidence |
|---|---|---|---|
| A1 | Read the generator, validator, active-doc validator, certificate and checklist before changing any verdict | ✅ | `backend/lib/launch-state.js`, `backend/scripts/launch-state.js` |
| A2 | CERTIFICATION_v23 shows the real final state; old a5df7af / CONDITIONAL GO text only under a Historical heading | ✅ | `docs/evidence/CERTIFICATION_v23.md` |
| A3 | OWNER_CHECKLIST_v23: heading, description, evidence row and roll-up agree; steps 2, 4 and 7 cite evidence | ✅ | `docs/evidence/OWNER_CHECKLIST_v23.md` → `docs/evidence/2026-09-21-migration-038-040-probe.json`, `docs/evidence/2026-09-05-rehearsal-record.json` |
| A4 | `active_documents` includes LAUNCH_STATE, CERTIFICATION_v23 and OWNER_CHECKLIST_v23 | ✅ | `docs/launch/launch-state.json` |
| A5 | Tests fail on: wrong candidate SHA, wrong verdict, DONE vs NOT RUN, wrong bundle hash, wrong A–H count, a blocker closed in one doc and open in another | ✅ | `backend/tests/active-doc-integrity.test.js` (replays the pre-fix v23 files from git and requires them to fail) |
| A6 | Historical sections are not read as current state | ✅ | `currentText()` in `backend/lib/launch-state.js` + test |
| B1 | `GET /health` → `version` = 7–12 hex of `VERCEL_GIT_COMMIT_SHA` | ✅ | `backend/lib/version.js`, `backend/server.js`; production returns `9be75d1b03d5` |
| B2 | Deterministic local fallback; no git process per request | ✅ | `<package version>-dev`, resolved once at startup |
| B3 | No env values, keys, model, config, deployment id or paths exposed | ✅ | sentinel test in `backend/tests/health-version.test.js`; security review clean |
| B4 | Tests: production SHA, local fallback, invalid SHA, no secrets | ✅ | `backend/tests/health-version.test.js` (7) |
| C1 | Don't claim the workflow ran at 176a7c6 when no run has that head_sha | ✅ | the GitHub API returns 0 runs at 176a7c6; recorded in `rc_runs` + CERTIFICATION_v23 |
| C2 | New candidate required; 176a7c6 and 502ec4e not reused | ✅ | FINAL SHA `9be75d1` |
| C3 | Record stays pending until a green artifact exists at the new exact SHA | ✅ | `main` shows `pending_owner_rc`; frozen only on `evidence/v24` after the run |
| C4 | No self-reference loop; the freeze comes from the RC artifact / git tag | ✅ | tag `rc/v24-final`; evidence recorded on a non-deploying branch |
| C5 | Evidence stores run URL, head_sha, conclusion, time and required job names | ✅ | `rc_runs` in `docs/launch/launch-state.json`, enforced by `rcProvenanceProblems()` |
| D1 | Check whether `backend/package-lock.json` is used anywhere | ✅ | not used by CI, Vercel or scripts |
| D2 | Remove it if unused and add a one-manifest test | ✅ | removed; `backend/tests/single-manifest.test.js` |
| D3 | Root `package.json` + lock stay canonical | ✅ | no second dependency source |

**Required commands (local, on the v24 tree):** `npm ci` 0 · `npm audit --omit=dev` 0 vulnerabilities · `lint` 0 · `npm test` **1072/1072** · `build:app` 0 · `check:app-fresh` 0 · `check:router` 0 · `test:export` 15/15 · `launch:verify` 0 · `launch:gate` (NO-GO on `main` by design before the RC; GO on `evidence/v24`) · `launch:drift` 0 · `rehearsal:validate` 0 · `readiness:validate` 0.

**Acceptance criteria:** no active doc claims a current verdict other than the computed one ✅ · no step is both DONE and NOT RUN ✅ · the validator reads the certificate and checklist ✅ · `/health` returns a redacted version ✅ · tests and security green, audit 0 ✅ · new SHA not GO before RC + deploy + readiness ✅.

## B. `Finalni_MVP_Release_Popravki_Scalvya_v24` — Prompt 3 (owner, FINAL SHA `9be75d1`)

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | FINAL SHA = full 40-char SHA of the clean commit | ✅ | `9be75d1b03d5e2cd59c6757c0b2903ef6f09e064`, tag `rc/v24-final` |
| 2 | RC run: success, head_sha = FINAL, candidate gate, authenticated E2E ran (not skipped), audit, public E2E, artifacts named with the SHA | ✅ | [run 35870080139](https://github.com/primocera/LaunchBloom/actions/runs/35870080139) |
| 3 | Deploy exactly FINAL SHA; no later docs commit replaces it | ✅ | `main` = `9be75d1` (evidence kept off `main`) |
| 4 | Public health version = FINAL short SHA; expected JS + CSS bundle | ✅ | `9be75d1b03d5`; `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css` |
| 5 | Authenticated readiness: 200, ready, 0 blockers, enforcement active, paid_ready, all blocker-level config gates ok | ✅ | `docs/evidence/2026-09-23-readiness-v24.json` |
| 6 | Re-run launch verify / gate / drift, rehearsal validate, readiness validate | ✅ | all pass on `evidence/v24` |
| 7 | No A–H repeat when the billing/webhook runtime diff is empty | ✅ | diff from 176a7c6 to 9be75d1 = 0 lines |
| Stop conditions | auth E2E skipped/0 tests; audit finding; version ≠ SHA; readiness blocker; secret/PII; a later runtime commit | none hit | — |

## C. `Finalni_MVP_Release_Popravki_Scalvya_v24` — Prompt 4 (independent certification)

| Item | Status |
|---|---|
| Independent read-only exact-SHA certification against deployed `9be75d1` | **NOT RUN** — run Prompt 4 in a fresh session; its result is the final launch verdict |

## D. `Nujne_MVP_Izboljsave_Scalvya_v23` — Prompt 2 (code, DONE (v23), re-checked 2026-09-23)

| Requirement | Status | Evidence |
|---|---|---|
| express ≥ 4.22.3, body-parser ≥ 1.20.8, qs ≥ 6.16.0; stays on 4.x; no major migrations | ✅ | `npm ls`: 4.22.3 / 1.20.8 / 6.16.0 |
| Reachability note (no `express.urlencoded`) | ✅ | `docs/evidence/2026-09-21-dependency-security-patch.md` |
| Mandatory audit step in release-candidate.yml, no continue-on-error, SHA-pinned JSON artifact, unavailable = fail | ✅ | `.github/workflows/release-candidate.yml`, `backend/scripts/check-audit.js` |
| Contract test for the audit step | ✅ | `backend/tests/rc-audit-gate.test.js` |
| Migrations 001–040 structured truth + 040 probe | ✅ | `docs/evidence/2026-09-21-migration-038-040-probe.json` |
| Cross-field invariant (enforcement_active only when 038–040 are verified) + failing-fixture test | ✅ | `backend/tests/migration-truth-invariant.test.js` |
| Rehearsal validator: ISO-8601 UTC, time-monotone A–H, H before E/F/G fails, completeness only without errors | ✅ | `backend/lib/rehearsal.js`, `backend/tests/rehearsal.test.js` |
| No invented timestamp; H corrected only from the real Stripe time | ✅ | `docs/evidence/2026-09-05-rehearsal-record.json` (`corrections`) |
| Data-rights / €0.96 / test subscription left as owner tasks until real evidence | ✅ | `docs/evidence/OWNER_CHECKLIST_v23.md` steps 4–6 |

## E. `Nujne_MVP_Izboljsave_Scalvya_v23` — final owner checklist

| ☐ from the doc | Scalvya | Evidence |
|---|---|---|
| Deploy on express 4.22.3 / body-parser 1.20.8 / qs 6.16.0, audit 0 | ✅ | RC run 35870080139 audit step; `npm ls` |
| Both RC workflows run the audit with a SHA-pinned JSON artifact | ✅ Scalvya · N/A Mellowa | artifact `rc-evidence-9be75d1…-35870080139` |
| Migration truth 001–040 verified and matching enforcement_active readiness | ✅ | probe JSON + `docs/evidence/2026-09-23-readiness-v24.json` |
| Real H refund after G; validator confirms ordered A–H | ✅ | `docs/evidence/2026-09-05-rehearsal-record.json` (rehearsal:validate OK) |
| Test subscription cancelled; recovery charge closed out | ✅ owner-attested | `docs/evidence/OWNER_CHECKLIST_v23.md` step 5; €0.96 refund owner-reported in `docs/evidence/2026-09-05-live-money-rehearsal.md` |
| Authenticated E2E with no skips and more than 0 tests discovered | ✅ Scalvya · N/A Mellowa | run 35870080139 (RC_GATE=1; the e2e guard fails on 0 executed tests) |
| Deployed SHA = certified candidate | ✅ | `/health` `9be75d1b03d5` = FINAL SHA |
| No NOT RUN vs DONE contradictions in active release docs | ✅ | `npm run launch:verify` (the validator now reads the certificate + checklists) |
| Final verdict computed from evidence, not hand-edited | ✅ | `npm run launch:gate` → capped_beta GO / public_paid GO |

## Verdicts (computed on `evidence/v24` at the FINAL SHA)

| Track | Verdict |
|---|---|
| Capped beta | **GO** |
| Supervised paid MVP | **GO** |
| Strict public paid | **GO** (computed; Prompt 4 gives the independent final verdict) |
| Scale expansion | **NOT CERTIFIED** (no mature cohort report) |

No missing evidence was interpreted as a pass.

**Not in this release:** the login/signup page restyle (blue-to-white sky and
field spacing) is on a separate local branch `login-style` (`6511c29`). It changes
the frontend bundle, so shipping it creates a new FINAL SHA and repeats Prompt 3.
