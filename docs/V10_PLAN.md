<!-- Recovered from the planning session of 2026-07-25 (claude-fable-5).
     Kept in-repo so the v10 execution plan survives session restarts. -->

# Scalvya v10 — Pre-Launch Product Elevation (SC-V10-00 → 08)

## Context

`Scalvya_Prelaunch_Elevation_Claude_Code_Prompts_v10.docx` contains 18 prompts for two apps; **only the 9 Scalvya prompts (SC-V10-00..08) apply to this repo** (MW-V10-* are for Mellowa, a different repo — excluded per the pack's own rule "ne izvajaj Scalvye in Mellowe v istem git runu").

Goal of v10: turn the code-complete v9 RC (merged at `4b6d55d`, 355 tests green) into an **evidence-backed paid-launch candidate**. It deliberately targets exactly the items GO_NO_GO_V9 deferred: golden eval fixtures, real DOCX/ZIP export, lifecycle-email rewrite, cohort dashboard UI, and owner money-rehearsal evidence.

**Execution model (user-confirmed):** create branch `v10` off `main`, execute prompts in order, **one prompt = one vertical slice = one commit**, SC-V10-08 is the final freeze gate, then merge `v10 → main`. User will swap the model to Opus before execution begins.

## Global rules (apply to every prompt — from the pack's product contract)

- Baseline: confirm HEAD vs `4b6d55d9…`; if something is already implemented, verify evidence and fix only the gap.
- Never mutate live Stripe/Supabase/Vercel/Resend/DNS/cron — produce **owner-run checklists** instead; owner records anonymized evidence.
- Preserve contract invariants: name Scalvya; promise "Turn one offer into a launch-ready campaign" (launch-ready ≠ published/approved/compliant/guaranteed); journey Brand Profile → Campaign Brief → Create → Review → Library → Export/Handoff; exactly 5 creation paths; Social plans-not-publishes; SEO = ideation only; free plan = account/brand/brief, 3-day Stripe trial starts only at paid generation; assets always tied to campaign + brief snapshot + prompt/schema version + provenance; canonical statuses Draft / Needs review / Ready to export / Published (user-declared); never invent proof/testimonials/metrics.
- Evidence language everywhere: *tested locally / configured / verified in CI / rehearsed live / observed over time* — never "production-ready" from mocks.
- Additive migrations only, feature flags + rollback for behavior changes. No destructive git.
- Per-slice verification: `npm run lint`, `npm test`, `npm run build:app`, `npm run check:app-fresh`, relevant Playwright (`e2e/`), `git diff --check`, full-diff review for PII/secrets/stale bundles. Honest pass/fail/skipped reporting.

## Verified current state (from exploration — grounds each slice)

| Area | Reality |
|---|---|
| Go/No-Go | `docs/GO_NO_GO_V9.md`: GO-to-merge, NO-GO for cohort expansion; P1 = live money rehearsal + release-check required on main; P2 deferred = golden fixtures, DOCX/ZIP, lifecycle rewrite, cohort UI |
| CI | `ci.yml` (lint+test+build+fresh-check on PR/main); `e2e.yml` Playwright exists but cron/dispatch-only; **no release-check CI job** |
| Billing | `payments.js` trial logic + `hadTrialOrActiveSubscription`; `webhooks.js` has `stripe_events` idempotency ledger + `isStaleSubscriptionEvent` out-of-order guard; `customers.js planFor()` single truth |
| Email | `lib/lifecycle-email.js`: Resend + outbox (`email_events`, `claim_email_outbox` RPC, backoff, dead-letter, replay); ~9 templates; cron `GET /api/cron/email-outbox`; **no suppression/unsubscribe** |
| Export | `campaigns.js`: handoff-1 manifest, sha256 fingerprint, staleness, formats **md/json/html only** — no DOCX/PDF/ZIP |
| Analytics | `lib/analytics.js` CANONICAL_EVENTS + CLIENT_EVENTS allowlist + VALUE_FUNNEL + sanitizeProperties; `/api/admin/scorecard` computes cohorts; Admin.jsx renders scorecard+readiness minimally |
| Quality | `quality-checks.js` scorers + claim provenance; `prompt-registry.js` (v2, immutable); `golden-eval.test.js` exists but thin (1 mock brief per schema) |
| Nav | Sidebar has Home/Brand/Campaigns/Create/Library/Account + 5-studio "Create" section; `/app/create` hub duplicates it; legacy `/flow` + `/kits/:id` is a parallel launch-kit model; redirects exist for old studio routes |
| CampaignWorkspace | `CampaignWorkspace.jsx` fetches **full campaign list** then `.find()` client-side even though `GET /campaigns/:id` + `api.campaign(id)` exist unused; Assets tab = compact rows, only "Create assets" + Library link |
| Library | `AssetLibrary.jsx` AssetDrawer has preview/edit/rewrite/versions/diff/restore, optimistic concurrency via `expected_updated_at` (no ETag); `library.js` pagination is **in-memory over .limit(500)** per table |
| Landing | Two-ICP paths (own campaign / for clients); pricing server-fetched with IO-gated event; Reveal respects reduced-motion; ghost CTA + eyebrow contrast on blue gradient is the flagged weakness |

## Slices

### SC-V10-00 — Production truth, required CI, owner money rehearsal
- Create `docs/GO_NO_GO_V10.md` pinned to exact SHA + migration set + bundle hash + commands; evidence fields blank = NO-GO by construction.
- CI: keep non-secret `ci.yml` on PR/main; **add a production-env `release-check` job** that runs `release-check.js` and is explicit/skips-honestly when secrets absent; document required branch checks (owner sets them in GitHub — we can't).
- Strengthen webhook tests: delayed/duplicate/out-of-order Stripe events against the `stripe_events` ledger + `isStaleSubscriptionEvent`; entitlement resolver stays `planFor()` only.
- Write owner-only live rehearsal worksheet (extend `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`): charge→cancel→reactivate→refund with evidence-ID/timestamp/expected-state/rollback columns.
- Audit `/api/admin/readiness` (admin.js:119): presence booleans + bounded counts only — verify no emails/content leak.
- Verify account export/delete + cancel failure paths cannot report false success.

### SC-V10-01 — One recommended path / progressive disclosure IA
- Make **Campaigns the default work hub**: one primary "Create campaign" action; move Playbooks/Templates behind a secondary "Start from…" chooser in `Campaigns.jsx`.
- Fold "Full launch campaign" (`/flow`) into the campaign-creation contract — no forked legacy state; keep `/flow` + `/kits/:id` URLs as explicit redirects with data still reachable (read-access preserved).
- Resolve duplicate Create: sidebar STUDIO_NAV + `/app/create` hub → global Create becomes a campaign-context resolver (asks for campaign first); demote the always-visible five-studio list.
- Job labels only: Set up brand / Create campaign / Complete brief / Create assets / Review / Handoff — no "launch kit"/"schema"/internal terms.
- Route-level skeletons + recoverable errors; Home next-action (Dashboard `homePlan`) must agree with campaign Overview's `campaignNextAction`.
- Analytics: `primary_path_started/completed` with bounded stage+entitlement only (register in CANONICAL_EVENTS/CLIENT_EVENTS). No synthetic onboarding-completion flags — derive from canonical data.
- Tests: redirect/content-contract tests + Playwright journey signup-return → Brand → Campaign → Brief → first Create; 320px + keyboard order.

### SC-V10-02 — Campaign-native asset workspace + scalable retrieval
- Switch `CampaignWorkspace.jsx` (and `Create.jsx`) from list+find to the existing `GET /api/campaigns/:id` — extend that endpoint to return cockpit-summary fields + version/ETag; never fetch the full list for a detail route.
- **Reuse the existing AssetDrawer** (extract from `AssetLibrary.jsx` into a shared component) inside the campaign Assets tab: preview, provenance, brief snapshot, status, findings, manual edit, AI rewrite, versions/diff/restore, export — no duplicate drawer/diff/status code.
- URL keeps campaign context + deep-linkable asset ID; Back restores tab/filter/scroll.
- Fix `library.js` pagination: server-side filters + bounded pagination (replace in-memory slice over .limit(500)); list rows never carry full bodies.
- Asset rows: title, channel/type, status, last edit, brief version/staleness, highest unresolved blocker; state-dependent primary action.
- Surface stale-brief/review blockers (reuse `brief-impact` + review data) without mutating canonical status. No bulk Ready/Published, no share links.
- Tests: ownership/404/409/pagination API tests, 100-campaign fixture, Library regression, campaign-Assets Playwright, deep link + stale conflict + keyboard drawer + 320px.

### SC-V10-03 — Golden campaign quality eval + output improvement loop
- Expand `golden-eval` into a real harness: **12–20 versioned synthetic brief fixtures** (services, ecommerce, events, regulated claims, missing proof, multi-audience, no-date) with prohibited-inventions lists, required cross-channel facts, expected structure, human rubric.
- Baseline current outputs first (record prompt/model/schema versions) — then improve prompts **one channel at a time**, bumping versions in `prompt-registry.js` (append-only, never silent).
- Deterministic checks (always in CI): CTA/offer/audience cross-channel consistency, missing-proof markers, fabricated-fact bans, required fields, duplicate angles, channel length, SEO research disclosure — build on `quality-checks.js` + `claimProvenanceWarnings`.
- Optional bounded live/semantic eval harness gated on explicit provider credentials + cost/time ceilings; reported separately or as skipped — never the sole gate.
- Expose prompt/schema version + "why this needs review" in asset provenance (drawer already shows provenance line).
- Regression tests proving a fabricated claim and a duplicate angle get blocked/flagged.

### SC-V10-04 — Premium handoff export: real DOCX, PDF, ZIP
- Add real `.docx` (likely the `docx` npm lib) generated from the **same canonical `handoffManifest()`** — title page, summary, approved brief version/date, deliverable plan, asset sections, findings/evidence refs, responsibilities, export fingerprint. No second content composer.
- Clean PDF from the same manifest (serverless-safe choice — measure Vercel memory/time limits first; pick lib accordingly, e.g. pdfkit over headless-Chrome).
- ZIP (`manifest.json`, README/responsibilities, text formats, DOCX/PDF when within limits) with streaming/bounded temp memory; clear over-limit failure + narrower-export option.
- Pre-generation preview of exact included/excluded items+formats; old md/json/html formats stay behind explicit labels for rollback.
- Record manifest version/format/fingerprint/asset-count-band/timestamp; stale packets downloadable but visibly stale (existing fingerprint logic).
- Security: server recomputes auth+blockers; expiring signed downloads; no internal IDs/prompts/secrets in customer documents; filenames sanitized/deterministic/collision-safe.
- Tests: filename/manifest-mapping units; integration for binary signatures, ownership, limits, stale fingerprints; visually inspect representative DOCX/PDF fixtures (DOCX opens without repair warning).

### SC-V10-05 — ICP conversion, landing accessibility, first-screen proof
- Re-lead `Landing.jsx` hero for **freelance marketers / boutique agencies** (strongest willingness-to-pay); solo founders become secondary below proof/mechanism — keep both ICP paths eligible, same product/entitlements.
- Add compact above-fold product proof: Brief → connected asset set → review findings → handoff packet, illustrative labeled data only.
- Fix contrast: eyebrow, hero disclosure, ghost CTA, footer → WCAG AA on the blue gradient; Reveal content visible without JS/animation (component already degrades — verify) and reduced motion respected.
- LCP: defer decorative effects (Meteors/sky), reduce empty vertical space; reserve layout for async pricing with honest retry/fallback (never blank, never hardcoded amounts).
- Every CTA states its next step (create free workspace / prepare brief / trial starts at generation). No invented savings/testimonials/logos/badges.
- Analytics: landing variant, CTA surface, use-case, pricing view only.
- Tests: content-contract, a11y, public Playwright at 320/375/768/1440, Lighthouse/manual perf evidence.

### SC-V10-06 — Activation, lifecycle email, recovery
- Write the canonical **lifecycle state→event→template→dedupe→retry map** doc; implement only messages with real triggers (build on the existing outbox/dead-letter in `lifecycle-email.js` — do not reinvent).
- Fill template gaps vs the map: welcome→Brand Profile; activation nudge only when next canonical setup step missing (server-derived, no content); trial emails with exact plan/amount/charge date/renewal/cancel route; payment failure split retrying vs past_due/read-only vs recovered; cancellation with access-end date + export availability.
- Add **suppression/unsubscribe for optional marketing** (currently missing — transactional stays exempt but distinguished + tested).
- Preview fixtures + admin delivery-status/retry/dead-letter visibility (extend `/api/admin/email-outbox`).
- Dedupe: duplicate/replayed webhook → at most one message per policy (extend `email_events` dedupe-key tests). Logs store template key/state/provider ID/category only.
- Owner-run Resend rehearsal checklist. Template snapshot tests.

### SC-V10-07 — Paid-value beta, cohort dashboard, pruning
- Build the deferred **admin cohort view** in `Admin.jsx` on top of `/api/admin/scorecard` patterns: funnel workspace→Brand→brief approved→first asset→3 channel types→finding resolved→Ready→handoff preview→export→reopened→renewal; every metric shows numerator/denominator/cohort window/no-data state/decision; tiny-cohort suppression.
- Capped 15–25 user beta plan doc + consented interview scripts + weekly continue/iterate/pause/stop memo template; invite gate stops at cap.
- One-variable experiment scaffolding (recommended path / Overview next action / handoff preview timing) — pick one, don't wire all three.
- Pruning review doc for low-use routes (candidates: `/flow`, `/kits`, `/weekly-plan`, duplicate Create) — hide/deprecate only after data-access checks.
- AI cost per activated/exporting/retained account from ledger data. Fixed enums/bands, server timestamps, dedupe keys.
- Tests: admin authorization, dedupe, cohort math, suppression, export/delete privacy on synthetic fixtures.

### SC-V10-08 — Frozen paid-launch release candidate (no new features)
- Freeze RC SHA; write `docs/GO_NO_GO_V10.md` final form: exact evidence, owners, severity, deadlines, rollback triggers, signed verdict. GO impossible with open money/data/legal P0, blank owner evidence, skipped auth journey, or unverified export.
- Migration/rollback dry runs on anonymized fixtures (no production backfill).
- Failure-injection sweep: provider timeout/malformed output, DB partial failure, duplicate webhook, stale edit, expired session, export limit, unauthorized admin/evidence access.
- Full journey trace desktop/mobile/keyboard: anonymous → free workspace → Brand → campaign → approved brief → trial → 3 connected assets → review → handoff → account/billing/cancel/export/delete.
- Remove only proven-superseded UI/code; record deferrals visibly. Pin migration/prompt/schema/manifest/build versions; validate redaction after final schema changes.
- Full check + Playwright public/auth/mobile + release-check + owner evidence review. Honest verdict.

**Then:** merge `v10 → main` (as user requested), after SC-V10-08's automated gates are green. Live-evidence fields may legitimately remain owner-pending — the merge ships the RC; GO for public launch stays gated on owner evidence, per the pack.

## Verification (per slice + overall)

Each slice: `cd backend && npm run lint && npm test && npm run build:app && npm run check:app-fresh`, targeted Playwright specs (`npx playwright test`), `git diff --check`, manual diff review. New tests accompany every slice. Final: full suite + e2e workflow + release-check at the frozen RC SHA.

## Out of scope

- All MW-V10-* prompts (Mellowa repo).
- Any live Stripe/Supabase/Vercel/Resend/DNS/cron mutation (owner-run only).
- Price/limit/trial/refund-policy changes; share links; client accounts; brand redesign.

