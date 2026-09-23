# Owner-only production checklist — v23 (Prompt 3)

> **Claude Code prepared this; it did NOT execute any of it.** Every step below is
> owner-only. Claude never runs a live charge, refund, cancellation, account
> delete, production migration, secret rotation or deploy. For each step: run it
> yourself, observe the real result, then record only the redacted fields in the
> evidence table. If a result differs from *expected*, **stop** — do not hand-edit
> the database or a document to make it green.
>
> **Redaction rule:** record shortened/opaque Stripe ids (`re_…last4`), UTC time,
> amount/currency and the observed outcome. **Never** store an email, card number,
> or any `sk_`/`whsec_`/`rk_`/service-role secret.
>
> **v24 reconciliation (2026-09-23).** This checklist is closed. Each step now
> carries ONE status in its heading, body, evidence row and roll-up, and every
> DONE step cites its redacted evidence. The superseded candidate 176a7c6 is no
> longer the release candidate: v24 changed code, and its owner steps live in
> [`OWNER_CHECKLIST_v24.md`](OWNER_CHECKLIST_v24.md). Current truth:
> [`docs/LAUNCH_STATE.md`](../LAUNCH_STATE.md).

A step is DONE only with a real output and a redacted evidence reference;
otherwise it stays NOT RUN (or SUPERSEDED when a later checklist replaces it).

---

## 1. Deploy / candidate SHA parity  — status: SUPERSEDED (executable-tree parity only)
- The v23 target was the superseded candidate 176a7c6 (full SHA
  `176a7c6859364ee0fd904bc900ec93e159b70197`). The step's stop condition was:
  deployed SHA ≠ `176a7c6` (or its docs-only pin commit `3739e10`) → do not open paid.
- Observed 2026-09-21: Vercel production served `main@b6414f2`, a docs-only
  descendant of `176a7c6` (identical executable tree, bundle `index-Cq2NTdSE`).
  Deploy id: Vercel `main` build (github/primocera), Ready.
- **SUPERSEDED (v24 correction):** `b6414f2` is neither `176a7c6` nor `3739e10`,
  and `/health` exposed no version. That is executable-tree parity, not exact-SHA
  parity. Exact-SHA deploy parity is now v24 steps 3–4 (`GET /health` reports the
  deployed short SHA).

## 2. Read-only exact migration probe 038-040  — status: DONE 2026-09-21
Run in the Supabase SQL editor (read-only), record each result:
```sql
-- (a) app_user_id column present + ownership legacy map exists (038)
select column_name from information_schema.columns
 where table_name='customers' and column_name='app_user_id';
-- (b) no duplicate non-null app_user_id (040 preflight; expect ZERO rows)
select app_user_id, count(*) from public.customers
 where app_user_id is not null group by app_user_id having count(*) > 1;
-- (c) the unique index exists AND is NON-partial (expect indisunique=t, non_partial=t)
select i.indisunique, i.indpred is null as non_partial
  from pg_index i join pg_class ic on ic.oid=i.indexrelid
 where ic.relname='customers_app_user_id_key';
-- (d) the runtime arbiter probe (expect TRUE)
select public.stripe_ownership_uniqueness_ready();
```
- **Stop condition:** (b) returns any row, (c) not non-partial, or (d) not TRUE →
  enforcement is NOT ready; keep `migrations.ownership_enforcement = pending`.
- **DONE 2026-09-21 (owner, read-only):** (a) `app_user_id` present, uuid; (b) 0
  duplicate non-null rows; (c) `indisunique=true`, `non_partial=true`; (d)
  `stripe_ownership_uniqueness_ready()` = TRUE. PII-free record
  `docs/evidence/2026-09-21-migration-038-040-probe.json`; launch-state
  `migrations.ownership_enforcement` = `applied_verified`.

