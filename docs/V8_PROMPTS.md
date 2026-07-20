VALUE & SCALE IMPLEMENTATION PLAYBOOK

LaunchBloom + Mellowa

Iz kakovostnega AI appa v plačljiv sistem, ki rešuje drag in ponavljajoč problem

Izdaja: 19. julij 2026 · ponovno preverjen remote main obeh GitHub repozitorijev · 22 izvedbenih Claude Code promptov · prompti so v angleščini zaradi angleškega UI-ja in kode.

P0: dokaz vrednosti  •  P1: retention  •  P2: scale  •  brez izmišljenih outcome obljub

# Izvršni zaključek

LaunchBloom: V7 je vsebinsko in operativno bistveno bolj konsistenten. Naslednji moat ni več copy generation, ampak campaign control: gap map, cross-channel consistency, brief-change impact, evidence/review queue in profesionalni handoff.

Mellowa: V7 ima močne varnostne in billing meje. Naslednji moat ni daljši dnevni plan, ampak sprotna pomoč: en naslednji korak, atomaren repair preostanka dneva, transparenten spomin in tedenska kontinuiteta.

Odločitev: Ne skalirajta še acquisitiona. Najprej implementirajta P0 value loop, izvedita 25–50-osebni kontrolirani beta cohort in zahtevajta dokaz ponovne uporabe. Če uporabniki ne zaključujejo/ponovno odpirajo kampanj ali ne uporabljajo prilagoditve naslednji dan, ustavita širjenje feature seta in izvedita intervjuje.

## Ponovni evidence-backed audit

App

Kaj je zdaj dokazano

Največja plačljiva vrzel

LaunchBloom

V7 route audit; 5 kanoničnih studiev; brief snapshots; Library provenance/versioning; 242 backend testov in 18 Playwright poti navedeno v repo dokazih.

Ni dokazano, da app na ravni celotne kampanje poišče manjkajoče deliverable, konflikte in zastarele assete ter vodi review do handoffa.

Mellowa

V7 safety na vseh AI poteh; pricing/trial truth; 427 testov in 24 public E2E navedeno v repo scorecardu; free sample in Premium contract sta jasna.

Today je še vedno predvsem plan renderer; ni atomarnega remaining-day repaira, namenskega Now pogleda in dovolj močne tedenske kontinuitete.

## Tržna interpretacija

LaunchBloom tekmuje z marketing platformami, ki že prodajajo brand intelligence, campaign workflows in konsistenco. Zato ‘pet generatorjev v enem’ ni dovolj obrambna pozicija; vrednost mora biti manj reworka, jasnejši review in kampanjski source of truth.

Mellowa tekmuje s plannerji, ki že ponujajo AI task breakdown, replanning, schedule adjustment, timeline in guided planning. Zato mora plačljivost izhajati iz prilagajanja, naslednjega koraka in kontinuitete, ne iz same generacije plana.

V obeh appih so outcome metrike hipoteze. Dokument prepoveduje fake ROI, fake testimonials in zdravstvene/marketinške rezultate ter zahteva beta dokaz pred širitvijo acquisitiona.

# Kako uporabljati dokument

Za celovit pass uporabi LB-S00 ali MW-S00 na čistem reviewable branchu. Master prompt ne izvajaj slepo skupaj z vsemi modularnimi prompti.

Za nadzorovano implementacijo izvajaj modularne prompte po vrstnem redu. Po vsakem promptu reviewaj diff, migracije, evente in teste, preden začneš naslednjega.

P0 naj bo zaključen kot vertical slice pred P1/P2. Ne implementiraj team collaboration, javnih share linkov, novih integracij ali dražjega pricinga samo zato, ker so možni.

Vsak prompt je samostojen. Kopiraj vse od START do END. Claude Code mora najprej preveriti dejansko kodo in ohraniti obstoječe uporabnikove spremembe.

Repo dokumentirani rezultati testov so evidence iz trenutnega maina, ne test, ki ga je izvedel ta Word dokument. Claude mora po svojih spremembah teste zagnati ponovno.

## Priporočena fazna izvedba

Faza

LaunchBloom

Mellowa

Gate

P0 · Value proof

LB-S01 → S05

MW-S01 → S04 + S07

Uporabnik izvede cel value loop; varnost, billing in data boundaries ostanejo zelene.

P1 · Retention

LB-S06 → S09

MW-S05 → S09

Dokazana ponovna uporaba v beta kohorti; brez občutljivih analytics podatkov.

P2 · Scale

LB-S10 + šele nato acquisition

MW-S10 + šele nato širši cohort

Live transakcija, cron/email, cost ceiling, rollback in auth E2E dokazani.

## LaunchBloom — zemljevid promptov

ID

Prompt in rezultat

LB-S00

Master value-and-scale implementation pass: Turn LaunchBloom into a campaign control layer: every campaign exposes what is missing, what conflicts, what became stale after a brief change, what needs human review and the shortest trustworthy next action.

LB-S01

Campaign gap map and transparent readiness checklist: Give every campaign an explicit, user-configurable deliverable plan with Required, Optional and Not needed states, plus transparent readiness blockers.

LB-S02

Cross-channel consistency engine: Add a deterministic, explainable consistency engine that finds conflicts and missing canonical facts before export without pretending to verify truth.

LB-S03

Brief-change impact and stale-asset review: Turn brief snapshots into a valuable change-control system: show affected assets, changed fields and safe next choices.

