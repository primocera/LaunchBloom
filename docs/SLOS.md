# SLOs & alert thresholds (v18 X02)

Service-level objectives for a small paid SaaS, sized to a capped beta — not a
9-nines target. This is the single place the objectives and their alert
thresholds are written down; the incident *response* lives in
[RUNBOOK_INCIDENTS.md](./RUNBOOK_INCIDENTS.md).

**Principles**
- Every objective is measurable from a signal that already exists (`GET /health`,
  `GET /api/admin/readiness`, `ops-signal` log lines, `analytics_events`) —
  no new content logging, no PII in any alert.
- Thresholds that page live in code, not prose:
  `backend/lib/readiness-thresholds.js` (`THRESHOLDS` + `classifyReadiness`).
  This doc explains and links them; it does not restate numbers that could drift.
- Every request and job carries a **`trace_id`** (W3C `traceparent` /
  `x-trace-id` honoured inbound, else minted — see `backend/lib/logger.js`) plus
  a per-hop **`req_id`**, so an SLO breach is traceable end-to-end without
  reading user content.

## Correlation ids

| Id | Scope | Source | In responses |
|----|-------|--------|--------------|
| `trace_id` | one logical operation across edge → API → job | inbound `traceparent`/`x-trace-id`, else minted | `X-Trace-Id` header, every `request` log line |
| `req_id` | one HTTP request (a span) | inbound `x-request-id`, else minted | `X-Request-Id` header, error bodies |

## Service-level objectives

Latency SLOs are **targets to watch**, measured from the `ms` field on the
`request` log line (p50/p95 over the rolling window). They are review triggers,
not auto-paging rules — the paging signals are the availability/health rows
below, which are already classified in code.

| # | Journey (SLI) | Objective (SLO) | Signal | Breach → |
|---|---------------|-----------------|--------|----------|
| 1 | Core service up (`GET /health`) | 99.5% non-error over 30d | `/health` `status: ok` | page (see runbook: service up) |
| 2 | Auth (`/api/auth/*`) | p95 < 800 ms; < 1% 5xx | `request` log `ms`/`status` for auth paths | review latency; page on sustained 5xx |
| 3 | AI generation (`/api/ai/generate-*`) | p95 < 25 s; invalid-output/timeout < 2% of attempts | `request` log + `generation_failed` analytics | review prompt/provider; check `ai_spend` signal |
| 4 | Persistence (draft/campaign save) | p95 < 1.2 s; < 0.5% 5xx | `request` log for save routes | review DB latency / RLS denials |
| 5 | Export / handoff | p95 < 3 s; 0 corrupt deliverables | export-integrity test + `request` log | re-run export; page on corrupt output |
| 6 | Checkout create | < 1% non-consented failures; **0** duplicate subscriptions | `checkout_failed` analytics; `ops-signal` | fails closed by design; investigate `PLAN_UNAVAILABLE` |
| 7 | Webhook processing | failures clear on Stripe retry within 24h | `readiness.live.webhook_failures_24h` | **paging signal — in code** (warn ≥1 / stop ≥5) |
| 8 | Entitlement refresh | never grants access on lookup failure | `plan_unavailable` log; `verify-plan` `active:null` | runbook: entitlement unavailable |
| 9 | Account deletion | completes; no stuck deletions | `account_deleted` event; deletion receipt | page on stuck deletion (high severity) |

## Paging thresholds (authoritative in code)

These are classified by `classifyReadiness()` into `ok` / `warn` / `stop`;
`operational_status` on `GET /api/admin/readiness` is the overall roll-up.
`warn` = look now; `stop` = intervene with the subsystem kill switch.

| Signal | warn | stop | Owner action |
|--------|------|------|--------------|
| `webhook_failures_24h` | ≥ 1 | ≥ 5 | runbook: billing/webhooks; then `npm run reconcile:webhooks` |
| `outbox_backlog` | ≥ 25 | ≥ 100 | runbook: email; hold sends, drain outbox |
| `reservation_leakage` | ≥ 1 | ≥ 10 | runbook: AI spend; inspect usage reserve/settle |
| `ai_spend` (vs ceiling) | ≥ 80% | ≥ 100% | `AI_GENERATION_PAUSED=1` |

> Numbers above mirror `backend/lib/readiness-thresholds.js`. If they disagree,
> the code is authoritative — re-tune there, then update this row.

## Alerting

- **Where:** `operational_status` on the readiness endpoint is the poll target;
  `ops-signal` and `request` log lines are the log-drain source.
- **Owner:** the release owner (single-owner beta). Escalation paths are in the
  incidents runbook per subsystem.
- **Noise control:** thresholds are conservative-but-not-twitchy for a 15–25
  user cohort; `warn` is a look, only `stop` implies intervention.
- **Content policy:** alerts carry opaque ids (`trace_id`, `req_id`, Stripe
  object ids, reason codes) only — never email, campaign/asset text or payloads.

## What is deliberately NOT here

- No third-party APM/tracing vendor — trace ids are propagated and logged, but
  a collector is out of scope until traffic justifies it.
- No synthetic uptime SLA promised to customers; these are internal operating
  targets, not a contractual SLA.
