# Owner-only final RC, deploy and production parity — v24 (Prompt 3)

> **Owners:** Primoz Cerar & Tjasa Kumer. **Claude Code prepared this; it did NOT execute any owner action.** It is an
> operational handoff. Claude never deploys, changes Vercel settings, rotates a
> secret, moves live money, cancels a subscription or mutates the production
> database. Run each step yourself, record only redacted results, and **stop**
> on any stop condition. Current truth: [`docs/LAUNCH_STATE.md`](../LAUNCH_STATE.md).
>
> **Redaction rule:** short SHAs, run ids, UTC times, HTTP status, counts and
> shortened Stripe ids only. **Never** an email, a card, a token or any
> `sk_`/`whsec_`/`rk_`/service-role secret.

Every step started **NOT RUN** and was marked DONE only with a real output. A step becomes DONE only with a real output and a
redacted evidence reference. Missing evidence stays NOT RUN, never a pass.

## Immutable rules

- **FINAL SHA** = the full 40-char SHA of the clean main commit that contains all
  v24 code (SV-24-01). Write it here once: `FINAL_SHA=9be75d1b03d5e2cd59c6757c0b2903ef6f09e064`.
- After FINAL SHA is chosen, **no new commit goes to main**. Evidence that would
  change the SHA goes to the immutable workflow artifacts, a GitHub Release on
  the tag, or the NON-deploying branch `evidence/v24`.
- Every workflow run's `head_sha`, the deployed commit, and the readiness
  observation must be the SAME FINAL SHA. Runtime similarity or a docs-only diff
  is **not** exact-SHA evidence. Any mismatch keeps the verdict NO-GO / PENDING.
- Any later runtime, package, workflow, migration or config commit supersedes the
  FINAL SHA; restart at step 1.

## 1. Freeze FINAL SHA and run the release-candidate workflow  — status: DONE 2026-09-23
```bash
git fetch origin && git checkout main && git pull --ff-only
git status --porcelain            # must be empty
FINAL_SHA=$(git rev-parse HEAD)   # full 40 chars
git tag rc/v24-final "$FINAL_SHA" && git push origin rc/v24-final
git push origin "$FINAL_SHA:refs/heads/rc/v24-final"   # triggers release-candidate.yml (rc/** push)
```
- **Stop condition:** the working tree is dirty, or FINAL SHA is not the tip of main.
- **DONE 2026-09-23T13:52Z:** branch + tag `rc/v24-final` pushed at `9be75d1` (the v24 code commit, a fast-forward of main `502ec4e`). Evidence: tag `rc/v24-final` on GitHub; `docs/launch/launch-state.json` rc_runs.

## 2. Verify the RC run at exactly FINAL SHA  — status: DONE 2026-09-23
```bash
curl -s "https://api.github.com/repos/primocera/LaunchBloom/actions/runs?head_sha=$FINAL_SHA" \
  | node -e "const r=JSON.parse(require('fs').readFileSync(0));for(const x of r.workflow_runs)console.log(x.id,x.name,x.head_sha,x.status,x.conclusion,x.html_url)"
RUN_ID=<the release-candidate run id from above>
curl -s "https://api.github.com/repos/primocera/LaunchBloom/actions/runs/$RUN_ID/jobs" \
  | node -e "const r=JSON.parse(require('fs').readFileSync(0));for(const j of r.jobs){console.log(j.name,j.conclusion,j.head_sha);for(const s of j.steps)console.log('  ',s.name,s.conclusion)}"
curl -s "https://api.github.com/repos/primocera/LaunchBloom/actions/runs/$RUN_ID/artifacts" \
  | node -e "const r=JSON.parse(require('fs').readFileSync(0));for(const a of r.artifacts)console.log(a.name)"
```
Required: run `conclusion=success`, `head_sha == FINAL_SHA`; job `candidate-gate`
success with the steps "Production dependency audit (fail closed)", "Public
browser suite" and "Code-drift check" all success; job `authenticated-e2e` success
with "Authenticated matrix (release-candidate mode)" **success** (not skipped) and
"Authenticated matrix REQUIRED (fail closed…)" skipped; artifacts
`rc-evidence-<FINAL_SHA>-<RUN_ID>` and `rc-auth-evidence-<FINAL_SHA>-<RUN_ID>`.
- **Stop condition:** authenticated E2E skipped, 0 tests discovered, or pointed
  at production Supabase / live Stripe; the audit step unavailable or reporting
  any production finding; any required job not success.
