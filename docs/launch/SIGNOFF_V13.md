# Scalvya v13 — launch sign-off packet

- **Prompt:** SC-FINAL (v13 master pack)
- **Release manager:** Claude Code (orchestrated), executed by Opus 4.8
- **Candidate:** `879e1bb7a813cacd945a156f7f9fbaaa6e4e7b08` (branch `v13`, environment class: production)
- **Baseline:** `a11afdacfee8261db260946dbe37668e68a6037e` (prior candidate)
- **Date:** 2026-08-03
- **Source of truth:** `docs/launch/launch-state.json` → rendered `docs/LAUNCH_STATE.md`. This packet summarises that machine truth; it does not override it.

---

## 1. Executive verdict

**Machine gate (verbatim, `npm run launch:gate` at candidate 879e1bb):**

```
  capped_beta: NO-GO
    - required check release_config is not_run

  public_paid: NO-GO
    - open P1: P1-router-rsc-csrf-advisory
    - required check release_config is not_run
```

**Capped beta: NO-GO — one owner action from GO.** Every automated gate that can run
without production secrets is green at 879e1bb (lint 0/0, 763 unit tests, build, fresh
bundle, 52 public browser journeys, export integrity, launch integrity, hero
contrast); migrations are verified applied (no SQL changed in v13); the owner has
walked the signed-in product on live Stripe. The **only** capped-beta blocker is that
SC-P0-04 materially changed the production config-gate code, so the 2026-07-28
`/api/admin/readiness` observation no longer describes this candidate and cannot be
carried forward — `release_config` is honestly `not_run`. Deploying 879e1bb and
re-observing readiness against it flips capped beta to GO. P1 items do not bear on
capped beta.

**Public paid: NO-GO — do not open public signup.** In addition to the readiness
re-observation, public paid carries an open high router advisory (RSC-only, not
reachable, but neither accepted nor closed) and the two long-standing accepted risks a
full GO can never absorb: the authenticated browser matrix (skipped) and the
nine-transition live-money rehearsal (not_run).

This verdict is not softened to meet a date. It is the gate's, computed — not declared.

---

## 2. Evidence table

| Item | Status | At commit | Environment | Artifact |
|---|---|---|---|---|
| ESLint | passed_locally | 879e1bb | local | 0 errors / 0 warnings |
| Unit / contract / safety | passed_locally | 879e1bb | local | 763 pass / 0 fail |
| Production build | passed_locally | 879e1bb | local | bundle index-B75XUgt7 |
| Stale-bundle check | passed_locally | 879e1bb | local | app/ matches app-src/ |
| Public browser E2E | passed_locally | 879e1bb | local | 52 pass (2 parallel-load flakes green in isolation) |
| Export integrity | passed_locally | 879e1bb | local | 15 pass / 0 fail |
| Launch-state integrity | passed_locally | 879e1bb | local | verify OK, declared==computed |
| Hero contrast / responsive | passed_locally | 879e1bb | local | 8 pass, AA 4.70:1 |
| **Production config gate** | **not_run** | — | — | SC-P0-04 changed config-gate code; must re-observe in prod |
| Authenticated browser matrix | skipped (accepted, public_paid) | — | — | needs non-prod Supabase (RUNBOOK_AUTH_E2E.md) |
| Migrations applied | observed | 2026-07-28 | production | evidence/2026-07-28-migrations-applied.md (SQL unchanged in v13) |
| Owner signed-in walkthrough | observed | 2026-07-28 | production | evidence/2026-07-28-owner-production-walkthrough.md |
| Resend suppression | live_rehearsed | 2026-07-28 | production | evidence/2026-07-28-resend-suppression.md |
| AI spend ceiling | observed | 2026-07-28 | production | $15/day, evidence/2026-07-28-production-readiness.md |
| Live-money rehearsal | not_run (accepted, public_paid) | — | — | RUNBOOK_TRANSACTION_REHEARSAL.md |
| Code drift vs candidate | none | 879e1bb..HEAD | local | docs-only |
| Prod dependency audit | 2 high (router, unreachable) | 879e1bb | local | GHSA-qwww-vcr4-c8h2 |

---

## 3. Open risks

| Severity | Item | Status | Owner | Due | Mitigation | Rollback / disable |
|---|---|---|---|---|---|---|
| P1 (beta-blocking) | Production config gate not re-observed against changed code | not_run | owner | before beta | Deploy 879e1bb, run `/api/admin/readiness`, confirm mode=production/ready=true/0 blockers | Gate fails closed by design; if config incomplete, paid checkout is blocked automatically |
| P1 | Router advisory GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF) | open | owner | before public paid | Not reachable — app ships no RSC/SSR; declarative router only | n/a (no code path); revisit on React 19 / Vite 7 upgrade to react-router 8 |
| P1 | Authenticated browser matrix never run | accepted (public_paid) | owner | before public paid | Owner walked happy path in prod; small supervised cohort absorbs failure paths | `AI_GENERATION_PAUSED=1`, immediate Stripe refunds |
| P1 | Live-money nine-transition rehearsal | accepted (public_paid) | owner | before public paid | Live trial/cancel run; entitlement reconciled from Stripe; 0 webhook failures/24h | Refund + `SIGNUP_PAUSED=1` |
| — | Live paid-account plan + renewal date (v13 fail-closed/overlap fixes) | post-deploy check | owner | at deploy | New in v13; confirm a real paid account shows plan + renewal | Revert 271e31c/ebcfe5c and rebuild if wrong |

Accepted is neither closed nor passed. Each accepted risk keeps its real status and
stays visible; an acceptance only records that a launch was allowed to proceed over it.

---