LB-S04

Review queue, evidence locker and export gate: Create one campaign review queue and reusable evidence locker that reduces duplicate verification while preserving human responsibility.

LB-S05

First-value activation and campaign package preview: Reduce time-to-first-reviewed-asset and preview the connected campaign system before checkout without giving away or fabricating generated content.

LB-S06

Channel playbooks and reusable campaign templates: Add safe, transparent playbooks that accelerate setup while keeping every claim, date, price and proof user-controlled.

LB-S07

Professional handoff without fake collaboration: Create a high-value review packet and optional secure read-only review link only if the repository can implement ownership, expiry and revocation safely.

LB-S08

Pricing, packaging and value communication: Reframe pricing and paywalls around jobs completed while preserving canonical prices, limits, trial eligibility and fair access to review/export behavior.

LB-S09

Value analytics, beta experiments and kill criteria: Create a decision-grade analytics model and 4-week beta learning plan that can prove, revise or kill the paid-value hypotheses.

LB-S10

Paid-launch reliability and scaling gate: Produce a staged, observable beta rollout that proves the full paid loop and protects user work under provider failure and load.

# Del I — LaunchBloom

## LaunchBloom product contract

Pravilo: Ta pogodba je obvezni kontekst za vsak prompt v tem delu. Če se koda in pogodba razlikujeta, Claude naj najprej preveri dejansko backend vedenje in odpravi neskladje brez izmišljanja funkcionalnosti.

Position remains: ‘Turn one offer into a launch-ready campaign.’ Launch-ready means structured, connected and review-ready; publishing, sending, scheduling, approval, compliance and performance remain with the user.

Canonical journey: Brand Profile → Campaign Brief → Create → Review → Library → Export.

Exactly five canonical Create paths: Website, Email, Social, Ads & Creative and SEO Ideas. Legacy campaign-package routes remain accessible for existing work but are not a sixth canonical destination.

Brand Profile is reusable workspace truth. Campaign Brief is campaign-specific truth. Every saved asset retains its generation-time brief snapshot and provenance.

Customer-facing statuses: Draft, Needs review, Ready to export and Published. Published is user-declared; LaunchBloom does not publish, send or schedule.

Social plans but does not post or schedule. SEO provides ideation and a research workflow, not verified volume, difficulty, rank or traffic forecasts. Creative outputs are briefs, not rendered media or approved ads.

Free setup includes account, workspace, Brand Profile and Campaign Brief. An eligible 3-day trial begins at first paid generation and requires a payment method; it includes 20 AI actions and one full launch campaign.

One AI action is one successful user-triggered generation or regeneration. Failed generations, edits, review, copying and export do not count.

Canonical catalog: Starter $12.99/month or $99/year (1 workspace, 30 AI actions, 3 campaigns); Pro $24.99/month or $199/year (3 workspaces, 120 actions, 10 campaigns); Studio $59/month or $499/year (10 workspaces, 400 actions, 30 campaigns). Read these from backend/lib/plan-catalog.js and plan-limits.js; never create a second source of truth.

Never invent customer proof, outcomes, counts, urgency, discounts, product facts, integrations, certifications or research metrics. Missing evidence becomes a review item or placeholder.

## LB-S00  |  Master value-and-scale implementation pass

Namen: Turn LaunchBloom into a campaign control layer: every campaign exposes what is missing, what conflicts, what became stale after a brief change, what needs human review and the shortest trustworthy next action.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

A solo founder or small ecommerce team is not paying for more text. They pay to turn one approved offer into a coherent multi-channel campaign with fewer contradictions, less review work and a clear path to handoff.

CURRENT EVIDENCE AND GAP

Remote main already reports a coherent v7 contract, five studios, brief snapshots, Library provenance/versioning, canonical billing and green repository verification (242 backend tests and 18 public Playwright journeys in the repository evidence).

The current dashboard recommends unfinished work and campaigns with zero assets, but there is no verified campaign-wide consistency check, brief-change impact map or explicit gap/readiness workflow across all five channels.

The remaining risk is commodity positioning: generation alone is directly substitutable by general-purpose AI and established marketing platforms.

PRIMARY OUTCOME

Turn LaunchBloom into a campaign control layer: every campaign exposes what is missing, what conflicts, what became stale after a brief change, what needs human review and the shortest trustworthy next action.

INSPECT BEFORE EDITING

Map campaign, Brand Profile, brief snapshot, all five asset tables, Library versions, statuses, export paths, next-actions and analytics. Build a route → data → decision → user-value matrix before editing.

Identify existing deterministic quality checks and distinguish field validation, factual review, cross-asset consistency and channel-specific compliance.

Read planGate, usage ledger and plan catalog so new non-generative checks remain free and successful generations alone consume actions.

IMPLEMENT

Implement the P0 capabilities in this playbook as one coherent vertical slice: campaign gap map, deterministic consistency findings, brief-change staleness, review queue and action dashboard.

Make the campaign page the command center while preserving the canonical journey and five studios. Show one primary next action and no more than three secondary actions derived from real state.

Add a first-value path that produces one reviewed asset quickly, then reveals the multi-channel campaign system instead of pushing users into five disconnected generators.

Instrument the value funnel without storing prompts, generated copy, brand proof or customer content. Extend content-contract tests for every new promise.

Update docs with staged rollout, migration/backfill, feature-flag, rollback and live-beta evidence requirements.

