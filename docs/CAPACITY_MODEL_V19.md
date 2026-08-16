# Scalvya capacity model — 10× the capped beta (v19 / LB-05)

> **Honesty rule (LB-05):** *Do not invent capacity.* Where no measured production
> rate exists yet, the assumption is marked **UNAVAILABLE** with the exact
> measurement that would replace it. This is a headroom-and-guardrail model, not a
> load-test result. The single operational truth remains `docs/launch/launch-state.json`.

## 1. Scope

Model the load if the supervised beta cohort grew to **10×** its cap. The cohort is
bounded by `BETA_INVITE_CAP` (`backend/lib/cohort-control.js`); the planning cohort
in `docs/BETA_COHORT_PLAN_V17.md` is 25–50 workspaces, so **10× ≈ 250–500 workspaces**.
This is a growth guardrail, not authorization to open public signup (that is a
separate owner decision — see the launch-state verdicts).

## 2. Known, configured bounds (from code — not assumptions)

| Bound | Value | Source |
|---|---|---|
| Per-plan AI actions | trial 20 (lifetime/3d) · starter 30/mo · pro 120/mo · studio 400/mo | `backend/lib/plan-limits.js` |
| Launch-kit sub-cap | trial 1 · starter 3 · pro 10 · studio 30 | `backend/lib/plan-limits.js` |
| Free plan | 0 full generations until trial starts | `backend/lib/plan-limits.js` |
| Daily AI **call brake** | `MAX_AI_CALLS_PER_DAY` (default 300) — hard stop | `backend/lib/spend-guard.js` |
| Daily AI **spend alarm** | `AI_SPEND_DAILY_CEILING_USD` = 15 in prod (alarm, not brake) | readiness, launch-state |
| Cohort cap | `BETA_INVITE_CAP` (fails closed on a non-numeric value) | `backend/lib/cohort-control.js` |
| Emergency stops | `SIGNUP_PAUSED=1`, `AI_GENERATION_PAUSED=1` | `docs/RUNBOOK_INCIDENTS.md` |

These are the ceilings that make load **bounded by construction**: total AI actions
per billing period ≤ Σ(plan cap × active workspaces), and per-day AI work is hard-capped
by `MAX_AI_CALLS_PER_DAY` regardless of cohort size.

## 3. Worst-case upper bound at 10× (arithmetic on the caps, not measured demand)

Assume the pessimistic mix of **500 studio workspaces** (the largest plan cap):

- **AI actions / month (theoretical max):** 500 × 400 = **200,000**. Real usage will be a
  fraction of the cap, but even the ceiling is throttled per-day by
  `MAX_AI_CALLS_PER_DAY` (default 300/day ≈ 9,000/month) — i.e. the **daily call brake,
  not the cohort, is the binding constraint**, and it is owner-tunable.
- **AI spend / day:** bounded by the $15 alarm + the 300-call brake. At 10× the owner
  should **raise the ceiling deliberately** and keep watching `/api/admin/readiness`
  (`ai_spend_24h_usd` vs `ai_spend_ceiling_usd`); it is an alarm, so raising it is a
  conscious act, not an automatic one.
- **Export memory/size:** bounded per export by the structural limits enforced in
  `backend/tests/handoff-export-integrity.test.js` (DOCX/PDF/ZIP bounds). Exports are
  synchronous and per-request, so concurrency — not per-file size — is the risk (see §4).

## 4. Resource dimensions and headroom

| Dimension | 10× expectation | Constraint / headroom | Status |
|---|---|---|---|
| Anthropic (AI generation) | concurrent generations across the cohort | provider concurrency + `MAX_AI_CALLS_PER_DAY` brake + `AI_SPEND_DAILY_CEILING_USD` alarm; failed generations don't count against limits | **partial** — brakes exist; provider concurrency limit at the account tier is **UNAVAILABLE** |
| Supabase Postgres connections | serverless invocations each open a client | service-role client per invocation; Vercel serverless concurrency × pool | **UNAVAILABLE** — no measured connection-count under load; measure `pg_stat_activity` peak during a seeded burst |
| Stripe webhooks | event volume scales with paid cohort | idempotent, order-safe handlers; read-only pull reconciler (`reconcile:webhooks`, now **bounded-batch** per run) as backstop | **ok** — idempotent + reconciler; volume itself is not a bottleneck |
| Export (DOCX/PDF/ZIP) | concurrent synchronous builds | per-request memory; structural bounds tested | **UNAVAILABLE** — no measured peak concurrent-export memory; measure during a concurrent-export burst |
| Lifecycle email (Resend) | outbox drain rate | durable outbox + dead-letter + cron drain; `outbox_backlog` readiness signal (warn 25 / stop 100) | **ok** — backpressure is observable and thresholded |
| Persistence / read paths | request rate | p95 latency is logged (`ms` field, `backend/lib/logger.js`) but **not yet computed into readiness** | **UNAVAILABLE** — p95 not aggregated; see §5 |

## 5. Measurement gaps to close before expansion (define, don't invent)

These are the LB-05 "mark unavailable assumptions and define the measurement needed"
items. None are invented numbers; each names the exact measurement:

1. **Provider (Anthropic) account concurrency ceiling** — read the account tier limit;
   until then treat `MAX_AI_CALLS_PER_DAY` as the effective brake.
2. **Supabase peak connections under load** — run a seeded burst (non-production) and
   record `pg_stat_activity` peak vs the plan's connection limit.
3. **Peak concurrent-export memory** — drive N concurrent handoff exports and record
   peak RSS; confirm it stays within the serverless function memory.
4. **p95 latency into readiness** — the raw `ms` field is already logged per request; it
   is **not** aggregated into `/api/admin/readiness`. Aggregating it (and the other
   currently-log-only signals: reconciliation diffs, entitlement-unavailable rate,
   generation fallback/failure split, export failures) is deferred product work, **not**
   done in v19 by design (minimise new code before launch). Until aggregated, these
   remain review-from-logs signals per `docs/SLOS.md`, and the readiness roll-up now
   returns **`degraded`** (never silently `ok`) when any surfaced signal is unmeasured.

## 6. Guardrails that make 10× safe to approach incrementally

- Cohort is **cap-gated** and fails closed on misconfiguration (`cohort-control.js`).
- AI work is **double-guarded** (per-day call brake + spend alarm); failed generations
  never consume plan limits.
- Webhook path is **idempotent + reconcilable** (bounded-batch apply).
- Readiness **fails to `degraded`, not `ok`, on missing data** (v19 LB-05 fix).
- Emergency stops (`SIGNUP_PAUSED`, `AI_GENERATION_PAUSED`) are reversible env flags.

## 7. Verdict

The system is **bounded by construction** for a 10× cohort: no single dimension is
unbounded, and the binding AI constraint is the owner-tunable daily brake, not cohort
size. **Three provider/infra numbers (Anthropic concurrency, Supabase peak connections,
peak export memory) and the p95/log-only signal aggregation are UNAVAILABLE** and must be
measured on a seeded burst before expansion — expansion stays gated on the LB-06 / XAPP-03
decision engine, which already blocks `expand` when any required metric is unavailable.
