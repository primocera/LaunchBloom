# Owner-only final RC, deploy and production parity — v24 (Prompt 3)

> **Claude Code prepared this; it did NOT execute any of it.** It is an
> operational handoff. Claude never deploys, changes Vercel settings, rotates a
> secret, moves live money, cancels a subscription or mutates the production
> database. Run each step yourself, record only redacted results, and **stop**
> on any stop condition. Current truth: [`docs/LAUNCH_STATE.md`](../LAUNCH_STATE.md).
>
> **Redaction rule:** short SHAs, run ids, UTC times, HTTP status, counts and
> shortened Stripe ids only. **Never** an email, a card, a token or any
> `sk_`/`whsec_`/`rk_`/service-role secret.

Every step starts **NOT RUN**. A step becomes DONE only with a real output and a
redacted evidence reference. Missing evidence stays NOT RUN, never a pass.

## Immutable rules

- **FINAL SHA** = the full 40-char SHA of the clean main commit that contains all
  v24 code (SV-24-01). Write it here once: `FINAL_SHA=________________________________________`.
- After FINAL SHA is chosen, **no new commit goes to main**. Evidence that would
  change the SHA goes to the immutable workflow artifacts, a GitHub Release on
  the tag, or the NON-deploying branch `evidence/v24`.
- Every workflow run's `head_sha`, the deployed commit, and the readiness
  observation must be the SAME FINAL SHA. Runtime similarity or a docs-only diff
  is **not** exact-SHA evidence. Any mismatch keeps the verdict NO-GO / PENDING.
- Any later runtime, package, workflow, migration or config commit supersedes the
  FINAL SHA; restart at step 1.

## 1. Freeze FINAL SHA and run the release-candidate workflow  — status: NOT RUN
```bash
git fetch origin && git checkout main && git pull --ff-only
git status --porcelain            # must be empty
FINAL_SHA=$(git rev-parse HEAD)   # full 40 chars
git tag rc/v24-final "$FINAL_SHA" && git push origin rc/v24-final
git push origin "$FINAL_SHA:refs/heads/rc/v24-final"   # triggers release-candidate.yml (rc/** push)
```
- **Stop condition:** the working tree is dirty, or FINAL SHA is not the tip of main.

## 2. Verify the RC run at exactly FINAL SHA  — status: NOT RUN
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

## 3. Deploy exactly FINAL SHA to Vercel production  — status: NOT RUN
- In Vercel → Deployments, promote the deployment built from commit `FINAL_SHA`
  (the `rc/v24-final` branch/tag build) to Production, or redeploy that exact
  commit. Do not deploy a later main commit.
- Keep production on FINAL SHA: push no further commits to main until the
  evidence is recorded on `evidence/v24` (a branch build is only a Preview). If
  Vercel ever auto-promotes a later commit, use Instant Rollback to the
  FINAL SHA deployment.
- **Stop condition:** the production deployment's commit ≠ FINAL SHA.

## 4. Public health + bundle parity  — status: NOT RUN
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

## 5. Authenticated readiness after the deploy  — status: NOT RUN
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

## 6. Record the evidence and re-run the launch gates  — status: NOT RUN
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

## 7. Billing runtime diff (live money is not repeated when it is empty)  — status: NOT RUN
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

---

## Evidence record — fill one row per step actually performed

| application / FINAL SHA | deploy id / build identity | action id + short desc | observed_at_utc | operator | result (passed/failed/blocked) | redacted evidence ref | expected → observed | stop/rollback result |
|---|---|---|---|---|---|---|---|---|
| Scalvya / — | — | 1 freeze + RC trigger | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 2 RC run verification | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 3 exact deploy | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 4 health + bundle parity | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 5 authenticated readiness | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 6 evidence branch + gates | — | — | NOT RUN | — | — | — |
| Scalvya / — | — | 7 billing runtime diff | — | — | NOT RUN | — | — | — |

## Status roll-up (one status per step; missing evidence = NOT RUN)

| Step | Status |
|---|---|
| 1 Freeze FINAL SHA + RC trigger | NOT RUN |
| 2 RC run at exactly FINAL SHA | NOT RUN |
| 3 Exact deploy | NOT RUN |
| 4 Health version + bundle parity | NOT RUN |
| 5 Authenticated readiness | NOT RUN |
| 6 Evidence branch + launch gates | NOT RUN |
| 7 Billing runtime diff | NOT RUN |

## Final owner result (fill after step 6)

| Field | Value |
|---|---|
| Application | Scalvya |
| FINAL SHA | NOT RUN |
| Workflow run (URL, head_sha, conclusion) | NOT RUN |
| Deployed `/health` version | NOT RUN |
| Readiness observed at (UTC) | NOT RUN |
| audit / lint / unit / build / app-fresh / router / export / public E2E / authenticated E2E / launch integrity | NOT RUN |
| Verdict: capped beta | PENDING |
| Verdict: supervised paid MVP | PENDING |
| Verdict: strict public paid | PENDING |
| Verdict: scale expansion | NOT CERTIFIED (needs a mature cohort report) |

After this checklist, run Prompt 4 (the independent read-only exact-SHA
certification) against the deployed FINAL SHA. Its result is the launch verdict.