DATA, API AND STATE CONTRACT

Prefer additive migrations. Store normalized finding codes and references, not duplicated full asset text. Existing asset rows and version history must remain readable.

Design a deterministic campaign-health service consumed by Campaigns, Dashboard and Library. It must be pure/testable where possible and must not spend an AI action.

Expose server-derived summaries scoped by workspace ownership. Never trust a client-supplied workspace, campaign, entitlement or status transition.

VALUE MEASUREMENT

Track: campaign_command_center_viewed, campaign_gap_viewed, finding_resolved, stale_asset_reviewed, first_asset_ready and campaign_export_completed with IDs reduced to opaque internal references.

Calculate time-to-first-ready-asset and time from brief change to stale-review completion server-side or in privacy-safe analysis. Treat targets as hypotheses until beta data exists.

Create a weekly value review that asks whether users complete a campaign, resolve findings and return to the same campaign; do not optimize raw generation volume.

NON-NEGOTIABLE CONSTRAINTS

Do not add direct publishing, sending, scheduling, fake SEO data, compliance approval, AI performance forecasts or team-collaboration claims.

Do not replace Brand Profile/Campaign Brief with a generic chat box. Do not delete legacy data paths.

No arbitrary percentage readiness score. Use transparent check states with explicit reasons and human-review boundaries.

ACCEPTANCE CRITERIA

A campaign owner can answer: what is missing, what conflicts, what is stale, what needs review and what to do next without opening every studio.

Every finding links to the exact asset/field and explains whether resolution is automated, user-confirmed or external.

Brief edits never silently update old assets; the user can review impact and selectively regenerate or keep the snapshot.

All new checks are free, workspace-scoped, test-covered and do not alter generation quotas.

VERIFICATION

Run targeted tests during each vertical slice, then npm run check and npm run test:e2e. Record live Stripe/email/domain steps as external blockers, not passes.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S01  |  Campaign gap map and transparent readiness checklist

Namen: Give every campaign an explicit, user-configurable deliverable plan with Required, Optional and Not needed states, plus transparent readiness blockers.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Users lose time deciding which launch assets are actually needed and discover missing pieces only during handoff.

CURRENT EVIDENCE AND GAP

Campaigns currently stores a brief and asset counts; Dashboard only detects zero assets and unfinished drafts.

Five channel paths exist, but not every campaign needs every path. A generic five-of-five completion score would be misleading.

PRIMARY OUTCOME

Give every campaign an explicit, user-configurable deliverable plan with Required, Optional and Not needed states, plus transparent readiness blockers.

INSPECT BEFORE EDITING

Inspect Campaigns.jsx, campaigns routes/migration, asset-count aggregation, Library status gates, five studio types and next-actions tests.

Document which output types each studio can actually create and export; do not invent deliverables or integrations.

IMPLEMENT

Add a ‘Campaign deliverables’ section where the user chooses required outcomes such as landing page, launch email flow, social launch set, ad creative brief and SEO research ideas. Defaults may come from campaign objective only when labeled Suggested and editable.

Compute states: Not planned, In progress, Needs review, Ready and Excluded from current campaign. Explain every state from real asset/status data.

Show blockers as a checklist: incomplete required brief fields, no required asset, unresolved placeholders/claims, stale asset, and export-blocking status. External research or platform review remains a user task.

Drive Dashboard next actions from the highest-priority unresolved required deliverable without adding a sixth Create path.

DATA, API AND STATE CONTRACT

Add a campaign_deliverables table or versioned JSON field only after comparing query/update complexity. Include campaign_id, workspace_id, deliverable_code, requirement_state, created_at and updated_at with unique campaign/code constraint.

Create server helpers that map saved asset types/statuses to deliverable codes. Reject unknown codes and cross-workspace access.

Backfill existing campaigns conservatively as ‘unplanned’; never infer that every channel is required.

VALUE MEASUREMENT

Track deliverable_plan_saved, required_deliverable_started and required_deliverable_ready. Never log brief or asset content.

Measure the share of activated campaigns with an explicit deliverable plan and the time from first required item to all required items review-ready.

NON-NEGOTIABLE CONSTRAINTS

No opaque score, generated deadline or forced five-channel checklist.

Planning, editing, status review and export remain free unless the canonical catalog says otherwise.

Published does not mean LaunchBloom published the asset.

ACCEPTANCE CRITERIA

A campaign with two required channels can be complete without three irrelevant channels.

Every state is reproducible from stored selections and asset data.

Changing a requirement updates the gap map immediately and safely.

Unit, API and browser tests cover empty, partial, ready, archived and legacy campaigns.

VERIFICATION

Run campaign, next-actions, Library, content-contract, migration and E2E tests; then npm run check.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S02  |  Cross-channel consistency engine

Namen: Add a deterministic, explainable consistency engine that finds conflicts and missing canonical facts before export without pretending to verify truth.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

The expensive failure is not a weak sentence; it is a campaign where the offer, dates, price, CTA or proof disagree across channels and must be manually reconciled.

CURRENT EVIDENCE AND GAP

Assets retain campaign_id and brief_snapshot, and several studio-level quality checks already exist.

No verified service currently compares canonical campaign facts across Website, Email, Social, Creative and SEO outputs.

PRIMARY OUTCOME

Add a deterministic, explainable consistency engine that finds conflicts and missing canonical facts before export without pretending to verify truth.

INSPECT BEFORE EDITING

