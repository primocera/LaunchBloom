# Final launch authorization packet (XAPP-02)

One decision record separating **code quality**, **release evidence** and
**market value**. It authorizes nothing on its own: a green build is not proof
people will pay, and a beta verdict does not authorize unrestricted public paid.
No deploy, migration or live mutation was performed to produce this.

> **Scope.** This packet was produced in the Scalvya (`primocera/LaunchBloom`)
> repository only. The **Mellowa** rows are **NOT AUDITED IN THIS SESSION** — that
> is a separate repository (`primocera/Mellowa`) and the pack forbids combining
> repos in one session. Its verdicts below are carried from the pack's stated
> posture, not re-derived here, and must be confirmed in that repo (MW-01…MW-06,
> then the Mellowa half of XAPP-01/02) before any Mellowa launch decision.

## 1. HEAD and frozen candidate

| App | Repository | Frozen candidate | Rollback SHA | Branch |
|---|---|---|---|---|
| Scalvya | `primocera/LaunchBloom` | `b234dad` (v15) | `81993ff` | `v15` |
| Mellowa | `primocera/Mellowa` | **not audited here** — v13 manifest superseded, v14 beta lacked a machine-validated manifest at last audit | — | — |

## 2. Automated gate — Scalvya at `b234dad` (counts + evidence)

| Check | Result | Evidence |
|---|---|---|
| Lint | PASS | `eslint backend app-src api` — 0 errors, 0 warnings |
| Unit / contract / safety | PASS | `npm test` — 850 / 850 |
| Build | PASS | `npm run build:app` — bundle `index-B75XUgt7` (unchanged) |
| Stale-bundle | PASS | `npm run check:app-fresh` — app/ matches app-src/ |
| Router reachability | PASS | `npm run check:router` — pure client SPA, no RSC indicators |
| Export integrity | PASS | `npm run test:export` — 15 / 15 |
| Public browser | PASS | `npm run test:e2e` re-run fresh — 50 clean + 2 documented specs passing single-worker in isolation (25/25) |
| Launch integrity | PASS | `npm run launch:verify` — OK; `launch:drift` none |
| Prod dep audit | 2 high (accepted) | `npm audit --omit=dev` — GHSA-qwww-vcr4-c8h2, not reachable, guarded |
| Authenticated matrix | **BLOCKED / NOT RUN** | needs a non-production Supabase project; runner exits non-zero, never a pass |

## 3. Owner / live evidence (Scalvya)

| Evidence | Status | Note |
|---|---|---|
| Migrations applied in production | observed | 001–037 applied = true (2026-07-28); SQL byte-identical through v15 |
| Owner signed-in production walkthrough | observed | happy path on live Stripe; not a substitute for the authenticated matrix |
| Production config gate (`/api/admin/readiness`) | observed_production | ready=true, 0 blockers; re-confirm on deployed `b234dad` |
| Resend suppression after migration 036 | live_rehearsed | proven live 2026-07-28 |
| AI daily spend ceiling | observed | `AI_SPEND_DAILY_CEILING_USD=15` live (alarm, not brake) |
| Eight-transition (A–H) live-money rehearsal | **not_run** | owner-only; validate with `npm run rehearsal:validate` |

## 4. Blockers

- **Open:** none unaccepted.
- **Accepted (public_paid only):** `authenticated-e2e` (matrix skipped), `live-money` (rehearsal not_run), `router-rsc-advisory` (GHSA-qwww-vcr4-c8h2, not reachable, guarded by `check:router`, review_by 2026-11-04).
- **Closed:** migration-truth, billing entitlement+renewal, hero contrast, spend ceiling.

## 5. Verdicts (computed by `launch:gate`, never declared)

| Track | Verdict | Basis |
|---|---|---|
| **Scalvya — capped beta** | **GO** | every beta-required gate green; no unrecorded risk |
| **Scalvya — unrestricted public paid** | **CONDITIONAL GO** | proceeds only over three named accepted risks, never satisfied |
| **Mellowa — capped beta** | *not audited here* (pack posture: capped beta with accepted risk) | confirm in the Mellowa repo |
| **Mellowa — unrestricted public paid** | *not audited here* (pack posture: NO-GO until a new machine-validated candidate + evidence exist) | confirm in the Mellowa repo |

## 6. 72-hour monitoring and rollback triggers (Scalvya capped beta)

Monitor: 5xx + checkout-failure rate · webhook failures/retries + event-order
anomalies · duplicate customer/subscription indicators · unresolved AI
reservations vs spend ceiling · email permanent failures · cross-account/RLS
errors · time-to-first-value + value-loop completion · refund/support complaints
about price, trial or charge date.

Stop / roll back to `81993ff` on: any displayed/charged price or currency
mismatch · duplicate subscription or trial · cross-account data exposure · unsafe
AI output escaping a guard · migration/schema mismatch · webhook backlog that
changes entitlement truth · unexplained material 5xx spike · readiness not
`ready`. Kill switches (reversible env): `AI_GENERATION_PAUSED=1`,
`SIGNUP_PAUSED=1`, `BETA_INVITE_CAP`.

## 7. Four-week value-proof scorecard (Scalvya — no vanity metrics)

Privacy-safe aggregates only; **signup counts are not a success metric**. All
thresholds are **hypotheses until cohort evidence exists** (`docs/BETA_SCORECARD_V13.md`).

| Metric | What it proves | Hypothesis (label as unproven) |
|---|---|---|
| Profile → approved-brief activation | the guided decision actually happens | ≥ 50% of activated workspaces |
| First reviewed asset | a generated draft was actually reviewed | ≥ 40% within week 1 |
| Export / handoff | the paid deliverable is used | ≥ 25% of active workspaces |
| Second campaign started | repeat value, not one-shot curiosity | ≥ 20% |
| Repeated weekly use | habit / retention | ≥ 30% return in week 2 |
| Generation failure rate | reliability of the core value loop | < 3% of generations |
| Refund + cancellation reason categories | why value did/didn't land | categorized, not just counted |

Never use asset content, brief text or customer identifiers as a growth metric.

> **Mellowa value metrics** (sample completion, next-day/next-week return, Adjust
> usage, Undo usage, completed-item preservation, weekly reflection,
> trial-to-paid, 30-day retention, refund/cancellation reasons) belong to the
> Mellowa repo and must **never** use sensitive mood/health/allergy/journal/plan
> content as a growth metric. Not scored here.

## 8. Remaining owner actions, in order (Scalvya)

1. Re-confirm `GET /api/admin/readiness` (ready=true, 0 blockers) on the deployed `b234dad`.
2. Present the LAUNCH-01 plan (candidate `b234dad`, rollback `81993ff`); get explicit approval before any deploy/migration/live mutation.
3. Deploy `b234dad` to production behind `BETA_INVITE_CAP`; keep the 72-hour log.
4. Before *planning* public paid: run the authenticated matrix (`docs/RUNBOOK_AUTH_E2E.md`) and the eight-transition live-money rehearsal (`docs/RUNBOOK_TRANSACTION_REHEARSAL.md`), then re-run `launch:gate`.
5. Gather four-week cohort value evidence before treating any scorecard threshold as met.

## 9. Recommendation

- **Scalvya: CONTINUE CAPPED BETA.** Code and release evidence support a
  supervised, invite-capped beta now. Unrestricted public paid remains
  **CONDITIONAL** — a separate, explicit owner decision gated on the two live
  rehearsals above plus cohort value evidence, not on a green build.
- **Mellowa: cannot recommend from here.** Requires its own audit
  (MW-01…MW-06 + the Mellowa half of XAPP-01/02) in that repository before any
  launch decision.
