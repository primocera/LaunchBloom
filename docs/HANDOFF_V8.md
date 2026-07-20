# HANDOFF — v8 Value & Scale playbook (branch `v8`, 2026-07-20)

For the next agent/owner. What shipped, how it was executed, the rules that held,
and what remains. Companion docs: `docs/V8_PROMPTS.md` (verbatim prompts),
`docs/VALUE_ANALYTICS_V8.md` (funnel/experiments/kill criteria),
`docs/BETA_GO_NO_GO.md` (v8 addendum = the go/no-go scorecard),
`docs/adr/ADR-001-handoff-export-only.md`.

## State

- Branch `v8` off `v7`. **Not pushed, not merged** (matching the v7 workflow — do
  not push/merge without an explicit ask).
- Gate at HEAD (`72f734b`): `npm run lint` 0 errors (54 cosmetic warnings),
  `npm test` **304 passed / 0 failed**, `npm run build:app` clean, `check:app-fresh`
  fresh, Playwright **18/18** (2 tests are cold-start flaky and pass on isolated
  re-run — server env warm-up, not a code defect).
- 11 commits, **one per prompt**, plus the docs-extraction commit (`5aa8da8`).

## Verbatim-execution log (fixes the v7 "not executed verbatim" gap)

Every prompt was run from `docs/V8_PROMPTS.md` (extracted from the docx), not a
summary. One commit per prompt with a per-prompt test gate:

| Prompt | Commit | Core deliverable |
|---|---|---|
| LB-S01 | `3cfc3dd` | Campaign gap map + deliverable plan (mig 028), backfill-as-unplanned |
| LB-S02 | `1033bd5` | Deterministic consistency engine (mig 029), versioned rules, fingerprint reopen |
| LB-S03 | `80dedd3` | Brief-change impact + stale review (mig 030), no silent propagation |
| LB-S04 | `c52b1de` | Review queue + evidence locker (mig 031) + export manifest |
| LB-S05 | `71959a9` | Activation checklist + deterministic package preview |
| LB-S06 | `2508c3a` | Channel playbooks + sanitized workspace templates (mig 032) |
| LB-S07 | `6660d0f` | Export-only review packet (md/print-html), ADR-001 |
| LB-S08 | `47602f1` | Jobs-based pricing comms + pricing-contract tests (prices unchanged) |
| LB-S09 | `5f0030e` | Value funnel + idempotent events (mig 033), beta plan, kill criteria |
| LB-S10 | `72f734b` | release-check + resumable backfill + failure-injection + go/no-go |

## Product contract preserved (verified)

- **Five canonical Create paths** (Website/Email/Social/Ads&Creative/SEO) — every
  new surface (Deliverables, Consistency, BriefImpact, ReviewQueue, PackagePreview,
  Playbooks, Templates) is an in-page panel on Campaigns, never a 6th route.
- **Four statuses** (Draft / Needs review / Ready to export / Published) unchanged.
- **No publish/send/schedule claims.** Handoff is export-only (ADR-001).
- **Single price source** (`plan-catalog.js` → `PLAN_LIMITS`); canonical USD
  $12.99 / $24.99 / $59 unchanged; `pricing-contract.test.js` fails on drift or
  hard-coded prices in `app-src/`.
- **Derived checks consume no AI action** — gap map, consistency, brief-impact,
  review, evidence, package preview, backfill are all free/deterministic.
- **Privacy**: analytics store categorical properties only; `sanitizeProperties`
  + `analytics-privacy.test.js` enforce no prompts/asset text/PII.
- Ownership: every new query filters by workspace; `evidence.js` sanitizes URLs;
  review-packet HTML is escaped + noindexed; foreign-user export → 404 (tested).

## New operator tooling

- `npm run release:check` — frozen-commit readiness (migrations, rule versions,
  config, live Stripe allowlist, cron/email). Presence only, no secrets. Exit 1 on blocker.
- `npm run backfill:consistency` — DRY-RUN by default; `--apply --batch=N --since=<ISO>
  --workspace=<id>`; `BACKFILL_KILL=1` kill switch. Non-destructive, idempotent, no AI action.

## Migrations (additive, NOT auto-run — owner applies)

`028_campaign_deliverables`, `029_consistency_findings`, `030_brief_reviews`,
`031_evidence`, `032_workspace_templates`, `033_analytics_dedupe`. All `create ...
if not exists`, RLS on new tables, safe to run once. **No production mutation was
performed by any prompt.**

## Remaining / external blockers (owner: primoz2.cerar@gmail.com)

Unchanged from v6/v7 plus v8 specifics — full list with acceptance checks in the
`BETA_GO_NO_GO.md` v8 addendum:
1. Live Stripe prices + `sk_live` + webhook secret. 2. Verified domain +
`PUBLIC_URL`/`ALLOWED_ORIGINS`. 3. Resend sending domain. 4. `CRON_SECRET` +
external cron. 5. Legal entity values. 6. One live test-mode
signup→trial→checkout→webhook→generation→cancel→recover journey with recorded evidence.

## Verdict

Automated gates green. **Paid launch must not be marked GO from mocked/local tests**
(LB-S10 non-negotiable). Conditional GO for a **capacity-capped beta (≤ 50–100
accounts)** once the six blockers have owner-recorded live evidence. No P0 code
issues open on `v8`.

## Suggested next steps

- Apply migrations 028–033 in the production project (test mode first).
- Run the one live test-mode revenue journey; record evidence against the scorecard.
- Wire the three LB-S09 beta experiments behind feature flags before opening capacity.
- Calibrate the LB-S09 kill-criteria cutlines with real completion volume.
