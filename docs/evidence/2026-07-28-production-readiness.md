# Evidence — production configuration verified

**Items:** `checks.release_config`, `owner_evidence.ai_spend_ceiling`
**Closes:** `P1-no-spend-ceiling`
**Date (UTC):** 2026-07-28
**Verified by:** owner
**Method:** `GET /api/admin/readiness` on the live production deployment,
authenticated as an admin. The endpoint runs the same `collect()` as
`npm run release:check`, inside the production environment, and returns
presence booleans only — never a secret value.

## Result

```
mode: production   ready: true   blockers: 0   external: 0
```

All 13 checks `ok`:

| Check | Detail |
|---|---|
| `migration:028`–`033` | present |
| `rules:consistency_version` | `v8.1` |
| `rules:dependencies_version` | `v8.1` |
| `launch:config` | all launch-config requirements met |
| `stripe:price_allowlist` | **all live prices set** |
| `cron:secret` | set |
| `email:delivery` | Resend key + sender configured |
| `ai:spend_ceiling` | daily ceiling set to $15 |

Live signals: `outbox_backlog` 0, `webhook_failures_24h` 0,
`ai_spend_24h_usd` 0 against a `$15` ceiling, `spend_over_ceiling` false.

`mode: production` means `NODE_ENV=production` **and** a live Stripe key, so
the configuration gates were enforced as blockers rather than warnings. This is
the first run in this repository's history that answered the production config
question with production values.

## About the $15 ceiling — read this before relying on it

`AI_SPEND_DAILY_CEILING_USD` is an **alarm, not a brake**. It is read only by
this endpoint to compute `spend_over_ceiling`. Nothing stops generating when it
is crossed.

The brake is `MAX_AI_CALLS_PER_DAY = 300`, a single global pool enforced
atomically by `reserve_ai_spend` (`backend/lib/spend-guard.js`), which throws
503 `DAILY_CAP`. At roughly $0.044 per `claude-haiku-4-5` call that permits
about $13/day, so the $15 alarm sits just above what the brake can physically
cost. The two agree.

Per-account cost is bounded by `backend/lib/plan-limits.js`, which is the real
economic control: starter 30 actions ≈ $1.32 against $12.99, pro 120 ≈ $5.28
against $24.99, studio 400 ≈ $17.60 against $59.00 — 70–90% gross margin.

Kill switch: `AI_GENERATION_PAUSED=1` stops new reservations.

## Limits of this evidence

- **A snapshot.** It describes the deployment as configured on 2026-07-28.
  Changing a Vercel variable makes it stale without any commit.
- **Presence, not correctness.** `stripe:price_allowlist` confirms live price
  ids are set; it does not confirm each one charges the intended amount. That
  is `npm run verify-prices` with the live key, which has not been run.
- **Configuration, not behaviour.** Zero webhook failures in 24h is a healthy
  signal, not proof that billing recovery works. That is the live money
  rehearsal, still outstanding for public launch.
