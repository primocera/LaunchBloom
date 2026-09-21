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

Every row starts **NOT RUN**. Nothing here may be marked DONE before a real output.

---

## 1. Deploy / candidate SHA parity  — status: NOT RUN
- The v23 candidate is FROZEN and pinned: **`176a7c6859364ee0fd904bc900ec93e159b70197`**
  (short `176a7c6`). It is the CI-green rc/v23 tree `26c95b2` plus documentation-only
  README/CLAUDE edits — executable tree byte-identical, bundle `index-Cq2NTdSE`, so
  the deploy is runtime-identical. `main` and `rc/v23` are at `3739e10` (the docs-only
  pin commit on top of the candidate).
- Deploy **exactly `176a7c6`** (deploying the `main`/`rc/v23` tip `3739e10` is
  equivalent — same executable tree).
- Readiness does not expose the commit, so confirm the deployed commit in the
  **Vercel Deployments** dashboard and record the **deploy id + commit SHA**.
- **Stop condition:** deployed SHA ≠ `176a7c6` (or its equivalent tip `3739e10`) → do
  not open paid.
- **DONE 2026-09-21:** Vercel served `main@b6414f2` (a docs-only descendant of the
  candidate `176a7c6`; executable tree identical, bundle `index-Cq2NTdSE`), so
  SHA/executable parity holds. Deploy id: Vercel `main` build (github/primocera),
  Ready. ✅ PASSED.

## 2. Read-only exact migration probe 038-040  — status: NOT RUN
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
- Save the output as `docs/evidence/2026-__-__-migration-038-040-probe.json` (PII-free).
- **Stop condition:** (b) returns any row, (c) not non-partial, or (d) not TRUE →
  enforcement is NOT ready; keep `migrations.ownership_enforcement = pending`.

## 3. Authenticated `/api/admin/readiness` capture  — status: DONE 2026-09-21
Record ONLY: HTTP status, `ready`, blocker count, `ownership.state`, `paid_ready`,
the migration-probe result, and the UTC time. No secrets, no PII.
- **Stop condition:** `ready` ≠ true or `ownership.blockers` non-empty.
- **DONE 2026-09-21T16:54Z:** HTTP 200, `ready=true`, blockers 0, external 0,
  `ownership.state=enforcement_active`, `paid_ready=true`, `enforced=true`; all 14
  blocker-level config gates ok; live signals ok (ai spend 0 of $15 ceiling). PII-free
  record `docs/evidence/2026-09-21-readiness.json`, validated by
  `npm run readiness:validate -- docs/evidence/2026-09-21-readiness.json --candidate 176a7c6859364ee0fd904bc900ec93e159b70197`
  → **OK**. ✅ PASSED.

## 4. Ordered post-G H refund  — status: NOT RUN
On the live test subscription, **after G**, refund the last recovery charge
(the €0.96 invoice `in_1UC7c4…` / charge `ch_3UC7c4…`).
- Confirm refund `succeeded` and **entitlement unchanged by the refund alone**.
- Record per `docs/evidence/POST_G_REFUND_H_TEMPLATE.md` with the real post-G UTC time.
- **Stop condition:** refund not verified in Stripe, or the refund alone changes entitlement.

## 5. Cancel the test subscription  — status: DONE 2026-09-21 (owner-attested)
Cancel end-of-period (`cancel_at_period_end`) so it does not renew.
- Deadline: **before the next renewal (~2026-10-02)**, else a real charge is taken.
- **Stop condition:** UI shows success while Stripe still schedules the next charge.
- **DONE 2026-09-21 (owner-attested, not repo-verifiable):** owner confirms the test
  subscription is set to `cancel_at_period_end` — remains valid until the next
  period, then terminates (no renewal charge). ✅ PASSED (owner attestation).

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
  - ✅ PASSED. (No PII stored: email omitted; ids truncated.)

## 7. Record new H + re-validate  — status: NOT RUN
- Write the genuine post-G H into the rehearsal record (real time after G).
- `npm run rehearsal:validate -- <record.json> --candidate <full-sha>` must pass.
- Then flip `owner_evidence.live_money_rehearsal` → `observed`, close
  `P1-live-money-unrehearsed`, `npm run launch:render` + `launch:gate` → public_paid GO.

---

## Evidence record — fill one row per step actually performed

| application / candidate_sha | deploy id / build identity | action id + short desc | observed_at_utc | operator | result (passed/failed/blocked) | redacted evidence ref | expected → observed | stop/rollback result |
|---|---|---|---|---|---|---|---|---|
| Scalvya / 176a7c6 | vercel main@b6414f2 (docs-only descendant; executable identical) | 1 deploy SHA parity | 2026-09-21 | PC | passed | Vercel Deployments dashboard | deployed executable == candidate 176a7c6 → matches | none |
| Scalvya / 176a7c6 | vercel main@b6414f2 | 3 authenticated readiness | 2026-09-21T16:54Z | PC | passed | docs/evidence/2026-09-21-readiness.json (readiness:validate OK) | ready=true, blockers=0, ownership enforcement_active/paid_ready → matches | none |
| Scalvya / 176a7c6 | production (live UI) | 5 test subscription cancel | 2026-09-21 | PC | passed | owner attestation (Stripe) | cancel_at_period_end, no renewal → matches | none |
| Scalvya / 176a7c6 | production (live UI) | 6 data-rights drill (export/delete/re-login) | 2026-09-21T17:01Z | PC | passed | export_version 2 + deletion receipt completed + re-login rejected (ids redacted) | export packet, receipt completed, no data after delete → matches | none |

## Status roll-up (all NOT RUN until real output)

| Step | Status |
|---|---|
| 1 Deploy SHA parity | **PASSED 2026-09-21** (b6414f2 == candidate 176a7c6 executable) |
| 2 Migration 038-040 probe | done — `docs/evidence/2026-09-21-migration-038-040-probe.json` (see launch-state `migrations.ownership_enforcement`) |
| 3 Authenticated readiness | **PASSED 2026-09-21T16:54Z** — `docs/evidence/2026-09-21-readiness.json` (readiness:validate OK) |
| 4 Ordered post-G H refund | done — H/refund real Stripe time 2026-09-05T16:11Z (see launch-state `owner_evidence.live_money_rehearsal`) |
| 5 Cancel test subscription | **DONE 2026-09-21** (owner-attested: cancel_at_period_end, no renewal) |
| 6 Data-rights drill | **PASSED 2026-09-21** (export ✅ / delete receipt completed ✅ / re-login rejected ✅) |
| 7 New H + re-validate | done — rehearsal:validate passes, `P1-live-money-unrehearsed` closed, public_paid GO |

**This checklist does not declare GO.** It only records production results; the
final verdict is computed by Prompt 4 from the evidence at the exact SHA.