Inspect all saved asset schemas and serializers. Catalogue structured fields available for CTA, URL, offer, price/promotion, dates/timezone, audience, claims/proof, disclaimers and placeholders.

Separate checks possible from structured data from checks that would require brittle natural-language extraction. Do not silently use an LLM for the initial P0 engine.

IMPLEMENT

Create normalized finding codes: missing_primary_cta, conflicting_cta_url, promotion_term_mismatch, date_or_timezone_mismatch, audience_mismatch, unsupported_claim_reference, unresolved_placeholder and brief_snapshot_mismatch.

For each finding show severity, affected assets, canonical brief value, observed structured value, why it matters and one safe resolution action.

Add campaign-level and asset-level views. Allow users to mark only human-review findings as Acknowledged with a note category; do not let acknowledgment rewrite factual data or imply approval.

Recompute on relevant save/status/brief events, with an on-demand refresh that is free. Cache only derived metadata and invalidate deterministically.

DATA, API AND STATE CONTRACT

Implement a pure checker module with versioned rules and stable codes. Store rule_version, fingerprint, first_seen_at, last_seen_at, status and resolution metadata if persistence is necessary.

A resolved finding must reopen when its fingerprint changes. Never store full generated content in analytics or duplicate it into finding rows.

API responses must be campaign/workspace scoped and pagination-safe. Handle deleted/archived assets and restored versions.

VALUE MEASUREMENT

Track consistency_check_viewed and finding_resolved by finding code/severity only.

Measure conflicts per activated campaign, median time to resolution and export attempts blocked by unresolved high-risk findings.

Do not use the absence of findings as a quality or compliance claim.

NON-NEGOTIABLE CONSTRAINTS

No AI action for deterministic checks.

No claim that LaunchBloom fact-checks, approves or guarantees compliance.

Do not parse unstructured text with fragile regex and present the result as certain; label limited-detection findings precisely.

ACCEPTANCE CRITERIA

Tests cover equal/missing/conflicting CTA, price, date/timezone, proof and placeholder states across at least three studios.

Every finding links to exact evidence and survives refresh/idempotent recomputation.

A clean result says ‘No issues detected by these checks’, not ‘Campaign approved’.

VERIFICATION

Run new checker tests, all studio/Library/export tests, content-contract banned-claim tests, npm run check and E2E for findings UI.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S03  |  Brief-change impact and stale-asset review

Namen: Turn brief snapshots into a valuable change-control system: show affected assets, changed fields and safe next choices.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Campaign facts change after drafts exist. Users need to know which assets may now be outdated without losing approved work or regenerating everything.

CURRENT EVIDENCE AND GAP

Assets already keep brief_snapshot and prompt_version; Campaign Brief reopening copy explains that saved assets keep their snapshot.

The product does not yet expose a field-level diff from current brief to each asset snapshot or a selective review workflow.

PRIMARY OUTCOME

Turn brief snapshots into a valuable change-control system: show affected assets, changed fields and safe next choices.

INSPECT BEFORE EDITING

Inspect campaign patch/approve/reopen routes, snapshot creation in every studio, Library versioning and status transitions.

Define which brief fields are material for each studio and which changes are informational only.

IMPLEMENT

When the brief changes, compute a field-level diff against each asset snapshot and mark the asset ‘Review brief changes’ without overwriting its customer-facing status value unless the existing status contract explicitly supports it.

Show changed field, old snapshot value, current brief value, affected asset and suggested action: Keep snapshot, Edit manually, Regenerate selected asset or Open studio.

Keeping a snapshot requires an explicit user decision and records reviewed_at/reviewer; regeneration creates a new version and spends exactly one AI action only on success.

Do not bulk-regenerate by default. Provide a preview/count and confirmation for any multi-asset operation.

DATA, API AND STATE CONTRACT

Use a derived stale state or additive review-state table rather than overloading Published/Ready statuses.

Version all field-dependency mappings. Recompute after restore/duplicate/archive and prevent cross-campaign resolution.

Preserve old brief snapshots and version history for auditability.

VALUE MEASUREMENT

Track brief_change_detected, stale_asset_opened and stale_asset_resolved with changed_field_codes only.

Measure time from material brief edit to resolution and the proportion resolved by manual edit vs regeneration; never reward more AI actions.

NON-NEGOTIABLE CONSTRAINTS

No silent propagation and no destructive rewrite of existing assets.

No statement that an unchanged snapshot is factually correct.

Do not consume quota for diffing, review or keeping a snapshot.

ACCEPTANCE CRITERIA

A one-field CTA change identifies only dependent assets and exact old/new values.

Users can resolve each affected asset independently.

A failed regeneration releases quota and leaves the prior version/status intact.

Tests cover duplicate, restore, archive and concurrent brief edits.

VERIFICATION

Run campaign/asset/version/usage tests, concurrent update tests, content-contract tests, npm run check and focused E2E.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S04  |  Review queue, evidence locker and export gate

Namen: Create one campaign review queue and reusable evidence locker that reduces duplicate verification while preserving human responsibility.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Professional handoff requires a single place to resolve claims, sources, links, placeholders and approvals; otherwise the founder still reviews five tools manually.

CURRENT EVIDENCE AND GAP

Library already exposes provenance, versions, statuses and export safeguards. Creative proof readiness and SEO research source/date checks exist in studio-specific form.

Proof/source data is fragmented by asset type and there is no campaign-wide review queue.

