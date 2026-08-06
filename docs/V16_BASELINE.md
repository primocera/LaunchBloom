# V16 (Beta + Paid Readiness → 9.5) — implementation baseline

**This is an implementation contract, not a release verdict.** The canonical
GO/NO-GO source remains `docs/launch/launch-state.json` (rendered to
`docs/LAUNCH_STATE.md`). Nothing here changes a verdict, a candidate SHA, a
threshold, pricing, limits, trial length, product position or a status enum.

## Frozen baseline

- Remote/default branch verified HEAD at pack start: `d114f0bbd838b4e944140bc904bcbd563ba7e578` — matches the audited HEAD in `Scalvya_95_Beta_Paid_Readiness_Claude_Code_Prompts_v16`. **No drift.**
- Canonical product candidate referenced by `launch-state.json`: `b234dad77a72910d4c94555eb0a2c410c2a0a1a9` (state `frozen`, verdicts: capped beta **GO**, public paid **CONDITIONAL GO**). Unchanged by this pack.
- Work branch: `v16`. One bounded commit per prompt.

### Evidence-invalidation rule

Any change under `backend/routes/payments.js`, `backend/routes/webhooks.js`,
`backend/routes/customers.js`, `backend/lib/subscription-state.js`,
`backend/lib/beta-scorecard.js`, `backend/lib/cohort.js`,
`backend/routes/admin.js`, `backend/lib/handoff-docs.js` or
`backend/routes/campaigns.js` handoff paths **invalidates any carried-forward
authenticated-E2E / live-money evidence** and requires a fresh candidate before
those owner gates can be re-cited. Documentation-only changes (SC-95-00,
SC-95-02 doc portions, XAPP-95-02) do **not** mint a new product candidate.

## Owner-gated — not reopened by this pack

Per `docs/PROMPT_PACK_SCOPE_NOTE.md`, none of these can be closed by a prompt and
this pack does **not** re-scaffold tooling for them:

- Authenticated E2E matrix (`test:e2e:auth`) — owner-run, accepted risk.
- Live-money rehearsal (8 transitions A–H) — owner-run, accepted risk.
- Router advisory GHSA-qwww-vcr4-c8h2 — accepted, `review_by: 2026-11-04`.

## Verified findings — status, evidence, acceptance test

Order of implementation: P0 money/data isolation → P1 release truth → P1
repeat-value evidence → P1 UX friction → optional polish.