## 4. Owner-only checklist (PREPARE — do not execute without owner approval)

Claude Code has performed none of the following; each requires the owner and live
credentials.

### 4.1 Production readiness re-observation (clears the capped-beta blocker)
1. Deploy candidate `879e1bb` to the production environment.
2. `GET /api/admin/readiness` against the deployed candidate.
3. **Expected:** `mode=production`, `ready=true`, `blockers=0`, `external=0`; `launch:config` ok (now including terms/privacy URLs and currency-catalog completeness — new in v13), `stripe:price_allowlist` all live prices set, `ai:spend_ceiling` $15.
4. **Abort if:** any blocker, `mode != production`, or a missing legal/price/currency item — the fail-closed gate is telling you paid checkout would be unsafe.
5. Record the result in `docs/launch/launch-state.json` `checks[release_config]` (status `passed_locally`/observed, `observed_at_sha` = 879e1bb) and re-run `npm run launch:gate`.

### 4.2 Router advisory decision (public-paid condition)
- Either accept GHSA-qwww-vcr4-c8h2 with a named rationale + revisit date in blocker
  `P1-router-rsc-csrf-advisory` (reachability: none — no RSC), **or** schedule the
  react-router 8 upgrade (needs React 19 / Vite 7 / Node ≥22.22).

### 4.3 Minimal Stripe live-mode rehearsal (public-paid condition — owner-only, never Claude)
- Small live charge → portal access → cancel at period end → reactivate (where
  supported) → refund → confirm webhook delivery and entitlement reconciliation.
- Attach anonymized evidence per `docs/RUNBOOK_TRANSACTION_REHEARSAL.md` (no PII, no
  Stripe identifiers). Row 7 (late `payment_failed` after recovery) is the transition
  this exists for.

### 4.4 Authenticated E2E (public-paid condition)
- Point `npm run test:e2e:auth` at a disposable non-production Supabase project that
  has opted in via `E2E_MARKER.sql`; record the result against 879e1bb. See
  `docs/RUNBOOK_AUTH_E2E.md`.

### 4.5 Deploy / rollback
- **Deploy:** promote 879e1bb; verify the bundle `index-B75XUgt7` is served.
- **Rollback (code):** v13 commits are additive; revert the offending commit, rebuild
  `app/`. **Data:** no migration in v13 — nothing to roll back.
- **Kill switches (reversible env):** `AI_GENERATION_PAUSED=1`, `SIGNUP_PAUSED=1`,
  `BETA_INVITE_CAP` (fails closed on missing/invalid). See `docs/RUNBOOK_INCIDENTS.md`.

### 4.6 Capped-beta cohort parameters (owner to set)
- Cohort size behind `BETA_INVITE_CAP`; contactable invited accounts only.
- Monitoring window: owner watches `/api/admin/readiness` (`outbox_backlog`,
  `webhook_failures_24h`, `ai_spend_24h`) daily.
- Support SLA + stop-loss: any billing-severity incident or generation-failure spike →
  `AI_GENERATION_PAUSED=1` / `SIGNUP_PAUSED=1` and pause invites.
- Daily review owner: Primoz Cerar.

---

## 5. First 72-hour monitoring plan and decision date

- **Hours 0–24:** confirm `/api/admin/readiness` stays `ready=true`, 0 webhook
  failures, AI spend under the $15 ceiling. Verify the first real paid account shows
  its plan and a real renewal date (v13 fix). Watch for any `PLAN_UNAVAILABLE` /
  `CHECKOUT_UNAVAILABLE` / `STRIPE_PRICE_UNMAPPED` log codes (SC-P0-01/03) and any
  `BILLING_ANOMALY` overlap signal (SC-P0-02).
- **Hours 24–72:** track the SC-P1-12 value loop for the invited cohort — brand
  profile → brief → first generation → first reviewed asset → first export → campaign
  ready. Log generation failure rate by studio and any error-state recovery events.
- **Decision date:** 2026-08-10 (7 days after capped-beta start). Expand / iterate /
  stop per the pre-registered `docs/BETA_SCORECARD_V13.md` thresholds (marked
  hypotheses, not market facts). Do not open public paid until §4.2–4.4 are cleared.

---

## 6. Standard final report (7-point)

1. **Files changed:** `docs/launch/SIGNOFF_V13.md` (new). No product code touched.
2. **Behavior before → after:** no runtime change; this packet records the sign-off
   posture at candidate 879e1bb.
3. **Tests run:** `npm run launch:verify` PASS (integrity OK, declared==computed);
   `npm run launch:drift` PASS (docs-only, no code drift); `npm run launch:gate`
   → NO-GO / NO-GO (exit 1, the truthful current-head verdict). No product tests
   re-run here — SC-P1-09 recorded them green at 879e1bb.
4. **Commands not run / BLOCKED:** production `/api/admin/readiness` (owner, no prod
   secrets); `npm run test:e2e:auth` (needs non-prod Supabase); live Stripe rehearsal
   (owner-only); `verify-prices` (live key). All named in §4.
5. **Residual risks:** §3 — production readiness re-observation outstanding (beta
   blocker), open unreachable router advisory, and two accepted public-paid risks.
6. **Documentation/evidence updated:** this packet; `docs/launch/launch-state.json`
   and `docs/LAUNCH_STATE.md` cut to candidate 879e1bb in SC-P1-09.
7. **Next step:** owner executes §4.1 to clear capped beta. No deploy, live payment,
   production mutation, key rotation, or machine-verdict override was performed. No
   fabricated evidence.

**No-claim statement:** no live money moved, no production migration or account
mutation occurred, no keys were rotated, and no evidence was fabricated. The verdict
above is the machine gate's; the owner owns the launch decision.