PRIMARY OUTCOME

Create one campaign review queue and reusable evidence locker that reduces duplicate verification while preserving human responsibility.

INSPECT BEFORE EDITING

Inspect Brand Profile proof/restriction fields, studio warnings, SEO research metadata, Creative proof source, Library filters, export functions and status transition APIs.

Identify what may be reused at workspace level versus what is campaign- or asset-specific.

IMPLEMENT

Add evidence records with type, label, source URL/reference, checked date, optional expiry/review date, permitted claim text and scope. Never scrape or assert source truth automatically.

Link findings and claim references to evidence records. Reuse links across assets without copying evidence text into every row.

Build Review views by campaign and risk type with bulk navigation but individual resolution. ‘Ready to export’ remains a human decision gated by required checks.

Before export, present unresolved blocking items and non-blocking reminders. Allow export only under current catalog rules and existing safety policy.

Generate a review manifest inside campaign exports: asset title/type/status, brief snapshot timestamp, unresolved items and evidence references. Label it as a handoff record, not approval or compliance certificate.

DATA, API AND STATE CONTRACT

Add evidence and asset_evidence_link tables with ownership scope and soft-delete/archive behavior. Sanitize URLs; reject javascript/data schemes.

Never place source document contents or secrets in analytics.

Export manifest must be deterministic and covered by snapshots.

VALUE MEASUREMENT

Track evidence_added, review_item_resolved, export_blocked and review_manifest_exported with categorical metadata only.

Measure repeated evidence reuse, unresolved blockers at export and time from first draft to Ready to export.

NON-NEGOTIABLE CONSTRAINTS

No automated legal/platform approval, no fake citation verification and no web scraping in this prompt.

Do not change canonical statuses or create a ‘compliant’ badge.

No team-collaboration claim unless actual multi-user auth/permissions are later implemented.

ACCEPTANCE CRITERIA

A reviewer can traverse all campaign risks without opening each studio manually.

One evidence record can be linked safely to multiple claims/assets.

Exports clearly disclose unresolved items and never erase them.

URL, ownership, deletion and restore tests pass.

VERIFICATION

Run Library/export/status/security tests, accessibility tests for queue navigation, content-contract tests, npm run check and E2E review/export journey.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S05  |  First-value activation and campaign package preview

Namen: Reduce time-to-first-reviewed-asset and preview the connected campaign system before checkout without giving away or fabricating generated content.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

A new user must experience connected campaign value before the trial feels like payment for a generic generator.

CURRENT EVIDENCE AND GAP

v7 routes new signups to Brand Profile and supports free Profile/Brief setup, but the first 10 minutes still involve configuration before the differentiating cross-channel control becomes visible.

The trial spends AI actions only at generation and should prove value with one focused asset, not encourage five immediate generations.

PRIMARY OUTCOME

Reduce time-to-first-reviewed-asset and preview the connected campaign system before checkout without giving away or fabricating generated content.

INSPECT BEFORE EDITING

Trace anonymous landing → signup → Brand Profile minimum baseline → Campaign Brief approval → Create → paywall → generation → warnings → Ready/export, including browser-back and checkout-return states.

Measure field count, repeated inputs, dead ends, lost draft risk and current event coverage.

IMPLEMENT

Add a compact activation checklist with four states: Brand baseline, Campaign Brief, First asset, Review/export. Each item is derived from server state and resumes safely.

Use progressive Profile setup: require only verified essentials for first campaign; expose optional depth after first value. Never weaken claim/proof restrictions.

Before trial, show a deterministic campaign package preview listing inherited brief facts, selected deliverables, expected output structures and review checks—no fake AI draft.

After first successful generation, route directly to Quality/Review and guide one warning resolution plus save/export. Do not immediately upsell more generations.

Preserve form state across auth, trial paywall, checkout success/cancel and retry.

DATA, API AND STATE CONTRACT

Activation state must be derived, not a second manually maintained completion flag.

Pending checkout/generation intent must be signed or server-bound and must never trust client price/plan/workspace values.

VALUE MEASUREMENT

Track activation_step_completed, package_preview_viewed, trial_paywall_viewed, first_asset_generated, first_warning_resolved and first_asset_exported.

Report median time and drop-off per step; define hypotheses, not external benchmarks.

NON-NEGOTIABLE CONSTRAINTS

Do not promise no-card trial; payment method remains required for eligible trial.

Do not auto-generate a campaign package or spend multiple actions.

Do not bypass manual Campaign Brief approval.

ACCEPTANCE CRITERIA

A fresh user can resume every interrupted activation step.

No information already in Profile/Brief is requested again.

The user sees why the paid workflow differs before starting trial.

E2E covers eligible, prior-trial, checkout-cancel, failure and mobile flows.

VERIFICATION

Run auth, activation, paywall, payments, usage, content-contract and E2E tests; npm run check and app-fresh verification.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S06  |  Channel playbooks and reusable campaign templates

Namen: Add safe, transparent playbooks that accelerate setup while keeping every claim, date, price and proof user-controlled.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Blank forms and generic prompt options increase decision time. Users pay for proven workflow structure adapted to their offer—not invented marketing outcomes.

CURRENT EVIDENCE AND GAP

The app has studio-specific page/flow/format types and a guided campaign-package legacy path.

There is no verified, user-manageable template layer spanning brief decisions, deliverables and channel output structures.

PRIMARY OUTCOME