| ID | Sev | Status | Evidence (file:line) | Customer impact | Acceptance test |
|----|-----|--------|----------------------|-----------------|-----------------|
| **SC-95-01** | P0 | **OPEN** | `backend/routes/payments.js:132-144` returns a stored `stripe_customer_id` on `!c.deleted` without proving `metadata.source`/`app_user_id`; `payments.js:203-212` adopts the concurrent race-winner on `!winner.deleted` without proving ownership. `recoverScalvyaCustomer` (55-66) and create (163-167) are already owned. | A foreign/Mellowa or wrong-user Stripe Customer stored in the DB row (or winning a link race) is adopted → wrong-customer charge / cross-app adoption. | Table-driven tests: stored & race-winner customer that is owned / foreign-source / wrong-user / missing-metadata / deleted / retrieve-failure / resource_missing. Assert **zero** Customer & Checkout Session creation on mismatch; owned reused exactly once; `resource_missing` → safe recovery; multiple owned → reconciliation-required. |
| **SC-95-02** | P1 | **OPEN** | `CLAUDE.md:40` says "no Supabase Auth / stateless HMAC" but `backend/lib/auth.js:1-16` uses Supabase Auth + HttpOnly `sb_access`/`sb_refresh` cookies + stable UUID. `README.md:151` says "nine-transition" vs canonical **8 (A–H)**; `README.md:150` lists hero-contrast as accepted/below-AA though `launch-state` blocker `P1-hero-contrast-below-aa` is **closed**; `README.md:144` "13/13" vs 14 checks; README declares public-paid open in prose. README/CLAUDE.md are **not** in the active-document allowlist (`launch-state.json` `active_documents`), so the scanner (`backend/lib/launch-state.js:269-344`) never catches them. | A future coding agent regresses the real auth model or makes a launch decision from stale README text. | `launch:verify` (or `active-doc-integrity` / `content-contract`) fails on fixtures containing the retired HMAC/no-Supabase model, a "nine-transition" claim, a resolved-blocker-as-open claim, or a README public-paid verdict contradicting launch-state. Generated docs remain byte-stable after `launch:render`. |
| **SC-95-03** | P1 | **OPEN** | Three surfaces: `GET /api/admin/scorecard` (`admin.js:304-395`), `/api/admin/cohort` (211-255), `/api/admin/beta-scorecard` (404-432). `beta-scorecard.js:74` milestone `second_campaign_created` has `canonical:null` → reported **unavailable** (237-247) though a live 25% gate exists (91-92). Admin.jsx renders only the old scorecard + cohort (92-95); beta-scorecard has **no UI**. No `second_campaign_created`/`campaign_created`-as-repeat event in `analytics.js` registry. | Owner cannot see whether users return for a second campaign — the central paid-value signal is unmeasured; three funnels can disagree. | Server-authoritative `second_campaign_created` fires once per workspace/user on a real 2nd distinct non-test campaign; retry/clone cannot inflate it. One canonical scorecard result feeds Admin + export; each metric exposes numerator/denominator/eligibility/maturity/state/action; cohorts <5 suppressed; simulated analytics outage → `unavailable`, not zero. |
| **SC-95-04** | P1 | **PARTIAL** | One manifest already drives all formats: `handoffManifest()` (`campaigns.js:822-862`), `outline()` (`handoff-docs.js:159-217`), `FORMATS` docx/pdf/zip (421-425), preview advertises md/json/html/docx/pdf/zip (`campaigns.js:901`). Feedback moment exists (`routes/feedback.js`, categories `job_done`/`manual_work`/`price_view`, notes excluded from analytics). Gaps: preflight/acknowledgement completeness, operator checklist derived from manifest, and **safe handoff-feedback aggregates are not surfaced in the canonical Admin scorecard**. | "Reduced rework" cannot be evidenced; export may under-disclose unresolved items. | Preview and every selected file agree on assets/status/provenance/approval/evidence/blockers/responsibilities (parity table); long/duplicate-title campaigns produce valid docx/pdf/zip; Admin shows `job_done`/`manual_work`/`price_view` counts+denominators with **no notes**; a heavy-editing/nothing-usable signal blocks reduced-rework claims. |
| **SC-95-05** | P1 | **OPEN** | Activation logic strong (`app-src/lib/next-actions.js`, `campaign-next-action.js`, `backend/lib/activation.js`); cohort maturity/capacity in `cohort-control.js`. **No code generator** produces a weekly decision record — only the manual `docs/BETA_PLAN_V10.md` template. | Owner cannot mechanically decide continue/interview/iterate/pause/stop from mature cohort data. | One weekly decision record generated from the canonical scorecard with cohort dates, invited/activated/mature counts, each gate, no-data/immature/below/pass states mechanically distinct, largest drop, one bounded action. Predeclared hypotheses dated before the cohort; no tuning after data. |
| **XAPP-95-01** (Scalvya side) | P1→**P0** | **PARTIAL** | Cross-app isolation groundwork exists (`cross-app-isolation` tests, `recoverScalvyaCustomer`, webhook `scalvya:'1'` discriminator `payments.js:374`). Depends on SC-95-01. **Security review of SC-95-01 found the same unverified `customers.stripe_customer_id` trusted at three more sites:** `account.js` billing-portal (`~117-142`, read→portal into a possibly-foreign customer) and account-delete (`~194-215`, **cancels** foreign subscriptions — a cross-tenant *mutation*); webhook filters `isOurSubscription`/`isOurCharge`/checkout-completed (`webhooks.js:44-91,219-241,288-292`) accept on metadata-key *presence*, not `source==='launchbloom'` — the route that can taint the DB link. | Foreign object crosses an ownership boundary at Portal/delete/webhook. | Every Stripe object/source path (incl. Portal, delete, every webhook family) has an exact ownership rule + positive test + ≥1 foreign negative test asserting zero side effects; sanitized matrix from tested constants. |
| **XAPP-95-02** (Scalvya side) | P1 | **DOC** | Re-score against a non-compensating rubric; separate capped-beta vs public-paid readiness; do not average, do not award for owner-gated-but-unrun. | — | Reproducible score from evidence at exact SHA; any cap/blocker visible before the total; 9.5 only when non-compensating gates + mature value all pass. |

## Rejected as scope creep (not built)

Publishing/scheduling integrations, client accounts, public share links, more
generators, SEO data providers, a third scorecard, marketing/vanity dashboards,
re-implementing E2E/live-money/router tooling, changing thresholds after data.
