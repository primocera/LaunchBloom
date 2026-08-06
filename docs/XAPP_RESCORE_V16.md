# Evidence-based 9.5 re-score — Scalvya (XAPP-95-02)

**This is a re-score snapshot, not the canonical verdict.** The canonical GO/NO-GO
source remains `docs/launch/launch-state.json` (`npm run launch:gate`). This
document scores the **observed** state at the v16 working branch and states the
shortest honest path to 9.5. It does not change any verdict, threshold, candidate
or status enum.

`9.5` is a proposed **internal** confidence standard — not an industry benchmark
and not customer-facing proof.

## Non-compensating rubric (no averaging away a failure)

- A P0 safety / privacy / data / billing / cross-app failure caps the relevant
  readiness **below 8**, regardless of other points.
- A required **owner gate that is `not_run`** caps **public-paid readiness below 9**.
- Product, capped-beta and public-paid are scored **separately**; a strong
  product score is not beta or paid readiness.
- Score the **observed** state. Where evidence is absent, score the observed
  state, not the intended one.

## Automated evidence at this branch

Branch `v16` · HEAD `ad783c7` (working, **not a frozen candidate**).

| Gate | Command | Result |
|---|---|---|
| Unit/contract/safety suite | `npm test` | **914 pass / 0 fail** |
| Lint | `npm run lint` | clean |
| Frontend bundle freshness | `npm run check:app-fresh` | app/ matches app-src/ |
| Launch-state integrity | `npm run launch:verify` | OK |
| Candidate drift | `npm run launch:drift` | **DRIFTED** — v16 diverges from frozen candidate `b234dad` |
| Authenticated E2E (`test:e2e:auth`) | owner-run | **NOT RUN** (owner-gated) |
| Live-money rehearsal (8 transitions A–H) | owner-run | **NOT RUN** (owner-gated) |

**Evidence invalidation:** v16 changed `payments.js`, `webhooks.js`, `account.js`,
`beta-scorecard.js`, `admin.js`, `campaigns.js`. Any authenticated-E2E or
live-money evidence pinned to `b234dad` is **stale** and may not be carried
forward. A new candidate must be frozen and the owner gates re-run against it.

## What v16 changed (all green, all tested)

- **SC-95-01 / XAPP-95-01 (P0, closed):** every Stripe-customer acceptance path —
  checkout DB link, search recovery, created response, race winner, **billing
  portal, account deletion, and the checkout webhook** — now verifies exact
  Scalvya ownership. No foreign/wrong-user customer can be adopted, given a
  portal, or have its subscriptions cancelled.
- **SC-95-02:** agent docs corrected to real Supabase-Auth model + release prose;
  guarded by `agentDocumentProblems` in `launch:verify`.
- **SC-95-03:** `second_campaign_created` instrumented and derived (repeat value
  no longer unavailable, retry-proof); one canonical scorecard; analytics outage
  reports `unavailable`, never zero.
- **SC-95-04:** post-handoff feedback aggregated as neutral reduced-rework
  evidence (categories only); the reduced-rework claim is blocked until evidence
  supports it.
- **SC-95-05:** a generated weekly decision record with maturity rules and one
  bounded decision/action.

## Scores (observed, non-compensating)

| Dimension | Observed | Max after code prompts | Owner-gated max | Verdict | Remaining blocker | Next action |
|---|---|---|---|---|---|---|
| **Product capability** | **9.0** | 9.5 | 9.5 | strong | none open (P0 closed) | — |
| **Capped-beta readiness** | **8.5** | 9.5 | 9.5 | **GO once re-frozen + deployed** | v16 is not a frozen candidate; carried-forward auth-journey evidence is stale after drift; needs deploy (LAUNCH-01) | Freeze v16 as a candidate, run `test:e2e:auth` once against a throwaway non-prod Supabase, deploy the bounded cohort with monitoring/rollback |
| **Public-paid readiness** | **7.0 (capped)** | 8.9 (owner gates cap < 9) | 9.5 | **CONDITIONAL GO** (unchanged) | authenticated E2E `not_run`; live-money rehearsal `not_run`; router advisory accepted (`review_by 2026-11-04`); **mature value evidence absent** (no cohort yet) | Owner runs the live-money lifecycle A–H on the frozen candidate; run authenticated E2E at candidate; gather a mature cohort meeting the pre-declared hypotheses |

**Why public-paid is capped at 7.0:** two required owner gates are `not_run`
(cap < 9), and mature customer-value evidence does not exist yet — no beta cohort
has run, so `reviewed_asset ≥60%`, `campaign-ready ≥40%`, `second_campaign ≥25%`,
`generation_failure ≤5%`, zero billing incidents and qualitative
reduced-rework confirmation are all **pending**, not passed. Code cannot raise
this number; only owner-run evidence and a mature cohort can.

## Mature-value hypotheses (predeclared, not benchmarks)

reviewed asset ≥ 60% of activated · generation failure ≤ 5% · campaign-ready ≥ 40%
· second campaign ≥ 25% · zero billing-severity incidents · interviews confirm
reduced campaign rework. Denominators shown in the scorecard; cells under five
are suppressed. Not tuned after seeing data.

## Decision-engine validation (no substitution for owner gates)

The verdict/decision engines are exercised by fixtures, not asserted by prose:
`launch-state.test.js` / `active-doc-integrity.test.js` (pass/fail/not_run/
stale/accepted), `weekly-decision.test.js` (pass/below/pending/insufficient/
no_data/unavailable + Continue/Interview/Iterate/Pause/Stop),
`scorecard-repeat-campaign.test.js` and `scorecard-handoff-feedback.test.js`
(cohort-immature, outage, staff-exclusion). Blocked owner gates are recorded as
`not_run` — never substituted by a mock.

## Bottom line

- **Capped beta: GO** once v16 is frozen and deployed (bounded cohort, monitoring,
  rollback). The three owner-gated items do not block the beta.
- **Public paid: not 9.5, and cannot be by code.** It needs the owner-run
  live-money lifecycle and authenticated E2E at the frozen candidate, plus a
  mature cohort meeting the predeclared hypotheses. Until then the honest
  public-paid score is **7.0 / CONDITIONAL GO**.