Add safe, transparent playbooks that accelerate setup while keeping every claim, date, price and proof user-controlled.

INSPECT BEFORE EDITING

Catalogue current studio types, defaults, validation and legacy package templates. Find any data that can become reusable without copying customer content between workspaces.

Identify 3–5 narrow initial use cases supported by current outputs, such as product launch, limited promotion, waitlist/prelaunch and evergreen offer refresh.

IMPLEMENT

Implement versioned first-party playbooks containing suggested campaign objective, required/optional deliverables, brief questions and studio output structures—not generated claims or outcome promises.

Show exactly what a playbook will set before applying it. Preserve existing campaign values unless the user explicitly chooses Replace.

Allow users to save a sanitized workspace template from an existing campaign with an itemized include/exclude screen for facts, deliverables and structures.

Template application creates a new Draft Campaign Brief and never copies approval, Published status, evidence ownership or performance claims.

DATA, API AND STATE CONTRACT

Version first-party templates in code or a controlled table with stable IDs; version user templates in the workspace.

Add explicit template provenance and migration-safe schema. Prevent cross-workspace reads and unsafe HTML/URLs.

VALUE MEASUREMENT

Track playbook_previewed, playbook_applied and user_template_reused.

Measure setup time and activation completion by playbook ID; do not claim causal lift until an experiment is run.

NON-NEGOTIABLE CONSTRAINTS

No fabricated best practices, benchmark conversion rates, countdowns or testimonials.

No hidden overwrites and no auto-approval.

Do not expose a public marketplace in this phase.

ACCEPTANCE CRITERIA

Applying a playbook is previewable, reversible before save and leaves required facts empty for user verification.

User templates cannot leak one workspace’s data to another.

Every studio still inherits the same approved brief.

VERIFICATION

Run template unit/API/security tests, campaign duplication tests, content-contract tests, npm run check and activation E2E.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S07  |  Professional handoff without fake collaboration

Namen: Create a high-value review packet and optional secure read-only review link only if the repository can implement ownership, expiry and revocation safely.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Founders and small agencies need to hand campaign work to clients, designers or channel operators, but a full multi-user collaboration system is high-risk and not currently promised.

CURRENT EVIDENCE AND GAP

Studio pricing targets agencies/multi-brand users through workspace limits. Current go/no-go documentation explicitly avoids team-collaboration claims.

Exports exist, but handoff quality can improve before adding identities, invitations and role permissions.

PRIMARY OUTCOME

Create a high-value review packet and optional secure read-only review link only if the repository can implement ownership, expiry and revocation safely.

INSPECT BEFORE EDITING

Inspect export formats, Library manifests, auth/session architecture, legal/privacy copy and whether any share-token mechanism exists.

Decide in an ADR between export-only P0 and tokenized read-only P1; default to export-only if secure revocation cannot be proven.

IMPLEMENT

Build a campaign review packet containing campaign summary, asset index, statuses, evidence references, unresolved items, brief-snapshot timestamps and explicit downstream owner checklist.

Provide Markdown, print-friendly HTML/PDF path only if existing dependencies support it, and current safe Word/export formats. Do not label dependency-free HTML .doc as true .docx.

If implementing review links, use high-entropy hashed tokens, server-side campaign scope, expiry, revocation, rate limits, no indexing, no editing and no access to Account/other workspaces. Add an owner-visible access log without IP retention unless justified.

Use product copy ‘Share for review’ only when a real secure link exists; otherwise say ‘Export review packet’. Never claim real-time collaboration.

DATA, API AND STATE CONTRACT

Store token hashes, never raw tokens; one token maps to one campaign and explicit asset set.

Revocation must take effect immediately and archived/deleted campaigns must close access.

No sensitive internal prompt, usage, billing or unrelated evidence data in a packet.

VALUE MEASUREMENT

Track review_packet_exported and, if links exist, review_link_created/revoked/opened without content or raw token data.

Measure repeat exports/shares and time from share to user-recorded review completion, without claiming recipient approval unless explicitly captured.

NON-NEGOTIABLE CONSTRAINTS

No comments, assignments, presence or team seats in copy unless implemented end to end.

No public-by-guessable-URL sharing.

Do not implement token links if security tests or server control are insufficient.

ACCEPTANCE CRITERIA

Packet is complete, readable and honest about unresolved work.

Share-link implementation, if chosen, passes token, expiry, revocation, authorization, caching and noindex tests.

Existing workspace boundaries remain intact.

VERIFICATION

Run export snapshots, security tests, content-contract tests, accessibility/print QA, npm run check and focused E2E.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S08  |  Pricing, packaging and value communication

Namen: Reframe pricing and paywalls around jobs completed while preserving canonical prices, limits, trial eligibility and fair access to review/export behavior.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Pricing is justified only when users understand that they are buying campaign control, reuse and reduced rework—not bundles of AI credits.

CURRENT EVIDENCE AND GAP

The catalog and trial rules are now centralized and accurate. Current tiers primarily differentiate by workspaces, AI actions and campaign allowances.

Value features introduced in this playbook must map honestly to tiers without withholding basic review safety or inventing ROI.

PRIMARY OUTCOME

Reframe pricing and paywalls around jobs completed while preserving canonical prices, limits, trial eligibility and fair access to review/export behavior.

INSPECT BEFORE EDITING

Inspect /api/plans, plan catalog/limits, Landing pricing, TrialPaywall, Account, lifecycle emails and enforcement for every proposed feature.