## 3. Authenticated `/api/admin/readiness` capture  — status: DONE 2026-09-21
Record ONLY: HTTP status, `ready`, blocker count, `ownership.state`, `paid_ready`,
the migration-probe result, and the UTC time. No secrets, no PII.
- **Stop condition:** `ready` ≠ true or `ownership.blockers` non-empty.
- **DONE 2026-09-21T16:54Z:** HTTP 200, `ready=true`, blockers 0, external 0,
  `ownership.state=enforcement_active`, `paid_ready=true`, `enforced=true`; all 14
  blocker-level config gates ok; live signals ok (ai spend 0 of $15 ceiling). PII-free
  record `docs/evidence/2026-09-21-readiness.json`, validated by
  `npm run readiness:validate -- docs/evidence/2026-09-21-readiness.json --candidate 176a7c6859364ee0fd904bc900ec93e159b70197`
  → OK. Observed on the deployed docs-only descendant `b6414f2` (see step 1): valid
  production evidence for that runtime, re-observed at the v24 FINAL SHA in v24 step 5.

## 4. Ordered post-G H refund  — status: DONE 2026-09-05
On the live test subscription, **after G**, refund a charge and confirm the refund
alone leaves entitlement unchanged.
- **Stop condition:** refund not verified in Stripe, or the refund alone changes entitlement.
- **DONE (real Stripe time 2026-09-05T16:11Z, after G at 01:15Z):** refund
  `re_3UBD6L…` succeeded; the app still showed the plan active (subscription
  scheduled to cancel, entitlement unchanged by the refund alone). The recorded H
  timestamp had been a data-entry error (2026-09-04T23:36:28Z); it was corrected on
  2026-09-21 to the time shown in the owner's Stripe dashboard. Redacted row H in
  `docs/evidence/2026-09-05-rehearsal-record.json`; narrative
  `docs/evidence/2026-09-05-live-money-rehearsal.md`.
- Cleanup refund of the €0.96 recovery charge (invoice `in_1UC7c4…`): owner-reported
  as refunded in `docs/evidence/2026-09-05-live-money-rehearsal.md`; it is cleanup,
  not part of the A–H evidence.

## 5. Cancel the test subscription  — status: DONE 2026-09-21 (owner-attested)
Cancel end-of-period (`cancel_at_period_end`) so it does not renew.
- Deadline: **before the next renewal (~2026-10-02)**, else a real charge is taken.
- **Stop condition:** UI shows success while Stripe still schedules the next charge.
- **DONE 2026-09-21 (owner-attested):** the owner confirms the test subscription is
  set to `cancel_at_period_end`. It stays valid until the period ends, then
  terminates with no renewal charge. The evidence is the owner's attestation of the
  Stripe state; no redacted Stripe export is stored in the repository.

## 6. Data-rights drill (export + delete)  — status: DONE 2026-09-21
- Run a live **account export**; then a **test account delete** on a dedicated test
  account; confirm a deletion receipt and that a **re-export returns no user data**.
