# XAPP-01/02/03 — v19 verification (Scalvya side)

Candidate: `24d350c03c3100c9c2691c93ececf7eeb2a74a79` (v19). This pack targets **two
repositories**; only **Scalvya** (primocera/LaunchBloom) is in scope here. The
**primocera/Mellowa** side of every XAPP prompt is **out of scope in this
environment** and is neither executed nor claimed — full cross-app sign-off
requires both repositories to pass their own matrix independently.

## XAPP-01 — symmetric cross-app Stripe isolation (Scalvya side): SATISFIED

Verified already implemented and test-backed; v19 added no new isolation gap and
its LB-01 safe hardening strengthens it:

- App discriminator + stable-user ownership documented in `docs/XAPP_ISOLATION_MATRIX.md`
  / `_V16.md`; ownership decided by exact stamp (`source=launchbloom` / `scalvya=1`)
  or a trusted verified parent — **same email / same-looking UUID / shared account /
  configured price are never sufficient**.
- Negative matrix: `backend/tests/cross-app-isolation.test.js`, `webhook-isolation.test.js`
  (14/14, incl. the new v19 customer-gate cases), `xapp-account-isolation.test.js`,
  `billing-idempotent-customer.test.js`.
- The pull reconciler reuses the **exact** webhook predicate (`isOurSubscription`) and
  mirror projection — proven in `webhook-reconcile.test.js`.
- Logs carry opaque IDs + categorical reasons only (`foreign_event_ignored`).
- **Pinned to this candidate** by `docs/launch/launch-state.json` (drift `24d350c`).

## XAPP-02 — security / privacy / a11y / resilience sweep (Scalvya side): SATISFIED

- Security/privacy controls mapped in `docs/THREAT_MODEL.md`; auth/session, webhook
  signature+raw body, admin/cron auth, RLS/service-role boundary, secret redaction,
  account export/delete registry (`backend/lib/workspace-data.js`), and **browser
  storage governance** (extended in v19 to cover sessionStorage — `storage-inventory.test.js`).
- Accessibility: axe on public routes **re-run at 24d350c — 5/5, zero serious/critical**;
  keyboard-only first-value via `e2e/authenticated/keyboard.spec.js`.
- Content contract rejects retired brand names + unsupported readiness claims.
- Resilience: `failure-injection.test.js`, `error-states.test.js`, `webhook-ordering.test.js`,
  `request-guard.test.js`, `reconcile-entitlements.test.js` — no false downgrade, duplicate
  charge, lost work, cross-user data, false success or raw error leakage.
- v19 resilience additions: readiness roll-up now **fails to `degraded` on unmeasured
  data** (never silently `ok`); the reconciler apply loop is **bounded per run**.
- **Residual (owner-deferred, not a launch blocker):** a dedicated IDOR negative-id
  **fuzz suite** across all `/api/*` object routes is self-flagged in `THREAT_MODEL.md`
  as a hardening candidate. Per-route ownership is enforced and tested; the systematic
  fuzz pass was **not added** in v19 by explicit owner decision (minimise new code
  before launch). Tracked for a later hardening pass.

## XAPP-03 — bounded beta operating system (Scalvya side): SATISFIED

- Cohort setup, thresholds and the fail-closed weekly decision engine are implemented
  and predeclared (`docs/BETA_COHORT_PLAN_V17.md`, `docs/BETA_WEEKLY_DECISION_V16.md`,
  `backend/lib/weekly-decision.js`, `beta-scorecard.js`): reviewed ≥60%, gen-fail ≤5%,
  completion ≥40%, second-campaign ≥25% @14d, zero billing incidents, qualitative
  reduced-rework — with numerators/denominators, maturity, watermark and small-cell
  suppression, and **expand blocked** when any metric is unavailable/immature/breached.

### Inherently cross-repo / owner-only (cannot be completed from this repo)

- Mellowa's own isolation matrix and its foreign-event filtering (primocera/Mellowa).
- Live-money A–H rehearsal and production-readiness on the deployed candidate (owner-run).
- Provider data-retention confirmations (owner/legal).
- Actual isolated Supabase/analytics/Stripe environment provisioning (deploy config).
