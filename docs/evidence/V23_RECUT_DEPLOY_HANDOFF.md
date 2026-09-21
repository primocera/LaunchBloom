# v23 re-cut + deploy + data-rights — session handoff

> For a fresh Claude Code session. Everything code-side is DONE and merged to
> `main` (commit `f4eeee6`). The evidence-based verdict is **capped_beta GO /
> public_paid GO**. Only two things remain, both mechanical/owner:
> **(1) re-cut** = re-pin the release candidate to the CI-green rc/v23 commit;
> **(2) deploy** that SHA; **(3) data-rights drill**. This doc is the exact recipe.

## Context you can trust
- `main` and `rc/v23` track together. **`NEW` = the latest CI-green rc/v23 commit**
  — resolve it at run time: `git rev-parse origin/rc/v23`. Do NOT hardcode an old
  SHA; use whatever that command returns (it was `f4eeee6…`, then a docs commit on
  top — always pin the latest green one).
- The manifest `docs/launch/launch-state.json` still pins the PRE-v23 candidate
  `e9618f3…`, so `npm run launch:gate` reports NO-GO purely on **stale-candidate
  drift** (11 code files changed). `npm run launch:verify` is OK and the
  evidence-based `computeVerdicts` is already GO/GO. Re-pinning clears the drift.
- Frontend bundle is unchanged: `index-Cq2NTdSE.js` / `index-KNfjvmSJ.css`.
- Live-money A–H is complete/ordered (H refund real time `2026-09-05T16:11Z`);
  ownership enforcement is probe-verified
  (`docs/evidence/2026-09-21-migration-038-040-probe.json`).

---

## STEP 1 — confirm the rc/v23 CI run is green (except drift-by-design)
Open GitHub Actions → `release-candidate` workflow → branch `rc/v23`, latest
commit (`git rev-parse origin/rc/v23`). Required to be GREEN: `npm audit` (0), lint, unit/contract tests,
build, app-fresh, router, export, public browser suite, and the **authenticated
matrix** (`authenticated-e2e` job, zero skips). EXPECTED to fail: the
`launch:drift` / freshness step — it fails *by design* until the candidate is
pinned to this SHA. Nothing else may be red.
- If the `authenticated-e2e` job hard-failed on missing secrets, the GitHub repo
  needs `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`,
  `E2E_SUPABASE_SERVICE_ROLE_KEY`, `E2E_SEED_SECRET` (non-production project) — set
  them and re-run the workflow before continuing. A green RC REQUIRES that job.

**Do not proceed to Step 2 until the run is green except for drift.**

## STEP 2 — re-pin the candidate (the "re-cut")
Let `NEW=f4eeee6ba6eee8fb4e4883669ea75b8b9195f64e` (the CI-green commit). In
`docs/launch/launch-state.json`:

1. `candidate.sha` and `candidate.head_at_generation` → `NEW`. Keep
   `candidate.state = "frozen"`, `candidate.branch = "main"`, bundle unchanged.
2. Re-pin every check to the SHA the RC workflow re-ran them at: replace all
   `"observed_at_sha": "e9618f3607a04d80b60f02fea4eb582a409135ae"` with
   `"observed_at_sha": "<NEW>"` (there are 11). Update each check's `evidence` /
   `note` wording from "prior candidate f8acb2a / rc/v22.1" to "re-run at candidate
   <NEW> in the rc/v23 release-candidate workflow (GitHub Actions)". This is
   legitimate because the RC workflow actually re-ran them at `NEW`.
3. `candidate.explanation`: drop the "RE-CUT REQUIRED / stale" language and the
   leading "v23 SV-23 CORRECTION … HISTORICAL" preamble may stay as history, but
   state that `NEW` is now the frozen, CI-verified v23 candidate (deps patched,
   audit 0, ordered A–H complete, ownership probe-verified).
4. `verdicts.public_paid.note` and `verdicts.capped_beta.note`: remove
   "RE-CUT REQUIRED / pinned candidate is stale"; the candidate is now `NEW`.

Then:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/launch/launch-state.json','utf8'));console.log('JSON OK')"
npm run launch:render
npm run launch:verify   # must be OK (declared == computed; all checks pinned to NEW)
npm run launch:gate     # must now be fully GREEN: capped_beta GO / public_paid GO, exit 0
npm test                # 1039/1039
```
If `launch:verify` complains that a check's evidence is from `e9618f3` while the
candidate is `NEW`, you missed one of the 11 pins — fix and re-run.

## STEP 3 — commit + push
```bash
git add docs/launch/launch-state.json docs/LAUNCH_STATE.md
git commit -m "release(v23): freeze + pin candidate <NEW> — public_paid GO (SV-23)"
git push origin main         # (you're on main; or merge from a branch)
git push origin main:rc/v23  # keep rc/v23 in sync
```

## STEP 4 — deploy (owner, Vercel)
Deploy **exactly `NEW`**. Confirm in the Vercel Deployments dashboard that the
deployed commit == `NEW` (readiness does not expose the SHA). Then hit
`GET /api/admin/readiness` and confirm `ready=true`, `ownership.state=enforcement_active`,
0 blockers. Record deploy id + commit SHA.

## STEP 5 — data-rights drill (owner, in the app UI — NOT sql)
On a **throwaway test account**:
1. **Export** the account (Account → data export). Confirm the packet downloads
   and contains the account's data.
2. **Delete** the account (Account → delete). Confirm a deletion receipt.
3. **Re-export / re-login** → confirm no user data is returned.
4. Confirm that a failed cancel/delete cannot show a false success.
Record a PII-free line in `docs/evidence/OWNER_CHECKLIST_v23.md` (step 6): date,
result, redacted ids only. Optionally set a `data_rights` owner_evidence item if
you want it tracked in the manifest.

## Done when
- `npm run launch:gate` exits 0 (capped_beta GO / public_paid GO, no drift).
- Deployed SHA == pinned candidate `NEW`, readiness green under enforcement.
- Data-rights drill recorded.