- **Stop condition:** cancellation or delete fails but the UI shows a false success.
- **DONE 2026-09-21 (owner, live app UI, dedicated test account — redacted ids only):**
  - **Export** ✅ — downloaded `scalvya-export.json`, `export_version: 2`, correct
    account (user `548e…5682`), `workspace_count: 1` (ws `024a…39e0`), all data tables
    present (empty on this account). Machine-readable packet as specified.
  - **Delete** ✅ — UI showed "Deletion request completed" (receipt `completed: true`);
    account/workspace/assets removed; deletion-record email sent; Stripe invoices +
    anonymized analytics retained by design (stated in receipt).
  - **Re-login** ✅ — sign-in with the same account rejected ("Incorrect email or
    password") → auth user deleted, sessions revoked, no user data returned.
  - **False-success guard** ✅ — `receipt.completed` is `true` only when every step is
    `ok`; a failed step flips it and adds a support note.
  - (No PII stored: email omitted; ids truncated.)

## 7. Record the real H + re-validate  — status: DONE 2026-09-21
- The genuine post-G H is recorded in the rehearsal record at its real Stripe time
  (2026-09-05T16:11Z).
- `npm run rehearsal:validate -- docs/evidence/2026-09-05-rehearsal-record.json`
  → OK (schema OK, liveRehearsalCompleteness=complete, A–H time-monotone).
- **DONE 2026-09-21:** `owner_evidence.live_money_rehearsal` = observed and blocker
  `P1-live-money-unrehearsed` closed in the launch-state. Re-validated on
  2026-09-23 in v24 (still OK). Evidence: `docs/evidence/2026-09-05-rehearsal-record.json`.

---

## Evidence record — one row per step actually performed

| application / candidate_sha | deploy id / build identity | action id + short desc | observed_at_utc | operator | result (passed/failed/blocked) | redacted evidence ref | expected → observed | stop/rollback result |
|---|---|---|---|---|---|---|---|---|
| Scalvya / 176a7c6 | vercel main@b6414f2 (docs-only descendant; executable identical) | 1 deploy SHA parity | 2026-09-21 | PC | superseded — executable-tree parity only | Vercel Deployments dashboard | deployed == 176a7c6 → deployed b6414f2 (exact SHA not met) | replaced by v24 steps 3–4 |
| Scalvya / production DB | Supabase SQL editor (read-only) | 2 migration 038-040 probe | 2026-09-21 | PC | passed | docs/evidence/2026-09-21-migration-038-040-probe.json | 0 dup rows, non-partial UNIQUE, probe TRUE → matches | none |
| Scalvya / 176a7c6 | vercel main@b6414f2 | 3 authenticated readiness | 2026-09-21T16:54Z | PC | passed | docs/evidence/2026-09-21-readiness.json (readiness:validate OK) | ready=true, blockers=0, ownership enforcement_active/paid_ready → matches | none |
| Scalvya / live Stripe | production (live Stripe) | 4 post-G H refund | 2026-09-05T16:11Z | PC | passed | docs/evidence/2026-09-05-rehearsal-record.json (row H, re_3UBD6L…) | refund after G, entitlement unchanged → matches | none |
| Scalvya / 176a7c6 | production (live UI) | 5 test subscription cancel | 2026-09-21 | PC | passed | owner attestation (Stripe cancel_at_period_end) | cancel_at_period_end, no renewal → matches | none |
| Scalvya / 176a7c6 | production (live UI) | 6 data-rights drill (export/delete/re-login) | 2026-09-21T17:01Z | PC | passed | export_version 2 + deletion receipt completed + re-login rejected (ids redacted) | export packet, receipt completed, no data after delete → matches | none |
| Scalvya / repo | local validator | 7 real H recorded + rehearsal:validate | 2026-09-21 | PC | passed | docs/evidence/2026-09-05-rehearsal-record.json (rehearsal:validate OK) | time-monotone complete A–H → matches | none |

## Status roll-up (one status per step; missing evidence = NOT RUN)

| Step | Status |
|---|---|
| 1 Deploy SHA parity | **SUPERSEDED** — executable-tree parity only (b6414f2); exact-SHA parity moves to v24 steps 3–4 |
| 2 Migration 038-040 probe | **DONE 2026-09-21** — `docs/evidence/2026-09-21-migration-038-040-probe.json` |
| 3 Authenticated readiness | **DONE 2026-09-21T16:54Z** — `docs/evidence/2026-09-21-readiness.json` (readiness:validate OK) |
| 4 Ordered post-G H refund | **DONE 2026-09-05T16:11Z** — `docs/evidence/2026-09-05-rehearsal-record.json` (row H) |
| 5 Cancel test subscription | **DONE 2026-09-21** (owner-attested: cancel_at_period_end, no renewal) |
| 6 Data-rights drill | **DONE 2026-09-21** (export ✅ / delete receipt completed ✅ / re-login rejected ✅) |
| 7 Real H + re-validate | **DONE 2026-09-21** — `docs/evidence/2026-09-05-rehearsal-record.json` (rehearsal:validate OK) |

**This checklist does not declare GO.** It records production results only. The
verdict is computed from the manifest at an exact SHA; see `docs/LAUNCH_STATE.md`.
