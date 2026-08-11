# Final launch authorization — Scalvya (XAPP-V17-02)

> Read/verify/decision only. This is **not** permission to deploy, charge, refund,
> contact users or add features. Scores are internal, evidence-earned on a
> specific SHA — never a marketing claim. Scores do **not** compensate across
> dimensions: product quality can be high while public-paid stays conditional.

**Candidate:** `64e76914e7e0d1637726d5c08b9d07e0dccded21` (v17, branch `v17`) ·
bundle `index-DVEF1GCL.js` + `index-Ck_SQ1wq.css` · canonical GO/NO-GO in
`docs/launch/launch-state.json`.

## Blocker caps applied first

Any open P0 safety/privacy/data/billing/cross-app defect caps the relevant
readiness below 8 and forces NO-GO. **No open P0 at this SHA** — the v17 pass
closed the trial-truth (LB-V17-01), cross-app webhook ownership (LB-V17-02) and
browser-draft privacy (LB-V17-03) gaps, each with tests.

## Scores & verdicts

| Dimension | Score | Verdict | Resting on |
|---|---|---|---|
| Product capability | 9.4 | — | 932 unit tests, 52 public + 45 authenticated E2E, export/router/hero, exact-ownership billing, bounded draft privacy |
| Capped-beta readiness | 9.4 | **GO** | all automated gates green at the exact candidate; no open beta-impact P1; authenticated core journeys observed; monitoring/rollback/kill-switch present; bounded intake (`BETA_INVITE_CAP`, fail-closed) |
| Public-paid readiness | 8.2 | **CONDITIONAL GO** | no unaccepted blocker, but two required conditions ride on accepted risk (below) and mature repeat-value is not yet observed |

Capped-beta and public-paid are **separate decisions** and decided separately.

## Public-paid — the exactly two open conditions (accepted risk, not satisfied)

1. **Live-money full lifecycle** — `not_run`. A real $11.31 charge was taken
   (money moved), but the canonical eight-transition A–H sequence (refund, late
   `payment_failed` step G, out-of-order webhooks) is incomplete. Owner-only;
   validate with `npm run rehearsal:validate`. A runbook/validator is **not**
   evidence.
2. **Production-readiness on the deployed candidate** — carried forward
   (config-gate byte-identical; `git diff b234dad..64e7691` over
   launch-config/release-check/migrations is EMPTY). Owner re-confirms
   `GET /api/admin/readiness` (ready=true, blockers=0) on the deployed `64e7691`
   and records it with `npm run readiness:validate` (LB-V17-05).

Plus the standing **router RSC advisory** `GHSA-qwww-vcr4-c8h2` — accepted, not
reachable (no RSC); revisit at the react-router 8 / React 19 / Vite 7 migration.

## Mature-value evidence — PENDING, never zero, never PASS

The predeclared cohort (`docs/BETA_COHORT_PLAN_V17.md`, LB-V17-07) is **NOT RUN**.
The value moment (`handoff_exported`) and a distinct second campaign must be
observed with mature denominators before public-paid can move past CONDITIONAL.
Under-5, immature, stale and unavailable stay distinct from a zero result.

## 14-day bounded launch plan (capped beta)

- **Days 1–3:** open invites up to `BETA_INVITE_CAP`; named support owner on;
  watch webhook failures, outbox backlog, AI spend vs ceiling (readiness signals).
- **Daily:** review `foreign_event_ignored` / `legacy_price_ownership_fallback`
  ops signals; any billing/privacy P0, cross-app incident or dispute → **stop /
  kill-switch** (`SIGNUP_PAUSED=1`) and roll back.
- **Weekly:** run the scorecard (`docs/BETA_WEEKLY_DECISION_V16.md`); apply the
  predeclared expand / hold / investigate / stop decision — never re-tune
  thresholds after seeing results.
- **No** acquisition expansion beyond the cap, and **no** move toward public-paid,
  until the two owner gates and mature repeat-value evidence exist.

## What would earn a 9.5 (missing observed evidence only — not more features)

1. A complete, observed, redacted live-money A–H lifecycle (incl. refund + late
   failure ordering), validated.
2. A fresh production `readiness` record (ready=true / 0 blockers) on the deployed
   candidate, validated.
3. Mature cohort evidence: reported (not suppressed) `handoff_exported` and a
   distinct second campaign, with a first renewal and no unexplained billing
   incident.

Until all three exist, the honest public-paid score stays **8.2 / CONDITIONAL
GO**. Capped beta is **GO** now.

## Cross-app note

The Scalvya-side Stripe isolation is exact and tested (LB-V17-02 /
`docs/XAPP_ISOLATION_MATRIX.md`). The symmetric **Mellowa** mirror (its own
namespace, foreign-event filter, recovery) runs in `primocera/Mellowa` and is
**not auditable from here**; the full cross-app sign-off requires both repos pass
their own matrix.
