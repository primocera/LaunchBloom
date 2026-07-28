# Evidence — migration applied-state verified

**Item:** `owner_evidence.migrations_applied` · closes blocker `P0-migration-truth`
**Date (UTC):** 2026-07-28
**Verified by:** owner
**Environment:** production Supabase project
**Method:** applied `backend/migrations/037_beta_feedback.sql`, then ran
`backend/migrations/CHECK_APPLIED.sql`

## Result

Every row returned `applied = true`, across the full `001`–`037` range —
including `037_beta_feedback`, which checks the table, all five bounded answer
columns and the `beta_feedback_once_idx` unique index.

## What this settles

`docs/GO_NO_GO_V10.md` was right and `docs/CONFIGURED_STATE.md` was wrong:
`034`, `035` and `036` **are** applied. The v11 record held this as `unknown`
rather than picking a side, and the disagreement is now resolved by a read of
the database instead of by a document.

It also confirms independently what the lifecycle-email behaviour already
implied — `036` is applied, which is why Resend mail was arriving at all
(`sendLifecycleEmail` writes `email_events.category`, added by `036`, and
returns `duplicate` without sending if the column is missing).

`CONFIGURED_STATE.md` is already marked superseded; its migration table should
now be read as known-incorrect, not merely stale.

## Limits of this evidence

- **Owner-attested; the query output was not captured into this repository.**
  If you want this to survive an audit, paste the result table below. A claim
  about a database that nobody can re-read is weaker than one that ships with
  its output.
- It describes the production database on 2026-07-28. A later migration makes
  it stale — re-run the check rather than citing this file.
- `CHECK_APPLIED.sql` proves *structure*: tables, columns, indexes and
  functions exist. It does not prove the application uses them correctly. That
  is what the authenticated browser matrix is for, and that is still unrun.

## Query output

```
(paste the CHECK_APPLIED.sql result table here)
```