List features that are security/safety essentials versus scalable capacity or agency convenience. Safety and factual review cannot be paywalled.

IMPLEMENT

Keep canonical prices unless owner-approved evidence supports a change. Rewrite plan notes and comparison rows around user fit, campaign capacity, workspace reuse and the campaign-control workflow.

Explain AI actions once with a concrete example. Keep review, editing, checks and exports free when the catalog says so.

At contextual paywalls, preserve user work and show: selected plan, eligibility branch, exact post-trial price/cadence, payment-method requirement, charge date source, cancellation route, remaining allowance and immediate next action.

Map new P0 value features to all paid/trial users unless there is a real cost/permission reason to gate them. Reserve higher tiers for capacity and later proven agency operations, not basic truthfulness.

Add pricing-contract tests for every new comparison row and prohibit hard-coded duplicates.

DATA, API AND STATE CONTRACT

Plan responses remain sourced from existing catalog and enforcement objects.

Do not add a frontend-only feature gate. Unknown plan/price fails closed and prior-trial users never see second-trial copy.

VALUE MEASUREMENT

Track plan_comparison_viewed, contextual_paywall_viewed, checkout_started and checkout_completed by canonical plan/interval and eligibility branch.

Measure trial start after package preview, first ready asset within trial and retained paid campaigns; never log revenue promises to users.

NON-NEGOTIABLE CONSTRAINTS

No ‘unlimited’, fake most-popular badge, fake discount, urgency, customer count, ROI or guaranteed time saving.

Do not change prices/limits in UI copy only.

Do not paywall access to a user’s existing work.

ACCEPTANCE CRITERIA

Every commercial string matches server truth.

Users can identify which plan fits from real capacity and workflow needs.

All trial-used, canceled, past-due and webhook-delay states have one honest CTA.

Tests fail on price/limit/disclosure drift.

VERIFICATION

Run plan-catalog, plan-gate, payments, webhooks, Account, lifecycle-email, content-contract and E2E checkout-state tests; npm run check.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S09  |  Value analytics, beta experiments and kill criteria

Namen: Create a decision-grade analytics model and 4-week beta learning plan that can prove, revise or kill the paid-value hypotheses.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

Without evidence of repeated campaign completion, shipping more features can scale cost rather than customer value.

CURRENT EVIDENCE AND GAP

Analytics infrastructure exists and current docs include activation events, but the existing beta targets include assumptions that must not be treated as validated benchmarks.

The new value loop needs privacy-safe measurement of control/review outcomes rather than generation counts.

PRIMARY OUTCOME

Create a decision-grade analytics model and 4-week beta learning plan that can prove, revise or kill the paid-value hypotheses.

INSPECT BEFORE EDITING

Inventory analytics_events, sanitization, admin summaries and every current client/server event. Identify duplicates, missing server confirmation and sensitive-property risks.

Review existing go/no-go thresholds and label unvalidated targets as hypotheses.

IMPLEMENT

Define one canonical funnel: workspace created → minimum profile → brief approved → deliverable plan saved → first asset generated → first finding resolved → first asset ready → campaign review packet/exported → day-7 return.

Emit generation/export/ready events from server-confirmed success when possible. Add idempotency keys or dedupe rules for retries.

Create cohort queries or an operator dashboard for activation, time-to-value, multi-channel adoption, finding resolution, D7/D30 return, trial conversion and cancellation reason categories.

Define three experiments with one variable each: package preview, deliverable-plan default and first-review guidance. Include hypothesis, eligibility, primary metric, guardrail, sample limitation, decision rule and rollback.

Add kill criteria: if users do not complete a campaign or return to revise/export it, stop adding generators and run interviews/usability studies.

DATA, API AND STATE CONTRACT

Use stable event names and documented properties. Prohibit raw prompts, asset text, proof, URLs, email, brand name and free-text cancellation reasons.

Retention windows and deletion must align with privacy registry/legal policy.

VALUE MEASUREMENT

Measure workflow completion and repeated use; treat generation volume and clicks as diagnostic only.

Document that beta sample sizes may be directional and do not present statistical certainty without sufficient data.

NON-NEGOTIABLE CONSTRAINTS

No fingerprinting, cross-site tracking or sensitive content analytics.

No invented conversion benchmark or causal claim.

Do not block the product if analytics insertion fails.

ACCEPTANCE CRITERIA

Every event has trigger, source, allowed/prohibited properties and question answered.

Retry tests do not double-count server events.

Account export/delete includes or deletes analytics according to the privacy contract.

An operator can make a ship/change/stop decision after each experiment.

VERIFICATION

Run analytics sanitization/idempotency/privacy tests, admin access tests, account export/delete tests and npm run check.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

## LB-S10  |  Paid-launch reliability and scaling gate

Namen: Produce a staged, observable beta rollout that proves the full paid loop and protects user work under provider failure and load.

COPY INTO CLAUDE CODE — START

ROLE AND OPERATING MODE

You are Claude Code working directly in primocera/LaunchBloom. Implement a production-quality, reviewable change; do not stop at strategy, copy suggestions or a mockup.

Read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product-contract tests and launch/go-no-go documents before editing. Preserve unrelated user work and never use destructive git commands.

Preserve every rule in the LaunchBloom product contract supplied with this prompt. Backend behavior, schemas and tests are the technical source of truth; investigate any conflict before changing customer promises.