- **DONE 2026-09-23 (GitHub API):** run [35870080139](https://github.com/primocera/LaunchBloom/actions/runs/35870080139) on `rc/v24-final`, `head_sha` = FINAL SHA, conclusion **success**, 13:52:05Z → 13:57:04Z. candidate-gate success on every step (audit, lint, launch:verify, npm test, build, app-fresh, router, export, public browser suite, code-drift); authenticated-e2e success with "Authenticated matrix (release-candidate mode)" success and the fail-closed fallback skipped; artifacts `rc-evidence-9be75d1b03d5e2cd59c6757c0b2903ef6f09e064-35870080139` and `rc-auth-evidence-9be75d1b03d5e2cd59c6757c0b2903ef6f09e064-35870080139`. Recorded in `docs/launch/launch-state.json` rc_runs.

## 3. Deploy exactly FINAL SHA to Vercel production  — status: DONE 2026-09-23
- In Vercel → Deployments, promote the deployment built from commit `FINAL_SHA`
  (the `rc/v24-final` branch/tag build) to Production, or redeploy that exact
  commit. Do not deploy a later main commit.
- Keep production on FINAL SHA: push no further commits to main until the
  evidence is recorded on `evidence/v24` (a branch build is only a Preview). If
  Vercel ever auto-promotes a later commit, use Instant Rollback to the
  FINAL SHA deployment.
- **Stop condition:** the production deployment's commit ≠ FINAL SHA.
- **DONE 2026-09-23:** `git push origin v24:main` (fast-forward `502ec4e..9be75d1`) only after the RC run was green; Vercel production auto-deployed main = FINAL SHA. Evidence: step 4 `/health` version, `docs/evidence/2026-09-23-readiness-v24.json` (deploy_ref).

## 4. Public health + bundle parity  — status: DONE 2026-09-23
```bash
curl -s https://<production-domain>/health          # expect "version": "<first 12 chars of FINAL_SHA>"
echo "${FINAL_SHA:0:12}"
curl -s https://<production-domain>/app/ | grep -o 'index-[A-Za-z0-9_-]*\.\(js\|css\)'
```
Required: `status=ok`, `version` == first 12 hex of FINAL SHA; the bundle is
`index-Cq2NTdSE.js` + `index-KNfjvmSJ.css` (the v24 frontend is unchanged). The
body must contain only `status`, `app`, `version`, `timestamp`.
- **Stop condition:** version ≠ FINAL SHA short form, `dev`/`-dev` fallback in
  production, or a different bundle.
- **DONE 2026-09-23T14:04:46Z:** `GET https://scalvya.com/health` → `{"status":"ok","app":"Scalvya","version":"9be75d1b03d5",…}` (= FINAL SHA short form); `/app/` serves `index-Cq2NTdSE.js` + `index-KNfjvmSJ.css`. Evidence: `docs/evidence/2026-09-23-readiness-v24.json` (deploy_ref).

## 5. Authenticated readiness after the deploy  — status: DONE 2026-09-23
As the owner admin, open `GET /api/admin/readiness` on production **after** step 4.
Required: HTTP 200, `ready=true`, blockers 0, `ownership.state=enforcement_active`,
`paid_ready=true`, every blocker-level config gate ok (Stripe, AI spend ceiling,
email, legal, cron freshness). Save a PII-free record from
`docs/evidence/readiness-record.template.json` as
`docs/evidence/<date>-readiness-v24.json` with `candidate_sha` = FINAL SHA
(on the `evidence/v24` branch), then:
```bash
npm run readiness:validate -- docs/evidence/<date>-readiness-v24.json --candidate "$FINAL_SHA"
```
- **Stop condition:** any blocker, stale cron, missing legal/Stripe/email/AI
  config, or a record that would need a secret or PII.
- **DONE 2026-09-23T14:04Z (owner):** HTTP 200, mode production, `ready=true`, blockers 0, external 0, all 14 blocker-level config gates ok, `ownership.state=enforcement_active`, `paid_ready=true`, live signals ok (outbox 0, webhook failures 0, leakage 0, AI spend 0 of 15); admin health 24h: 0 webhook failures, 0 failed generations. Record `docs/evidence/2026-09-23-readiness-v24.json`; `readiness:validate --candidate` FINAL SHA → OK.

## 6. Record the evidence and re-run the launch gates  — status: DONE 2026-09-23
On a NON-deploying branch (never main):
```bash
git switch -c evidence/v24 "$FINAL_SHA"
# docs/launch/launch-state.json: candidate.sha = FINAL_SHA, candidate.state = "frozen";
# add the step-2 run to rc_runs (url, head_sha, conclusion, times, jobs, artifacts);
# set each CI check to passed_ci with observed_at_sha = FINAL_SHA (+ run URL in evidence);
# release_config -> observed_production with the step-5 record.
npm run launch:verify
npm run launch:gate
npm run launch:drift
npm run rehearsal:validate -- docs/evidence/2026-09-05-rehearsal-record.json
npm run readiness:validate -- docs/evidence/<date>-readiness-v24.json --candidate "$FINAL_SHA"
npm run launch:render
git push origin evidence/v24
```
- **Stop condition:** any command red for a reason other than a missing owner record.
- **DONE 2026-09-23 on branch `evidence/v24`:** candidate frozen at the FINAL SHA with run 35870080139 in rc_runs; `launch:verify`, `launch:gate` (capped_beta GO / public_paid GO), `launch:drift`, `rehearsal:validate` and `readiness:validate` pass. Evidence: `docs/launch/launch-state.json`, `docs/evidence/2026-09-23-readiness-v24.json`.

## 7. Billing runtime diff (live money is not repeated when it is empty)  — status: DONE 2026-09-23
```bash
git diff --stat 176a7c6859364ee0fd904bc900ec93e159b70197 "$FINAL_SHA" -- \
  backend/routes/payments.js backend/routes/webhooks.js backend/routes/customers.js \
  backend/routes/account.js backend/routes/plans.js backend/lib/stripe.js \
  backend/lib/stripe-ownership.js backend/lib/subscription-state.js backend/lib/plan-limits.js \
  backend/lib/plan-catalog.js backend/lib/currency.js backend/lib/gate.js backend/lib/usage.js \
  backend/lib/webhook-reconcile.js backend/lib/idempotency.js backend/migrations/ api/
```
Expected: empty (it is empty for the v24 code as prepared on 2026-09-23). Then the
ordered A–H live-money evidence (`docs/evidence/2026-09-05-rehearsal-record.json`)
carries forward and no live charge is repeated.
- **Stop condition:** a non-empty diff — stop and write a separate billing
  rehearsal plan; do not run live money from this checklist.
- **DONE 2026-09-23:** the diff from `176a7c6` to `9be75d1` over every path above is **0 lines**, so the ordered A–H evidence `docs/evidence/2026-09-05-rehearsal-record.json` carries forward (rehearsal:validate OK); no live charge was repeated.

---

## Evidence record — fill one row per step actually performed

| application / FINAL SHA | deploy id / build identity | action id + short desc | observed_at_utc | operator | result (passed/failed/blocked) | redacted evidence ref | expected → observed | stop/rollback result |
|---|---|---|---|---|---|---|---|---|
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 1 freeze + RC trigger | 2026-09-23T13:52Z | PC | passed | docs/launch/launch-state.json (rc_runs; tag rc/v24-final) | clean tip → 9be75d1 tagged + pushed | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 2 RC run verification | 2026-09-23T13:57Z | PC | passed | docs/launch/launch-state.json (rc_runs 35870080139) | success, head_sha = FINAL, auth matrix ran → matches | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 3 exact deploy | 2026-09-23T14:04Z | PC | passed | docs/evidence/2026-09-23-readiness-v24.json (deploy_ref) | main = FINAL deployed → matches | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 4 health + bundle parity | 2026-09-23T14:04Z | PC | passed | docs/evidence/2026-09-23-readiness-v24.json (deploy_ref) | version 9be75d1b03d5, bundle index-Cq2NTdSE → matches | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 5 authenticated readiness | 2026-09-23T14:04Z | PC | passed | docs/evidence/2026-09-23-readiness-v24.json (readiness:validate OK) | ready=true, 0 blockers, enforcement_active → matches | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 6 evidence branch + gates | 2026-09-23T14:10Z | PC | passed | docs/launch/launch-state.json (evidence/v24) | all gates green → matches | none |
| Scalvya / 9be75d1 | vercel:main@9be75d1 | 7 billing runtime diff | 2026-09-23T14:05Z | PC | passed | docs/evidence/2026-09-05-rehearsal-record.json (carried forward) | empty diff → matches | none |

## Status roll-up (one status per step; missing evidence = NOT RUN)

| Step | Status |
|---|---|
| 1 Freeze FINAL SHA + RC trigger | DONE 2026-09-23 |
| 2 RC run at exactly FINAL SHA | DONE 2026-09-23 |
| 3 Exact deploy | DONE 2026-09-23 |
| 4 Health version + bundle parity | DONE 2026-09-23 |
| 5 Authenticated readiness | DONE 2026-09-23 |
| 6 Evidence branch + launch gates | DONE 2026-09-23 |
| 7 Billing runtime diff | DONE 2026-09-23 |

## Final owner result (fill after step 6)

| Field | Value |
|---|---|
| Application | Scalvya |
| FINAL SHA | `9be75d1b03d5e2cd59c6757c0b2903ef6f09e064` |
| Workflow run (URL, head_sha, conclusion) | https://github.com/primocera/LaunchBloom/actions/runs/35870080139 · 9be75d1 · success |
| Deployed `/health` version | `9be75d1b03d5` |
| Readiness observed at (UTC) | 2026-09-23T14:04Z |
| audit / lint / unit / build / app-fresh / router / export / public E2E / authenticated E2E / launch integrity | all success in run 35870080139 |
| Verdict: capped beta | GO (computed) |
| Verdict: supervised paid MVP | GO (computed) |
| Verdict: strict public paid | GO (computed; Prompt 4 certifies) |
| Verdict: scale expansion | NOT CERTIFIED (needs a mature cohort report) |

After this checklist, run Prompt 4 (the independent read-only exact-SHA
certification) against the deployed FINAL SHA. Its result is the launch verdict.
