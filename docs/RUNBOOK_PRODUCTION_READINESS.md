# Runbook — production-readiness observation (OWNER-ONLY)

> **NOT RUN by Claude Code.** This gate is an owner observation against the
> **deployed** release candidate. A validator (`npm run readiness:validate`) and
> this runbook are *preparation*, not the observation. `public_paid` keeps the
> production-readiness item OPEN until a clean record exists.

## What this proves

That the exact candidate pinned in `docs/launch/launch-state.json` is deployed
to **production** and reports itself ready: an authenticated
`GET /api/admin/readiness` returns HTTP 200 with `ready=true` and **0 blockers**.

## Preconditions

- The candidate SHA in `docs/launch/launch-state.json` (`candidate.sha`) is the
  SHA actually deployed to the production domain. If they differ, stop — the
  observation would not describe the candidate.
- You have an admin session (see the admin auth flow). **Never** paste a bearer
  token, cookie, password or full response body into the evidence record.

## Steps

1. Confirm the deployed build matches the candidate (deploy dashboard / commit).
2. As an authenticated admin, call:

   ```
   GET https://<PRODUCTION_DOMAIN>/api/admin/readiness
   Authorization: <YOUR_ADMIN_SESSION>      # placeholder — do NOT record this
   ```

3. Read the response. You are recording only: the HTTP status, the `ready`
   boolean, the blocker **count** and the blocker **category slugs** (not their
   messages). Expected: `200`, `ready=true`, `0` blockers.
4. Copy `docs/evidence/readiness-record.template.json` to
   `docs/evidence/<YYYY-MM-DD>-readiness.json` and fill it in:
   - `candidate_sha`: the exact deployed candidate SHA
   - `deploy_class`: `production`
   - `deploy_ref`: an opaque deploy id or domain class (no credentials)
   - `observed_at_utc`: the ISO-8601 UTC instant you observed it
   - `http_status` / `ready` / `blocker_count` / `blocker_categories`
   - `operator`: your initials/handle (not an email); `attestation`: the sentence
5. Validate the record:

   ```
   npm run readiness:validate -- docs/evidence/<YYYY-MM-DD>-readiness.json --candidate <candidate_sha>
   ```

   A clean exit (0) means the record is a believable production-readiness pass.
   Any non-zero exit prints exactly what is wrong — fix the record or re-observe.

## If it is not ready

Record it honestly: `ready=false` and/or `blocker_count>0` with category slugs.
The validator will reject it as a pass (correct), and the readiness item **stays
open**. Do not edit thresholds, the record or the launch state to force a green
result — investigate the blocker instead.

## Redaction

The record carries opaque ids, counts, timestamps and an attestation only. The
validator rejects emails, card-like digits, `sk_/whsec_/rk_` secrets, bearer
tokens and anything that looks like a pasted response body.