Do not mutate production data, Stripe, email providers, domains or external systems. Add migrations and operator steps, but leave live execution to the owner unless explicitly authorized.

PAID USER PROBLEM

A product is not worth paying for if checkout, generation, state transitions or exports fail under real use—even when local tests are green.

CURRENT EVIDENCE AND GAP

Repository evidence reports green automated checks, but live Stripe prices/domain, Resend domain, cron trigger, legal identity and manual checkout remain external blockers.

New derived campaign checks and migrations introduce backfill, cache and concurrency risk.

PRIMARY OUTCOME

Produce a staged, observable beta rollout that proves the full paid loop and protects user work under provider failure and load.

INSPECT BEFORE EDITING

Read current BETA_GO_NO_GO, runbooks, admin health, Stripe idempotency, usage reserve/finalize/release, email outbox, migration order, rollback and build freshness.

Create a dependency map for each new value feature and its failure mode.

IMPLEMENT

Add release checks for required migrations, rule versions, legal config, Stripe price allowlist, domain, cron secret and email configuration without printing secrets.

Add safe recomputation/backfill jobs for gap/findings/stale state with checkpoints, dry-run, workspace batching, idempotency and kill switch.

Define SLO hypotheses for API/generation latency and error rate; implement structured error categories and correlation IDs without content.

Run failure-injection tests for AI timeout/malformed output, Supabase partial failure, duplicate webhook, export error, concurrent brief edit and derived-check recomputation.

Update the go/no-go scorecard: automated evidence, live rehearsal, cohort cap, cost ceiling, rollback triggers and named external owner actions.

DATA, API AND STATE CONTRACT

Never rebuild derived state destructively; source assets/snapshots remain authoritative.

Backfills must be safe to resume and must not consume AI actions.

Feature flags are kill switches, not substitutes for authorization or tests.

VALUE MEASUREMENT

Monitor error rate, p95 latency, failed/released AI actions, finding recomputation failures, export failures and cost per activated/retained campaign.

Scale cohort only after live payment, cancellation, email, generation and recovery evidence exists.

NON-NEGOTIABLE CONSTRAINTS

Do not mark paid launch GO from mocked/local tests.

No secret values in logs or artifacts.

No automatic migration/production mutation in this prompt.

ACCEPTANCE CRITERIA

Automated gates pass at a frozen release commit.

One live low-value transaction and cancel/recover journey has owner-recorded evidence before paid invites.

Rollback and kill switches are tested.

Open P0/P1 and external blockers remain visible and assigned.

VERIFICATION

Run npm run check, npm run test:e2e and documented release checks; report every environment-blocked live step separately.

FINAL RESPONSE FORMAT

Lead with the material user-value improvement; then report changed files, migrations/config, events, exact commands and results, assumptions, unverified checks and P0/P1/external blockers. Before stopping, run git diff --check and inspect the complete diff for duplicate truth, leaked content/PII, secrets, product-contract drift, stale generated assets and unrelated changes.

COPY INTO CLAUDE CODE — END

# Priloga A — skupni acceptance gate

Value: sprememba reši konkreten ponavljajoč problem in zmanjša odločitve, review ali rework; ne dodaja samo outputa.

Truth: UI obljuba je podprta z backendom; noben status, trial, price, limit, safety ali publishing claim ne driftne.

Control: uporabnik vidi, kaj je bilo uporabljeno/spremenjeno, lahko previewa, zavrne, undo-a ali izvozi svoje delo.

Failure: AI/provider/database failure ne porabi entitlementa, ne povzroči delnega stanja in ne uniči prejšnje verzije.

Privacy: analytics/email/logs nimajo promptov, assetov, journal/check-in, allergies, custom names ali druge občutljive vsebine.

Verification: lint, tipi, testi, build, relevantni E2E in git diff --check imajo pošten rezultat; live evidence ni zamenjan z mockom.

Scale: cohort se ne razširi, dokler live billing/email/cron/cost/rollback in P0/P1 gate niso zaprti.

# Priloga B — obvezni zaključni report Claude Code

Outcome and paid problem solved.

Changed files grouped by user experience, backend/data, commercial/safety and tests/docs.

Migration, backfill, feature-flag and rollback instructions.

Exact events added: trigger, allowed properties, prohibited properties and product question.

Commands and results, including skipped/environment-blocked checks.

Product-contract invariants preserved and new content-contract tests.

P0/P1/external blockers with owner, evidence and acceptance check.

Final git state and unrelated pre-existing changes preserved.

# Priloga C — aktualni uradni tržni viri

Opomba: Viri so uporabljeni za razumevanje trenutnih kategorijskih pričakovanj, ne za kopiranje funkcij ali dokazovanje outcome rezultatov. Pridobljeno 19. julija 2026.

LaunchBloom market context — Jasper platform, Brand Voice and Campaigns: https://www.jasper.ai/ · https://www.jasper.ai/brand-voice · https://www.jasper.ai/blog/introducing-campaigns  •  LaunchBloom market context — Copy.ai GTM AI platform: https://www.copy.ai/  •  Mellowa market context — Tiimo AI planning, Structured/Replan and Sunsama guided planning: https://www.tiimoapp.com/product/ai-planning · https://structured.app/ · https://help.structured.app/en/articles/1897986 · https://www.sunsama.com/blog/the-official-daily-planning-guide  •  GitHub source reviewed: https://github.com/primocera/LaunchBloom · https://github.com/primocera/Mellowa
