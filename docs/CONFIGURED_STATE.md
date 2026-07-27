# Configured state — what is ALREADY set up in production

> **SUPERSEDED as release truth — still authoritative as a setup record.** Use
> this file to avoid asking the owner to configure something they configured
> versions ago. Do **not** use it as current release state: that lives in
> `docs/LAUNCH_STATE.md`, generated from `docs/launch/launch-state.json`. The
> migration table below contradicts `docs/GO_NO_GO_V10.md` for the same date
> (2026-07-26), so migration applied-state is recorded as **unknown** in the
> canonical record until `CHECK_APPLIED.sql` is re-run against production.

**Read this before writing any owner checklist.** Every slice that needs
external configuration must check here first and ask only for what is genuinely
missing. Re-asking the owner to configure something they set up versions ago is
a defect in our process, not a gap in theirs.

Presence only — never a secret value. Source: `GET /api/admin/readiness` on the
deployed app, which reports presence booleans and bounded counts.

## Last verified: 2026-07-26 — `mode: production`, `ready: true`, `blockers: 0`

| Area | State | What the check proves |
|---|---|---|
| **Email delivery** | ✅ configured | `email:delivery` — Resend API key **and** sender are set. Domain/SPF/DKIM were completed by the owner in an earlier version. **Do not ask for Resend setup again.** |
| **Stripe prices** | ✅ configured | `stripe:price_allowlist` — all live prices set (6 ids: starter/pro/studio × monthly/yearly) |
| **Legal + launch config** | ✅ configured | `launch:config` — all requirements met, including the fail-closed `BRAND_LEGAL_*` identity that blocks launch when unset |
| **Cron secret** | ✅ configured | `cron:secret` — set, for the email-outbox worker |
| **Rule versions** | ✅ pinned | consistency `v8.1`, dependencies `v8.1` |
| **Supabase** | ✅ reachable | the endpoint itself queries live tables to produce the counts below |

### Live operational signals at time of check

| Signal | Value |
|---|---|
| Email outbox backlog | 0 |
| Webhook failures (24h) | 0 |
| AI spend (24h) | $0 |
| AI spend ceiling | not set (`AI_SPEND_DAILY_CEILING_USD`) |

A backlog of 0 with 0 webhook failures is a healthy idle system, not proof of
throughput — it has not been under load.

## Migrations — the one thing this check does NOT prove

`release-check` reports migrations `028`–`033` as **"present"**, meaning present
in the deployed source tree. It does **not** connect to the database and verify
they were applied. Migrations are owner-applied; nothing runs them
automatically.

| Migration | On disk | Applied to DB |
|---|---|---|
| `001`–`033` | ✅ present | ✅ **applied** — verified 2026-07-26 via CHECK_APPLIED.sql |
| `034_finding_audit.sql` | ✅ (v9) | ❌ **NOT applied** as of 2026-07-26 |
| `035_handoff_packet.sql` | ✅ (v9) | ❌ **NOT applied** as of 2026-07-26 — handoff staleness inert in production since v9 |
| `036_email_suppressions.sql` | ✅ (v10 SC-06) | ❌ **NOT applied** as of 2026-07-26 |

If `036` has not been applied, unsubscribe writes fail and marketing email
fails closed — nothing is sent. That is the safe direction, but it is not the
intended one.

## Still outstanding — genuinely, not as a formality

These are the only external items not evidenced above:

1. **Live money rehearsal** — charge → cancel → recover → refund with recorded
   evidence (`docs/RUNBOOK_TRANSACTION_REHEARSAL.md`). The readiness endpoint
   says so itself: automated readiness is not a paid-launch GO.
2. **`AI_SPEND_DAILY_CEILING_USD`** — unset, so there is no daily spend cap.
   Worth setting before real users generate.
3. **Resend behaviour checks after `036`** — that an unsubscribe suppresses
   optional email while billing email still arrives. This is verifying new
   behaviour, not re-doing setup.

## A note on local `.env`

The local `backend/.env` is **not evidence about production** — it is missing
most keys by design (local runs against mock AI with no Stripe, Resend or
Supabase service role). Never infer production state from it, and never ask the
owner to "set up" something because a local variable is unset. That mistake is
what prompted this file.

## Refreshing this

Sign in on the deployed app with an `ADMIN_EMAILS` account and open
`/api/admin/readiness`. The response carries no secret values, no customer
content and no payment data.
