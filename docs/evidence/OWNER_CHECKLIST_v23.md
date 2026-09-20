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
- Freeze the v23 candidate (Prompt 4) and deploy **exactly that full SHA**.
- Readiness does not expose the commit, so confirm the deployed commit in the
  **Vercel Deployments** dashboard and record the **deploy id + commit SHA**.
- **Stop condition:** deployed SHA ≠ certified candidate SHA → do not open paid.

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

## 3. Authenticated `/api/admin/readiness` capture  — status: NOT RUN
Record ONLY: HTTP status, `ready`, blocker count, `ownership.state`, `paid_ready`,
the migration-probe result, and the UTC time. No secrets, no PII.
- **Stop condition:** `ready` ≠ true or `ownership.blockers` non-empty.

## 4. Ordered post-G H refund  — status: NOT RUN
On the live test subscription, **after G**, refund the last recovery charge
(the €0.96 invoice `in_1UC7c4…` / charge `ch_3UC7c4…`).
- Confirm refund `succeeded` and **entitlement unchanged by the refund alone**.
- Record per `docs/evidence/POST_G_REFUND_H_TEMPLATE.md` with the real post-G UTC time.
- **Stop condition:** refund not verified in Stripe, or the refund alone changes entitlement.

## 5. Cancel the test subscription  — status: NOT RUN
Cancel end-of-period (`cancel_at_period_end`) so it does not renew.
- Deadline: **before the next renewal (~2026-10-02)**, else a real charge is taken.
- **Stop condition:** UI shows success while Stripe still schedules the next charge.

## 6. Data-rights drill (export + delete)  — status: NOT RUN
- Run a live **account export**; then a **test account delete** on a dedicated test
  account; confirm a deletion receipt and that a **re-export returns no user data**.
- **Stop condition:** cancellation or delete fails but the UI shows a false success.

## 7. Record new H + re-validate  — status: NOT RUN
- Write the genuine post-G H into the rehearsal record (real time after G).
- `npm run rehearsal:validate -- <record.json> --candidate <full-sha>` must pass.
- Then flip `owner_evidence.live_money_rehearsal` → `observed`, close
  `P1-live-money-unrehearsed`, `npm run launch:render` + `launch:gate` → public_paid GO.

---

## Evidence record — fill one row per step actually performed

| application / candidate_sha | deploy id / build identity | action id + short desc | observed_at_utc | operator | result (passed/failed/blocked) | redacted evidence ref | expected → observed | stop/rollback result |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Status roll-up (all NOT RUN until real output)

| Step | Status |
|---|---|
| 1 Deploy SHA parity | NOT RUN |
| 2 Migration 038-040 probe | NOT RUN |
| 3 Authenticated readiness | NOT RUN |
| 4 Ordered post-G H refund | NOT RUN |
| 5 Cancel test subscription | NOT RUN |
| 6 Data-rights drill | NOT RUN |
| 7 New H + re-validate | NOT RUN |

**This checklist does not declare GO.** It only records production results; the
final verdict is computed by Prompt 4 from the evidence at the exact SHA.
