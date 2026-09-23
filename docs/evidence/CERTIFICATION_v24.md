# v24 independent exact-SHA certification (Prompt 4) — Scalvya

**Owners:** Primoz Cerar & Tjasa Kumer · **Run:** 2026-09-23, separate read-only session
**Reviewed SHA:** `9be75d1b03d5e2cd59c6757c0b2903ef6f09e064` = origin/main = branch + tag `rc/v24-final`
**Mellowa:** N/A (separate repository)

## Identity and production
- Release-candidate run [35870080139](https://github.com/primocera/LaunchBloom/actions/runs/35870080139): head_sha = the reviewed SHA, success; candidate-gate and authenticated-e2e both succeeded (the matrix ran, not skipped); artifacts named with the SHA.
- CI run 35870939703 (push to main) at the same SHA: success.
- GitHub production deployment 6615840022 at 9be75d1 (13:59:50Z), still the latest production deployment. `evidence/v24` was deployed as a Preview only.
- `GET /health`: HTTP 200, `version` `9be75d1b03d5`. Bundle `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css`, byte-identical to a local rebuild.

## Gates re-run by the certifier
- Clean worktree at the SHA: `npm ci` 0 · `npm audit --omit=dev` 0 · lint 0 · `npm test` **1072/1072** (0 fail, 0 skip) · build 0 · app-fresh 0 · router 0 · export 15/15.
- `evidence/v24`: launch:verify OK · launch:gate GO/GO · drift none · rehearsal:validate OK · readiness:validate OK.
- No test was removed or renamed to make a gate pass. The billing/webhook/entitlement/migration runtime diff from 176a7c6 to 9be75d1 is empty, so the A–H rehearsal legitimately carries forward.
- Authenticated `/api/admin/readiness` was not observable without the owner's login. The owner record `docs/evidence/2026-09-23-readiness-v24.json` counts only for what it states.

## Deviations (no P0)

| # | Sev | Deviation | Status |
|---|---|---|---|
| 1 | P1 | Cron freshness had no evidence: readiness only checks `CRON_SECRET` | **CLOSED 2026-09-23:** last successful cron-job.org run 15:00:38Z, after the deploy — `docs/evidence/2026-09-23-cron-freshness.json`; checklist step 5 reworded, step 8 added |
| 2 | P2 | The evidence branch is mutable; no GitHub Release | owner: create a Release on tag `rc/v24-final` + protect `evidence/v24` |
| 3 | P2 | Authenticated E2E counts not publicly visible (artifact 401, logs 403) | owner: download `rc-auth-evidence-…-35870080139` and record the counts |
| 4 | P2 | Some owner evidence has no exact UTC time or reference (migration probe T00:00Z; v23 steps 1 and 5; subscription cancel) | owner: add the times and the subscription reference; confirm the cancel before 2026-10-05 |
| 5 | P2 | Rehearsal H labelled "last charge", but the refunded charge is from 2026-09-02; G's time is rounded | owner: annotate which charge H refunded |
| 6 | P2 | Nothing technically stops a later push to main from replacing production | keep main frozen / restrict production deploys in Vercel |
| 7 | P2 | Support mailbox is not checked by any gate | owner: send one test email to support@ |
| 8 | P2 | 7 findings in dev dependencies (vite/esbuild/postcss); production audit 0 | upgrade vite after launch |

## Verdicts

| Track | Verdict |
|---|---|
| Capped beta | **GO** |
| Supervised paid MVP | **GO** (close deviation #4 before 2026-10-05) |
| Strict public paid | **GO** — the certifier's NO-GO rested only on #1, now closed with owner evidence; `npm run launch:gate` computes it |
| Scale expansion | **NOT CERTIFIED / GATHERING DATA** |

Noben manjkajoč dokaz ni bil interpretiran kot pass.
