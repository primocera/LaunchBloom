# Scalvya Product Elevation — Claude Code Prompts v9 (verbatim from Scalvya_Product_Elevation_Claude_Code_Prompts_v9.docx)

PRODUCT ELEVATION IMPLEMENTATION PLAYBOOK
Scalvya + Mellowa
Copy-paste Claude Code prompts for the next product, UX, content and paid-launch level
Izdaja: 22. julij 2026 · temelji na ponovno pregledanem trenutnem mainu obeh repozitorijev · 26 samostojnih izvedbenih promptov · prompti so v angleščini zaradi kode in angleškega UI-ja.
Integrate v8  •  simplify UX  •  improve content  •  prove repeat value  •  scale only after evidence

Izvršni zaključek
Scalvya: Produkt je funkcionalno prešel iz AI generatorja v campaign-control sistem. Največji naslednji dvig je campaign cockpit, jasen ICP, profesionalen review/handoff in operativno dokazljiv paid launch—ne dodatni generatorji.
Mellowa: Produkt ima močan Now/repair/memory/weekly loop. Največji naslednji dvig je Now-first informacijska arhitektura, manj trenja, konsistentna tedenska retencija, transparentni fair-use stroški in zaprt realni transaction P0.
Pravilo v9: Najprej izvedi integracijo in poenostavitev. Ne izvajaj vseh promptov v enem neselektivnem agent runu. Vsak modularni prompt naj ima svoj reviewable commit, diff review in acceptance gate. Če štiritedenski beta ne pokaže zaključevanja/ponovne uporabe, ustavi nove funkcije in izvedi intervjuje.
Ponovni audit trenutnega stanja
App
Dokazan napredek
Največji preostali problem
Scalvya
v8 gap map, consistency, brief impact, review/evidence, activation, templates, handoff, jobs pricing, analytics; 304 testov navedeno v repo; live domain/Stripe documented; latest Vercel status successful.
Campaign capability is crowded inside a large Campaigns route; ICP/value is not yet proven in a paying cohort; legal fallback and full main CI evidence require hardening.
Mellowa
Now, atomic repair/Undo, transparent memory, presets, meal continuity, weekly carry-forward, sample value, reminders, Premium packaging and strict analytics are implemented; live pricing is coherent.
Public paid launch remains documented NO-GO until a real transaction/cancel/reactivate/refund path; repeat use and per-user unit economics are not yet proven.
Kako izvajati paket
Vsak del najprej dobi prompt 00. Ta zamrzne baseline, preveri current HEAD in loči že implementirano od preostalega dela.
Nato izvajaj modularne prompte po vrstnem redu. Prompt SC-V9-12 oziroma MW-V9-12 je zaključni RC gate in ne sme dodajati novega scopea.
Claude Code mora ohraniti obstoječi v8 product contract, podatke in uporabnikove spremembe. Noben prompt ne dovoljuje neposrednega spreminjanja produkcijskega Stripe/Supabase/Vercel/Resend brez izrecnega pooblastila.
Če prompt naleti na novejšo implementacijo, je ne gradi ponovno: naj jo verificira, popravi preostali gap in dokumentira drift od baseline commita.
Repo navedeni testi so izvorna evidence, ne rezultat tega Word dokumenta. Po vsakem promptu je obvezen ponoven test in pošten report skipped/live checks.
Priporočeno zaporedje
Faza
Scalvya
Mellowa
Gate
0 · Freeze/P0
SC-00, SC-10
MW-00, MW-10
Legal/billing/CI/live evidence explicit; no hidden P0.
1 · Core UX
SC-01 → SC-04
MW-01 → MW-05
One clear daily/campaign job; no lost work; accessibility green.
2 · Paid value
SC-05 → SC-08
MW-06 → MW-08
Better output/continuity and coherent commercial story.
3 · Quality/scale
SC-09, SC-11
MW-09, MW-11
Measured beta, costs, retention and rollback evidence.
4 · Release
SC-12
MW-12
Frozen RC; full automated + authorized live evidence; signed verdict.
Scalvya — zemljevid promptov
ID
Prompt and implementation outcome
SC-V9-00
Baseline freeze, route audit and v9 execution guardrails: Create a trusted implementation baseline and a route/state/value map so every later v9 change improves the current product instead of duplicating v8 or drifting commercial truth.
SC-V9-01
Campaign cockpit information architecture and route refactor: Transform Campaigns from a long collection of collapsible tools into a focused campaign workspace where the user immediately understands status, blockers and the next action.
SC-V9-02
Deterministic next-best-action and transparent readiness model: Make the campaign cockpit operational: translate real state into one trustworthy next action and transparent readiness reasons without gamified scoring.
SC-V9-03
Campaign creation, brief editing and approval UX: Reduce setup friction while making the Campaign Brief feel like a trustworthy working contract rather than a long form or optional metadata.
SC-V9-04
Unified review workbench and evidence workflow: Turn the existing consistency, stale-asset and evidence tools into one efficient review workbench that reduces campaign rework and supports accountable handoff.
SC-V9-05
Asset studios: output quality, editing and context transparency: Make each studio produce more usable, editable and reviewable campaign assets while reinforcing the shared brief instead of behaving like a generic prompt box.
SC-V9-06
Campaign-scoped asset library and visual version comparison: Elevate Library from a dense asset list into a professional review workspace where users can find, compare, edit and prepare campaign assets efficiently.
SC-V9-07
Professional handoff packet and client-ready export experience: Make campaign handoff a premium outcome: one coherent, reviewable package that a founder, client, designer or channel operator can understand without access to the app.
SC-V9-08
ICP-focused positioning, onboarding, pricing and lifecycle content: Make the product immediately legible and worth paying for by positioning the campaign-control outcome—not generic AI generation—while keeping every commercial and capability claim true.
SC-V9-09
Design system, accessibility, responsive polish and perceived quality: Raise perceived product quality through a consistent interaction system, accessible campaign workflows and mobile/desktop polish without replacing the established visual identity.
SC-V9-10
Legal, billing, support and paid-production hardening: Close the gap between “configured and deployed” and a defensible paid service with fail-closed legal identity, rehearsed revenue recovery, monitoring and support evidence.
SC-V9-11
Value analytics, beta learning and product pruning: Use real behavior and interviews to prove that users complete and revisit campaigns; stop adding features when the core control loop is not producing repeat value.
SC-V9-12
Integrated release candidate and final product-quality gate: Freeze, verify and document a coherent v9 release candidate across content, UX, data, billing and operations without masking skipped live checks.
Del I — Scalvya (repo: LaunchBloom)
Scalvya product contract
Pravilo: Ta pogodba je obvezni kontekst za vsak prompt v tem delu. Če se koda in pogodba razlikujeta, Claude naj najprej preveri dejansko backend vedenje in odpravi neskladje brez izmišljanja funkcionalnosti.
Repository remains primocera/LaunchBloom; the customer-facing product name is Scalvya. Current reviewed main baseline: 333951702b42f22b780db702dc599ae3e42f19ab. Confirm the actual HEAD before editing and record any drift.
Primary promise remains truthful: ‘Turn one offer into a launch-ready campaign.’ Launch-ready means connected, structured and ready for human review; it never means approved, compliant, published, sent, scheduled or guaranteed to perform.
Canonical journey: Brand Profile → Campaign Brief → Create → Review → Library → Export. The product is a campaign-control workspace, not five unrelated generators.
Exactly five canonical creation paths: Website, Email, Social, Ads & Creative and SEO Ideas. Social plans but does not post. SEO is ideation and a research workflow, not verified keyword data or ranking prediction.
Brand Profile is reusable workspace truth. Campaign Brief is campaign truth. Every asset keeps its generation-time brief snapshot, prompt version, provenance and version history.
Customer statuses remain Draft, Needs review, Ready to export and Published. Published is user-declared. Derived blockers and stale states must not silently overwrite the canonical status model.
The v8 control layer already exists: deliverable plan/gap map, deterministic consistency checks, brief-change impact, review queue, evidence locker, activation, playbooks/templates, review manifest/handoff packet, jobs-based pricing, value analytics and release tooling. Improve and integrate these; do not rebuild competing versions.
Free setup includes account, workspace, Brand Profile and Campaign Brief preparation. An eligible paid trial starts through Stripe when the user chooses to generate; payment method and exact charge timing must be disclosed. Only successful user-triggered generation/regeneration consumes one AI action.
Canonical prices and limits remain in backend/lib/plan-catalog.js and backend/lib/plan-limits.js. Never duplicate, infer or silently change them. Editing, review checks and exports must follow the exact server entitlement.
Never invent proof, testimonials, customer counts, outcomes, urgency, discounts, legal approval, integrations, research metrics or performance forecasts. Missing facts become explicit inputs, evidence tasks or review blockers.

SC-V9-00  |  Baseline freeze, route audit and v9 execution guardrails
Namen: Create a trusted implementation baseline and a route/state/value map so every later v9 change improves the current product instead of duplicating v8 or drifting commercial truth.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The repository has just completed a large v8 value pass and a LaunchBloom → Scalvya rebrand. The highest risk is now integration drift: historical names, legal fallbacks, large route components, direct-to-main changes and documents that describe evidence more strongly than it was observed.
The current latest commit reports 304 tests, a fresh production bundle and a successful Vercel deployment, but GitHub Actions CI is pull-request-only and does not gate direct pushes to main.
PRIMARY OUTCOME
Create a trusted implementation baseline and a route/state/value map so every later v9 change improves the current product instead of duplicating v8 or drifting commercial truth.
INSPECT BEFORE EDITING
Inventory all public/authenticated/admin/legal routes, redirects, legacy flows, studio entry points, APIs, database tables, feature flags, analytics events, plan gates, export formats and lifecycle emails.
Read docs/HANDOFF_V8.md, docs/BETA_GO_NO_GO.md, docs/VALUE_ANALYTICS_V8.md and the v8 ADR. Compare claims against current source and configuration validation.
Find every customer-facing LaunchBloom/Scalvya name, legal entity fallback, stale route noun, hard-coded price/limit, “unlimited” branch, deprecated launch-kit wording and unsupported readiness claim.
IMPLEMENTATION REQUIREMENTS
Write docs/PRODUCT_ELEVATION_V9.md containing: frozen commit, current verification evidence, route → job → source data → decision → next action matrix, known P0/P1/P2 gaps, rollout order and explicit non-goals.
Fix only high-confidence baseline defects discovered during the audit: brand/legal fallback leakage, broken links, contradictory copy, stale bundle metadata, invalid route redirects or duplicated commercial truth.
Update CI so the complete non-secret gate runs on pull requests and protected-main pushes. Keep browser E2E scheduled/on-demand if cost requires it, but document exactly what does and does not gate a release.
Add a machine-readable release evidence record or deterministic checklist that pins commit SHA, migration set, build hash and command results without storing secrets.
CONTENT AND INTERACTION REQUIREMENTS
Use “Scalvya” on current customer surfaces. Historical docs may retain LaunchBloom only when clearly labeled historical. The repository name remains unchanged.
Replace any customer-visible `legal entity TBD` fallback with a fail-closed legal unavailable state; never silently fabricate an entity.
Documentation must distinguish configured, deployed, manually rehearsed and measured in production.
DATA, API, ANALYTICS AND SECURITY
Release evidence may store command names, result codes, timestamps, commit/build/migration identifiers and redacted environment-presence booleans only.
No audit, CI or release artifact may include secrets, customer content, emails, campaign names, evidence URLs or generated assets.
NON-NEGOTIABLE CONSTRAINTS
Do not refactor the whole product in this baseline prompt. Do not change prices, plans, status enums, user data or live provider settings.
CI must use pinned supported Node/runtime versions and must not print environment values.
ACCEPTANCE CRITERIA
Every route and core state has a named user job and source of truth.
The repo has no customer-visible legal placeholder if the API fails.
A main/PR commit cannot appear release-green when lint/tests/build/fresh-bundle checks did not run.
The v9 document clearly separates remaining product work from external owner actions.
VERIFICATION AND HANDOFF
Run the full existing repository gate, content-contract tests, legal/brand tests and CI workflow validation. Record any browser/live limitation honestly.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-01  |  Campaign cockpit information architecture and route refactor
Namen: Transform Campaigns from a long collection of collapsible tools into a focused campaign workspace where the user immediately understands status, blockers and the next action.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
Campaigns.jsx is currently a very large route that combines creation, brief approval, deliverables, consistency, brief impact, review/evidence, package preview, strategy, templates, archive/delete and numerous action buttons.
The capabilities are valuable, but presenting them on one card risks an internal-admin feel and hides the campaign-control differentiation users are paying for.
PRIMARY OUTCOME
Transform Campaigns from a long collection of collapsible tools into a focused campaign workspace where the user immediately understands status, blockers and the next action.
INSPECT BEFORE EDITING
Inspect app-src/routes/Campaigns.jsx, Dashboard.jsx, Create.jsx, AssetLibrary.jsx, Sidebar.jsx, route configuration, APIs and all v8 campaign helper modules/tests.
Map each campaign job to one destination: Overview, Brief, Deliverables, Assets, Review and Handoff. Confirm legacy URLs and deep links that must remain valid.
Identify duplicated data fetches and which summaries can be returned by the existing campaign/dashboard endpoints without creating an N+1 query pattern.
IMPLEMENTATION REQUIREMENTS
Introduce a campaign workspace route such as `/app/campaigns/:campaignId/:section?` with accessible tab/subnavigation. Preserve `/app/campaigns` as the campaign list/create surface.
Split the monolith into focused components/modules with clear data ownership. No component should independently re-derive status, pricing or workspace access rules.
Overview shows campaign name, approved brief version/date, required deliverables summary, open high/medium review counts, stale asset count, recent assets and one primary next action. Secondary navigation is visible but quiet.
Brief contains creation/edit/approval/change-impact entry. Deliverables owns the requirement plan. Assets shows campaign-filtered Library items. Review combines consistency, evidence and stale reviews. Handoff owns manifest/packet/export.
Keep list-level destructive actions in an overflow menu with explicit confirmations. Archive/delete/duplicate must not compete visually with the main work action.
Preserve browser back/forward, direct linking, loading, not-found, archived, permission, empty and partial-data states.
CONTENT AND INTERACTION REQUIREMENTS
Use campaign-specific labels: “Overview”, “Brief”, “Deliverables”, “Assets”, “Review”, “Handoff”. Do not introduce vague labels such as Hub, Intelligence or Magic.
The page header must answer: what campaign is this, what state is it in, what blocks handoff and what should I do next.
Do not show more than one primary CTA per section. Keep AI-action cost next to any generation/regeneration control.
DATA, API, ANALYTICS AND SECURITY
Use existing endpoints where reasonable. If adding a campaign summary endpoint, make it workspace-scoped, bounded and composed from canonical services. Never trust a client workspace/campaign relationship.
Do not store navigation completion flags. Section badges and readiness summaries are derived from real campaign/asset/finding/evidence state.
Add route-view analytics only with section code and coarse campaign state; never include campaign names or content.
NON-NEGOTIABLE CONSTRAINTS
Do not change canonical statuses or create an opaque overall percentage score.
Do not delete legacy campaign assets or break old deep links. Redirect deliberately and test it.
Do not add live collaboration, public sharing or direct publishing in this prompt.
ACCEPTANCE CRITERIA
A user can move from campaign list to any campaign job in one predictable click.
At 320px, tablet and desktop widths, the cockpit remains usable with no horizontal overflow or hidden critical action.
Overview always exposes one deterministic next action and honest zero/error states.
Existing v8 deliverables/consistency/impact/review/handoff behavior and ownership tests remain green.
VERIFICATION AND HANDOFF
Run route/component tests, campaign API tests, ownership tests, accessibility checks, desktop/mobile Playwright journeys, lint, unit/integration tests, build and fresh-bundle check.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-02  |  Deterministic next-best-action and transparent readiness model
Namen: Make the campaign cockpit operational: translate real state into one trustworthy next action and transparent readiness reasons without gamified scoring.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
Dashboard already derives recommended actions and campaign deliverables provide blockers, but the logic is fragmented across general home planning and individual v8 panels.
A paid control product must reduce prioritization work: the user should not need to open every section to decide whether to complete a brief, create an asset, resolve a finding or export.
PRIMARY OUTCOME
Make the campaign cockpit operational: translate real state into one trustworthy next action and transparent readiness reasons without gamified scoring.
INSPECT BEFORE EDITING
Inspect app-src/lib/next-actions.js, backend deliverables/consistency/review services, campaign completion analytics, status labels and Dashboard/Campaign tests.
Enumerate all legitimate blocking states and priority order. Separate hard blockers, review reminders, optional improvements and external work.
IMPLEMENTATION REQUIREMENTS
Create one pure/versioned campaign-next-action service used by Dashboard and Campaign Overview. Inputs are canonical campaign summary data; output includes action_code, label, reason, destination, severity and whether it spends an AI action.
Prioritize: incomplete core brief → approval required → required deliverable missing → stale required asset → unresolved high finding → required asset Needs review → evidence/research reminder → handoff/export. Optional deliverables must never block completion.
Expose transparent readiness groups: Brief, Required deliverables, Review blockers and Handoff. Each group shows state and human-readable reasons. Avoid a synthetic 0–100 score.
Handle campaigns with no saved plan conservatively and guide the user to choose requirements. Handle archived/deleted assets and acknowledged findings deterministically.
After completing an action, refresh the summary and announce the new next action accessibly without forcing navigation.
CONTENT AND INTERACTION REQUIREMENTS
Use precise verbs: “Complete the campaign brief”, “Create the required email flow”, “Review 2 CTA conflicts”, “Export the handoff packet”.
Never say “approved”, “verified”, “complete” or “ready” unless the exact scoped condition is true. A clean automated check says only that its configured checks found no issue.
Display “Free check” or “1 AI action” only when backed by server behavior.
DATA, API, ANALYTICS AND SECURITY
Keep the selector pure and rule-versioned. Do not persist a second readiness state; derive it from canonical rows.
Track next_action_viewed and next_action_completed with action_code and coarse state only. Completion must be server-confirmed where a durable state changes.
Add regression fixtures covering legacy campaigns, partial plans, optional-only campaigns, blocked assets and conflicting data.
NON-NEGOTIABLE CONSTRAINTS
No deadlines, urgency or prioritization invented by AI.
No bulk-acknowledge or silent status mutation to make the campaign appear ready.
Do not count generation clicks as campaign completion.
ACCEPTANCE CRITERIA
The same campaign state produces the same next action on Dashboard and Overview.
Every decision can be explained from visible real state and links to the exact resolution surface.
A two-deliverable campaign can reach handoff without irrelevant channels.
Tests lock priority order and prevent status/entitlement drift.
VERIFICATION AND HANDOFF
Run pure selector tests, Dashboard/Campaign integration tests, analytics dedupe tests, content-contract tests and end-to-end state transitions.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-03  |  Campaign creation, brief editing and approval UX
Namen: Reduce setup friction while making the Campaign Brief feel like a trustworthy working contract rather than a long form or optional metadata.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The current campaign creation form exposes many fields at once, mixes templates, dates, markets, proof, restrictions and channel selection, and only later reveals deliverable planning.
The system correctly allows a manual brief without an AI strategy, but the UI should help users reach a complete, reviewable brief faster without auto-inventing decisions.
PRIMARY OUTCOME
Reduce setup friction while making the Campaign Brief feel like a trustworthy working contract rather than a long form or optional metadata.
INSPECT BEFORE EDITING
Inspect Campaigns creation/edit code, campaign schemas/routes/migrations, activation state, templates/playbooks, draft localStorage behavior, brief version/approval and brief-impact mapping.
Identify the minimum fields required for coherent first generation versus optional depth. Confirm all validation and maximum lengths server-side.
IMPLEMENTATION REQUIREMENTS
Create a guided brief editor with four compact groups: Goal & audience, Offer & terms, Message & CTA, Proof & restrictions. Use progressive disclosure; keep all fields reachable.
Autosave a server draft when authenticated with debounced, conflict-safe updates. Local draft is only an offline/interruption fallback and must be cleared/versioned correctly after server save.
Show an always-visible Brief summary and missing-decisions list. Before approval, show exactly what new generations will inherit and that existing assets keep prior snapshots.
Integrate deliverable suggestions as a separate preview after brief basics; suggestions are editable and nothing becomes required until explicitly saved.
Reopening or editing an approved brief must show impact count before save when material dependent fields change. Never silently approve a new version.
Templates/playbooks show a field-level preview and never overwrite existing user values without explicit Replace confirmation.
CONTENT AND INTERACTION REQUIREMENTS
Use plain labels and examples appropriate to founders/marketers. Replace generic placeholders with factual prompts such as “What exactly is offered?” and “What claim must not be made?”
Explain Proof as evidence the user is permitted to use; do not encourage fabricated testimonials or metrics.
Dates remain optional. If absent, explicitly state that urgency/deadline language will not be generated.
DATA, API, ANALYTICS AND SECURITY
Use optimistic concurrency/version checks for autosave. A stale browser must not overwrite a newer approved brief without warning.
Maintain one canonical server schema. Client grouping does not create alternate field names.
Track brief_section_completed, brief_approved and approved_brief_reopened with section/changed_field_codes only; never field text.
NON-NEGOTIABLE CONSTRAINTS
Do not require AI strategy generation for approval.
Do not auto-fill proof, price, dates, audience claims or restrictions with model output.
Do not approve on autosave or consume AI actions for brief editing.
ACCEPTANCE CRITERIA
A first campaign can be created and approved with the minimum verified decisions on mobile or desktop.
Refresh, auth/paywall detours and checkout cancel do not lose the draft.
Concurrent edit conflicts are visible and recoverable.
Approval copy and downstream snapshot behavior remain accurate in all tests.
VERIFICATION AND HANDOFF
Run schema/API/concurrency tests, template tests, brief-impact tests, activation tests, accessibility checks and full browser journeys for create/edit/approve/reopen.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-04  |  Unified review workbench and evidence workflow
Namen: Turn the existing consistency, stale-asset and evidence tools into one efficient review workbench that reduces campaign rework and supports accountable handoff.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
v8 correctly implemented individual control capabilities, but they are exposed as separate expandable panels. Users must mentally combine findings, stale assets, asset statuses and evidence tasks.
The value is not more warnings; it is a review sequence that explains what matters, why, and how to resolve it without hiding unresolved risk.
PRIMARY OUTCOME
Turn the existing consistency, stale-asset and evidence tools into one efficient review workbench that reduces campaign rework and supports accountable handoff.
INSPECT BEFORE EDITING
Inspect backend review/evidence/consistency/brief-impact routes and pure services, migrations 029–031, Campaigns ReviewQueue UI, Library quality warnings, asset status mutations and manifest generation.
Catalog finding codes, severity, acknowledgment rules, stale-review states, evidence links and export blockers. Identify duplicates and conflicting severity labels.
IMPLEMENTATION REQUIREMENTS
Create a single Review workbench with filters: Blocking, Needs decision, Evidence/research, Resolved and All. Group by issue type, not by database table.
Each item shows affected asset(s), exact observed/canonical field where safe, detection limit, why it matters, accepted resolution paths and audit trail.
Support focused “Review next” navigation and keyboard operation. Bulk operations are allowed only for safe navigation/filtering; each factual acknowledgment or snapshot-keep decision remains explicit.
Integrate evidence creation/linking into the item drawer. Show permitted claim, source reference, checked date and reuse scope without asserting source truth.
After a resolution, recompute affected findings and move focus to the next item without losing filter state. Clearly distinguish automated resolution from user acknowledgment.
Show export impact: hard blocker, disclosed non-blocking reminder or external work. Never hide unresolved items from the manifest.
CONTENT AND INTERACTION REQUIREMENTS
Use labels such as “Conflict detected”, “Brief changed”, “Evidence needed”, “Acknowledged by you” and “Not detected by these checks”.
Avoid alarmist red everywhere. Severity communicates handoff risk, not legal judgment.
Empty state: “No open items in this view” plus the configured detection limits, never “Campaign approved”.
DATA, API, ANALYTICS AND SECURITY
Reuse existing finding/evidence tables and fingerprints. Add only additive audit fields required for reviewer/time/resolution source.
Sanitize evidence URLs and never fetch them server-side in this prompt. Enforce workspace ownership for evidence reuse.
Track review_item_opened/resolved with finding code, resolution category and severity only. Never send URLs, claim text, asset text or campaign names.
NON-NEGOTIABLE CONSTRAINTS
No global “Resolve all”, bulk acknowledgment, fake compliance badge or automatic proof verification.
No AI action for review, deterministic recomputation, evidence linking or status inspection.
Do not erase disappeared/resolved finding history required by the handoff record.
ACCEPTANCE CRITERIA
A reviewer can clear or explicitly acknowledge every item without leaving the Review section.
Reappearing fingerprints reopen correctly and retain audit history.
Evidence reuse cannot cross workspaces and deletion/soft-delete behavior remains correct.
Review counts on Overview, Review and Handoff agree.
VERIFICATION AND HANDOFF
Run consistency/evidence/brief-impact/review API tests, ownership and URL security tests, keyboard/mobile E2E, manifest snapshots and analytics privacy tests.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-05  |  Asset studios: output quality, editing and context transparency
Namen: Make each studio produce more usable, editable and reviewable campaign assets while reinforcing the shared brief instead of behaving like a generic prompt box.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The five studios are contractually aligned and inherit profile/brief context, but the perceived paid value still depends on output structure, editing control and clear proof boundaries.
The app must improve usefulness without reintroducing unsupported “production-ready” claims or increasing generation merely to create variants.
PRIMARY OUTCOME
Make each studio produce more usable, editable and reviewable campaign assets while reinforcing the shared brief instead of behaving like a generic prompt box.
INSPECT BEFORE EDITING
Inspect every studio route/component, generator shell, backend prompt registry/versioning, output schemas, quality guards, claim/placeholder handling, rewrite routes, usage settlement and Library serializers.
Create a channel-by-channel output contract: required sections, optional sections, structured fields used by consistency checks, evidence hooks, platform assumptions and export representation.
Review actual prompt text for duplicated brand/brief context, invented urgency/metrics, weak constraints, ambiguous CTA fields and unbounded prose.
IMPLEMENTATION REQUIREMENTS
Add a compact “Using this context” panel showing the approved brief version, audience, offer, primary message, CTA and restrictions with direct links to source fields. Do not display sensitive/internal values unnecessarily.
Before generation, show output structure and exact action cost. Disable generation with explicit missing-decision reasons rather than generic errors.
Improve schemas/prompts per channel: Website with page goal/sections/meta/FAQ/CTA; Email with sequence purpose, subject/preheader/body/CTA and plain-text-safe content; Social with platform/formats/hooks/captions and calendar planning only; Creative with concept/format/script/claim/evidence/testing notes; SEO with research question, intent, outline, metadata and verification checklist.
Add targeted manual editing with autosave, version history and structured-field editing for CTA/URL/terms/dates so consistency findings can be resolved without a full AI rewrite.
Offer bounded rewrite controls that preview what will change, preserve the prior version and consume one action only on successful model output. Keep manual edits free.
After generation, land on a review summary: what was created, inherited context, placeholders/claims, detected issues and next safe action.
CONTENT AND INTERACTION REQUIREMENTS
Use outcome-safe language: draft, review, adapt, verify, research. Do not say publish-ready, compliant, guaranteed, optimized or proven.
Channel copy must describe implemented outputs precisely. Social never implies scheduling/posting; Creative never implies rendered media; SEO never shows fabricated volume/difficulty/CPC/rank.
Failure copy states that the brief and previous version were preserved and whether an AI action was released.
DATA, API, ANALYTICS AND SECURITY
Version every changed prompt/schema. Golden eval fixtures must cover structure, CTA/terms/date fidelity, proof handling, placeholders and banned claims.
Use server idempotency and canonical action settlement. A malformed/unsafe result cannot partially overwrite an asset.
Analytics stores route/version/outcome/category only—never prompts, generated copy, proof, URLs or customer facts.
NON-NEGOTIABLE CONSTRAINTS
Do not add a chat interface that bypasses Brand Profile or Campaign Brief.
Do not create uncontrolled multi-variant batches or spend more than the disclosed action count.
Do not replace version history with in-place destructive editing.
ACCEPTANCE CRITERIA
Every studio has an explicit, tested output contract and consistent pre/post-generation flow.
Structured edits can resolve deterministic findings without regeneration.
Failed or invalid output preserves prior state and quota truth.
Cross-channel fixtures confirm shared offer/CTA/terms/date fidelity.
VERIFICATION AND HANDOFF
Run prompt golden evals, schema/guard tests, usage/idempotency/failure tests, all studio tests, Library integration, content-contract tests, E2E and fresh production build.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-06  |  Campaign-scoped asset library and visual version comparison
Namen: Elevate Library from a dense asset list into a professional review workspace where users can find, compare, edit and prepare campaign assets efficiently.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The current Library supports search, filters, rewrites, statuses, provenance, bulk archive/delete, version restore and text/Markdown/Word-compatible exports.
Its row-based interaction relies on many small controls, browser prompts and a `.doc` HTML export; this can feel like an admin utility rather than a paid creative workspace.
PRIMARY OUTCOME
Elevate Library from a dense asset list into a professional review workspace where users can find, compare, edit and prepare campaign assets efficiently.
INSPECT BEFORE EDITING
Inspect AssetLibrary.jsx, asset list/update/version/bulk routes, serializers, export helpers, status labels, campaign filters, review blockers and accessibility tests.
Confirm query pagination, search scope, large-library behavior, version snapshot format, archive/delete semantics and entitlements for every export.
IMPLEMENTATION REQUIREMENTS
Add campaign-first filtering and saved URL query state. From Campaign Assets, the campaign filter is fixed by route; global Library can switch campaign/type/status/platform/language.
Replace crowded row actions and window.prompt flows with an accessible asset detail drawer/page: preview, structured metadata, provenance, review status, evidence, versions and export actions.
Implement visual version comparison for supported structured fields and text blocks. Show Added/Removed/Changed clearly; allow restore only after preview and confirmation.
Provide manual edit/autosave with conflict handling and preserved version snapshot. Keep AI rewrite a secondary explicit action with cost disclosure.
Improve multi-select actions with a persistent action bar, exact count and safe archive/export. Permanent delete remains strongly confirmed and never acts on a stale hidden selection.
If adding real `.docx` export, use a maintained server-side OOXML library, deterministic styles and tests. Otherwise keep honest `.doc` wording and prioritize a campaign ZIP/Markdown packet over pretending it is DOCX.
CONTENT AND INTERACTION REQUIREMENTS
Use “Open”, “Edit”, “Compare versions”, “Restore this version”, “Export” and canonical statuses. Avoid unlabeled icon-only actions.
Every destructive or AI-spending action explains its effect before confirmation.
No-results states identify active filters and offer one clear reset.
DATA, API, ANALYTICS AND SECURITY
Do not load full asset bodies for every list row. Use bounded summaries and fetch detail/version content on demand.
Ownership, table allowlists and patch schema remain server-enforced. Prevent cross-type ID confusion and stale-version overwrites.
Track asset_opened, version_compared/restored and export_completed with type/status/format only.
NON-NEGOTIABLE CONSTRAINTS
Do not remove old versions or expose content in analytics/logs.
Do not label HTML `.doc` as `.docx`.
Do not allow bulk Ready/Published transitions that bypass review rules.
ACCEPTANCE CRITERIA
Library is usable with hundreds of assets without N+1 body/version fetches.
A user can understand and restore a prior version without browser prompts or accidental loss.
Campaign, provenance, status and blockers remain visible on asset detail.
Mobile/keyboard/screen-reader flows cover filters, drawer, compare, restore and export.
VERIFICATION AND HANDOFF
Run Library API/query/performance fixtures, version/concurrency tests, export snapshots, ownership/security tests, accessibility checks and desktop/mobile E2E.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-07  |  Professional handoff packet and client-ready export experience
Namen: Make campaign handoff a premium outcome: one coherent, reviewable package that a founder, client, designer or channel operator can understand without access to the app.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
v8 intentionally chose export-only handoff rather than pretending to support real-time collaboration. It already generates a review manifest and professional packet records.
The next step is to elevate packaging, navigation and auditability while preserving the honest boundary that Scalvya does not approve, publish or grant client accounts.
PRIMARY OUTCOME
Make campaign handoff a premium outcome: one coherent, reviewable package that a founder, client, designer or channel operator can understand without access to the app.
INSPECT BEFORE EDITING
Inspect ADR-001, review-manifest and review-packet endpoints, campaign completion rules, export helpers/formats, evidence references, asset serializers and existing download security.
List every required packet section and which server source owns it. Identify any content currently assembled client-side or duplicated across packet/manifest exports.
IMPLEMENTATION REQUIREMENTS
Create one Handoff screen with packet readiness, included assets, excluded assets, unresolved blockers/reminders, evidence references and exact export formats before download.
Generate the packet server-side from canonical campaign state. Include: campaign summary; approved brief version/date; deliverable plan; asset index; per-asset provenance/status; open/acknowledged findings; brief-change decisions; evidence references; research/publishing responsibilities; export timestamp and manifest version.
Offer deterministic Markdown and JSON manifest. Add a ZIP containing supported asset files plus manifest only if filenames, size limits, streaming/memory behavior and content disposition are safely implemented.
If real DOCX is implemented, create a polished but dependency-safe OOXML document and add render/snapshot tests. Never relabel the existing Word-compatible HTML file.
Provide packet preview and “What remains outside Scalvya” disclosure before export. Allow export with non-blocking reminders only when the user explicitly confirms; hard blockers follow existing contract.
Record the packet version/fingerprint and export event so later brief/asset changes show “Handoff packet is older than current campaign” without deleting old downloads.
CONTENT AND INTERACTION REQUIREMENTS
Use “Handoff packet”, “Review record”, “Prepared for your review” and “Publishing remains with you”. Do not say approved, certified, compliant, sent or delivered to client.
Write a concise cover summary for non-app readers. Preserve factual campaign terminology and disclose unresolved items prominently, not in fine print.
Filenames are human-readable, sanitized and collision-safe.
DATA, API, ANALYTICS AND SECURITY
The server owns packet composition and workspace authorization. Signed/temporary downloads must expire and never reveal storage paths or secrets.
Limit total packet/ZIP size and asset count; stream or fail clearly rather than exhausting function memory.
Track handoff_previewed and handoff_exported with format, asset_count_band and blocker_count_band only.
NON-NEGOTIABLE CONSTRAINTS
No public share link, email sending, invitations, comments or team roles in this prompt.
No packet may hide a known blocker or convert acknowledgment into approval.
No customer content in analytics, filenames beyond sanitized user-visible titles, or logs.
ACCEPTANCE CRITERIA
A person without Scalvya access can understand the campaign package and remaining responsibilities from the export.
Packet content exactly matches current canonical state and is reproducible for the same version.
Old packet staleness is visible after a material change.
Authorization, size, filename, format and unresolved-item tests pass.
VERIFICATION AND HANDOFF
Run packet/manifest snapshot tests, ZIP/DOCX tests if implemented, ownership/security/size tests, campaign-completion analytics tests and E2E preview/export.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-08  |  ICP-focused positioning, onboarding, pricing and lifecycle content
Namen: Make the product immediately legible and worth paying for by positioning the campaign-control outcome—not generic AI generation—while keeping every commercial and capability claim true.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
Scalvya’s strongest features now serve structured campaign work, review and handoff. The current landing still addresses a broad mix of solo founders and small teams, while Studio value is especially relevant to freelance marketers and boutique agencies.
A rebrand has just occurred. Name recognition is low, so the landing and onboarding must explain category, mechanism and value with exceptional clarity.
PRIMARY OUTCOME
Make the product immediately legible and worth paying for by positioning the campaign-control outcome—not generic AI generation—while keeping every commercial and capability claim true.
INSPECT BEFORE EDITING
Audit Landing, metadata/OG, Signup/Login/verification, onboarding, Dashboard empty/activation states, TrialPaywall, pricing cards, Account/Billing, cancellation, legal and lifecycle emails against actual routes and plan catalog.
Review analytics definitions and determine which ICP hypotheses can be tested without prematurely rewriting the entire product for an unvalidated segment.
IMPLEMENTATION REQUIREMENTS
Rewrite the landing around: problem (campaign drift/rework), mechanism (one approved brief + connected assets + review control), proof demonstration (transparent product example, not fake customer proof), paid jobs, boundaries and one CTA.
Keep the canonical promise or test one evidence-safe variant such as “Turn one approved offer into a consistent, client-ready campaign.” Do not ship multiple rotating headlines. Record the selected hypothesis.
Add two honest use-case paths under the same product: Launch my own campaign; Build campaigns for clients. They may change examples/onboarding guidance, not entitlements or core navigation.
Onboarding asks only role/use context needed to guide setup and never invents company size, urgency or outcome. Route both paths into the same Brand Profile → Campaign Brief contract.
Reframe pricing around completed jobs and revision capacity. Explain what every plan can accomplish, what is always free inside the control layer, exact AI actions/campaign/workspace limits and trial charge mechanics from canonical data.
Rewrite lifecycle emails for activation, unfinished first campaign, trial ending, payment failure/recovery and cancellation. Use generic campaign-state categories only; no asset/brief content in email.
Add content-contract tests for rebrand, canonical promise, ICP wording, five Create paths, trial/price derivation, boundaries and banned claims.
CONTENT AND INTERACTION REQUIREMENTS
Tone: direct, competent, specific and calm. Avoid hype, “all-in-one”, “effortless”, “10x”, “production-ready”, fake social proof and vague AI language.
Use a concrete anonymized campaign example that labels illustrative inputs and outputs. Do not fabricate results, customer names or performance metrics.
Every CTA says what happens next: Create free workspace, Build campaign brief, Start 3-day trial, Generate asset · 1 AI action, Review campaign, Export handoff.
DATA, API, ANALYTICS AND SECURITY
Prices/limits/savings/trial eligibility are rendered from server canonical catalog. Do not embed display prices in content constants or tests except canonical contract assertions.
Use role/use_case as bounded optional onboarding analytics. Never store company/client names in analytics.
Experiment one variable at a time and keep rollback copy/config simple.
NON-NEGOTIABLE CONSTRAINTS
Do not change the brand name, prices or plan limits in this prompt.
Do not claim collaboration, publishing, SEO data, compliance or client approval.
Do not show “Most popular” until real decision-quality evidence supports it.
ACCEPTANCE CRITERIA
A new visitor can answer who it is for, what painful work it replaces, how it works, what it does not do and when payment begins.
Landing, onboarding, paywall, pricing, Account and emails tell one consistent story.
Both owner and client-work paths reach first value without a forked product.
Content-contract and billing truth tests fail on drift.
VERIFICATION AND HANDOFF
Run content-contract, plan-catalog, trial eligibility, lifecycle email, metadata/SEO, legal, accessibility and public/auth E2E tests; rebuild and verify the bundle.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-09  |  Design system, accessibility, responsive polish and perceived quality
Namen: Raise perceived product quality through a consistent interaction system, accessible campaign workflows and mobile/desktop polish without replacing the established visual identity.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
Current functionality grew quickly across flow.css, route-specific classes and inline styles. Several v8 controls were added directly inside large route components.
Paid value can be undermined by crowded action rows, inconsistent cards, browser-native prompts, weak loading states and unclear hierarchy even when backend capability is strong.
PRIMARY OUTCOME
Raise perceived product quality through a consistent interaction system, accessible campaign workflows and mobile/desktop polish without replacing the established visual identity.
INSPECT BEFORE EDITING
Inventory global CSS/tokens, all button/input/select/card/badge/modal/drawer/table patterns, inline styles, icons, focus states, skeletons, errors, empty states and mobile breakpoints.
Run an accessibility audit on landing, auth, Dashboard, Brand, campaign cockpit, studios, Review, Library, Handoff, Account, paywall and admin scorecard.
Measure representative bundle, route rendering and API waterfall; identify large avoidable re-renders or sequential requests.
IMPLEMENTATION REQUIREMENTS
Define a lightweight reusable component/tokens layer for button variants, field groups, status/severity badges, callouts, tabs, drawers/dialogs, skeletons, empty states and destructive confirmation. Migrate high-traffic routes first.
Remove browser prompt/alert interactions from primary flows. Use accessible dialogs/drawers with focus trap, return focus, Escape handling and live validation.
Establish a clear hierarchy: page title, context, one primary action, secondary actions, supporting details. Reduce button walls and inline-style drift.
Ensure 44px touch targets, visible focus, WCAG AA contrast, proper landmarks/headings/labels, table alternatives, reduced-motion behavior and no information encoded by color alone.
Use route-level error boundaries/retry states where appropriate. Skeletons must match final layout; errors state what was preserved and how to recover.
Optimize only verified bottlenecks: parallelize independent reads, memoize pure summaries and lazy-load detail bodies/version comparisons. Do not introduce a large UI framework casually.
CONTENT AND INTERACTION REQUIREMENTS
Status color and wording stay consistent across Overview, Review, Library and Handoff.
Buttons use verb-first labels. Icon-only controls require accessible names and tooltips only as supplements.
Empty states remain job-focused and never pressure users to generate unnecessarily.
DATA, API, ANALYTICS AND SECURITY
Preserve semantic HTML and test selectors based on role/name rather than brittle CSS where possible.
Do not store presentation-only state in the database. Persist route/filter state only when it creates real resume value.
No sensitive content in client error reporting.
NON-NEGOTIABLE CONSTRAINTS
Do not rewrite the established visual brand, introduce a large component framework or change product behavior only for visual novelty.
Do not sacrifice contrast, target size, semantic structure or loading truth to make screens appear minimal.
ACCEPTANCE CRITERIA
Critical flows work keyboard-only and with screen-reader landmarks/names.
No overflow at 320px; cockpit, review and Library remain usable at tablet/desktop.
Visual components use one consistent token/pattern system and no primary flow depends on window.prompt/alert.
Performance changes have before/after evidence and no stale-bundle regression.
VERIFICATION AND HANDOFF
Run lint/a11y tests, Playwright desktop/mobile/keyboard journeys, reduced-motion/contrast checks, bundle/build comparison and complete visual QA of primary routes.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-10  |  Legal, billing, support and paid-production hardening
Namen: Close the gap between “configured and deployed” and a defensible paid service with fail-closed legal identity, rehearsed revenue recovery, monitoring and support evidence.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The product is documented as live on scalvya.com with live Stripe, Resend, migrations and cron. The repository still has a frontend legal fallback containing `legal entity TBD`, and live configuration does not itself prove every charge/cancel/refund/recovery path.
The latest commit exposes only successful Vercel deployment status; full release checks are not represented as a required main status.
PRIMARY OUTCOME
Close the gap between “configured and deployed” and a defensible paid service with fail-closed legal identity, rehearsed revenue recovery, monitoring and support evidence.
INSPECT BEFORE EDITING
Inspect legal config/API/fallbacks, Stripe checkout/webhook/customer portal/reconciliation, trial eligibility, email outbox/cron, admin scorecard, health/readiness endpoints, release-check, spend guard, deletion/export and runbooks.
Map each paid journey and failure: eligible trial, prior trial, incomplete checkout, delayed webhook, active, cancel at period end, canceled, payment failed, recovery, plan change, refund/support and duplicate event.
IMPLEMENTATION REQUIREMENTS
Fail closed when production legal identity, allowed origin, live price allowlist, webhook secret, sender identity or required cron secret is missing. Customer legal pages must never fall back to placeholders.
Add a production-safe transaction rehearsal runbook with evidence fields for exact commit, low-value live charge, webhook events, entitlement, cancel, recover/reactivate, portal, refund/support and anonymized receipt IDs. Do not automate destructive/refund actions without owner authorization.
Add health/readiness monitoring for database, migration version, provider configuration presence, outbox backlog/dead letters, webhook backlog/reconciliation, AI spend ceiling and bundle/version. No secret values or customer content.
Create actionable structured alerts/log categories and a lightweight incident runbook. Use an external processor only after configuration and privacy/subprocessor disclosure are updated.
Exercise account export/delete across every v8/v9 table and record deletion receipt/failure recovery. Ensure billing cancellation and data deletion failure cannot silently produce a false success.
Protect admin routes with allowlist/role, audit access and no content exposure. Remove or hide admin navigation for non-admins rather than relying only on an honest 403 page.
CONTENT AND INTERACTION REQUIREMENTS
Billing/legal/support copy distinguishes automatic system state from owner/manual evidence.
Errors include a request ID and user recovery action without raw provider messages.
Support expectations remain honest; no SLA unless operationally staffed and published.
DATA, API, ANALYTICS AND SECURITY
Webhook processing is signature-verified, idempotent, replay-safe and reconciled. Release checks never print secrets.
Monitoring properties exclude email, campaign/asset content, evidence URLs and payment details.
Document owner, deadline, acceptance evidence and rollback for every external item.
NON-NEGOTIABLE CONSTRAINTS
Do not mutate live Stripe, Supabase, Vercel, Resend, DNS or cron from Claude Code without explicit owner authorization.
Do not mark GO from mocks, env presence or a Vercel deployment alone.
Do not weaken fail-closed behavior for previews; use explicit preview/test modes.
ACCEPTANCE CRITERIA
No production path renders a legal placeholder or unknown price/plan.
A frozen commit has documented live charge/cancel/recovery/refund evidence before cohort expansion.
Monitoring detects core service, billing, email and spend failures without accessing content.
Export/delete and rollback drills have evidence and named owners.
VERIFICATION AND HANDOFF
Run release-check in secret-safe test fixtures, billing/webhook/reconciliation tests, legal config tests, email/cron tests, deletion/export tests, failure injection and live rehearsal only as an owner checklist.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-11  |  Value analytics, beta learning and product pruning
Namen: Use real behavior and interviews to prove that users complete and revisit campaigns; stop adding features when the core control loop is not producing repeat value.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
v8 defines an idempotent value funnel and experiments, but no validated cohort evidence is yet present. Metrics such as activation, D7 and conversion remain hypotheses.
The app now has enough capability. Scaling generation or acquisition before understanding completion and return risks increasing support and AI costs without product-market evidence.
PRIMARY OUTCOME
Use real behavior and interviews to prove that users complete and revisit campaigns; stop adding features when the core control loop is not producing repeat value.
INSPECT BEFORE EDITING
Inspect docs/VALUE_ANALYTICS_V8.md, analytics taxonomy/schema/dedupe, admin scorecard, cancellation reasons, AI cost ledger and new cockpit/review/handoff events.
Verify every canonical milestone is server-confirmed where durable, deduped and free of content/PII. Identify duplicated legacy events and ambiguous definitions.
IMPLEMENTATION REQUIREMENTS
Update the funnel for the cockpit: workspace created → minimum profile → brief approved → deliverable plan saved → first asset ready → first finding resolved if applicable → handoff exported → D7 campaign reopened/re-exported → subscription retained.
Build an admin cohort view with numerator, denominator, date window, cohort definition and no-data state. Segment only by safe plan/use-case categories with adequate sample size.
Operationalize three four-week tests: owner vs client-work onboarding; campaign Overview next action; handoff preview before trial/upgrade. One variable and one primary metric each.
Define interview triggers for drop-off after brief, first generation, first blocker and first export. Provide consented interview script focused on lost time, rework, confidence and willingness to pay—not desired feature lists.
Add a product-pruning review: list routes/features with usage, user job and maintenance/safety cost. Hide/deprecate only after preserving data access and measuring impact.
Set stop criteria: near-zero campaign completion, near-zero D7 return among completers, high unresolved-blocker abandonment, refund/complaint spike or adverse unit economics. Stop acquisition and interview before adding generators.
CONTENT AND INTERACTION REQUIREMENTS
Metrics are decision aids, not marketing claims. Never expose internal rates as customer proof without valid consent and statistical/context review.
Cancellation/interview copy is optional, neutral and never blocks cancellation.
Use no fake benchmark, vanity generation target or arbitrary “healthy” score.
DATA, API, ANALYTICS AND SECURITY
Enforce fixed enums/bounded slugs; reject unknown analytics properties. Retain/anonymize/delete according to the existing privacy contract.
Analytics failure never blocks user value. Server milestones use deterministic dedupe keys.
AI cost per activated/completed/retained account is computed from ledger data without customer content.
NON-NEGOTIABLE CONSTRAINTS
Do not widen above the documented capped cohort until operational and value gates pass.
Do not optimize click-through or generation volume at the expense of completion/review quality.
Do not remove user data access when pruning a surface.
ACCEPTANCE CRITERIA
Every metric has trigger, owner, allowed fields, denominator, window and product decision.
Cohort dashboard distinguishes no data, insufficient data and below hypothesis.
Experiments roll back without data corruption.
A weekly beta review can decide continue, change, interview, pause or prune.
VERIFICATION AND HANDOFF
Run analytics contract/dedupe/privacy tests, admin authorization/no-data tests, cancellation tests and verify cohort queries against synthetic fixtures.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

SC-V9-12  |  Integrated release candidate and final product-quality gate
Namen: Freeze, verify and document a coherent v9 release candidate across content, UX, data, billing and operations without masking skipped live checks.
COPY INTO CLAUDE CODE — START
ROLE AND OPERATING MODE
You are Claude Code working directly in primocera/LaunchBloom. Implement the change in the real product; do not stop at recommendations, wireframes, pseudo-code or a copy deck.
Before editing, read AGENTS.md, CLAUDE.md, README, package scripts, current git status, migrations, product/content contract tests and the newest handoff/go-no-go documents. Preserve unrelated work. Never use destructive git commands or mutate live providers/data.
Preserve every item in the Scalvya product contract included with this prompt pack. Treat backend behavior, schemas, entitlements and tests as technical truth; correct any customer promise that is not supported.
Start by confirming the current HEAD and comparing it with the reviewed baseline. If later changes already solve a requirement, verify them and extend only the remaining gap. Do not create duplicate components, endpoints, event names, tables or sources of truth.
Work as one reviewable vertical slice. Use additive migrations, feature flags and rollback paths when data or behavior changes. One prompt equals one intentional commit unless the repository instructions explicitly require a different workflow.
WHY THIS MATTERS NOW
The v9 changes span navigation, campaign logic, studios, Library, export, content and operational controls. Individually green prompts can still create cross-route drift or stale generated bundles.
A final pass must prove the complete paid job from first visit to repeat handoff, not just component tests.
PRIMARY OUTCOME
Freeze, verify and document a coherent v9 release candidate across content, UX, data, billing and operations without masking skipped live checks.
INSPECT BEFORE EDITING
Review every v9 commit and migration in order. Confirm feature flags/defaults, backfill requirements, data ownership, rollback and docs.
Trace all public/auth/account states and the complete campaign journey on desktop/mobile/keyboard. Compare against product contract and content tests.
IMPLEMENTATION REQUIREMENTS
Freeze an RC commit and create docs/GO_NO_GO_V9.md with automated evidence, live evidence, P0/P1/P2, owners, deadlines, mitigations, rollback triggers and a signed verdict.
Run migration/backfill dry runs on representative anonymized fixtures; test idempotency and rollback flags. Never run production backfill from this prompt.
Execute browser journeys: landing → free workspace → Brand Profile → campaign brief → approval → deliverable plan → trial/checkout branch → first asset → review/finding/evidence → Ready → Library/version → handoff export → return and revise.
Exercise failure journeys: provider timeout/malformed output, stale brief, database partial failure, duplicate webhook, email dead letter, spend ceiling, unauthorized admin/evidence, expired session, payment failure and export blocker.
Audit final copy, metadata, legal, rebrand, emails and generated frontend bundle. Remove debug flags, dead code, obsolete comments and documented superseded paths only when safe.
CONTENT AND INTERACTION REQUIREMENTS
The release document uses exact results and timestamps. “Passed locally”, “deployed”, “configured” and “observed live” are separate statuses.
No customer-facing placeholder, unsupported capability or outdated LaunchBloom name remains on current surfaces.
DATA, API, ANALYTICS AND SECURITY
Pin migration/rule/prompt/manifest versions and build hash. Release checks are deterministic and secret-safe.
Verify analytics/email/log redaction, export/delete completeness and admin authorization after all schema changes.
NON-NEGOTIABLE CONSTRAINTS
Do not merge/release when any P0 is unresolved or when billing/legal/data safety is unverified.
Do not convert skipped browser/live tests into a pass.
Do not add new scope during the final gate; file follow-up issues with severity instead.
ACCEPTANCE CRITERIA
All automated gates pass at the exact frozen commit and are visible in CI.
No critical journey contradicts the product contract or loses user work on retry/failure.
Live evidence is present for money-taking and operational paths before capacity expansion.
The final verdict is reproducible and names every remaining risk.
VERIFICATION AND HANDOFF
Run the complete repository check, all tests, production build/freshness, Playwright public/auth/mobile, release-check, failure injection and owner-controlled live rehearsal.
Run git diff --check and inspect the entire diff for duplicated truth, leaked content/PII, secrets, stale generated assets, accidental feature promises, inaccessible states and unrelated edits.
Final response: lead with the user outcome; list changed files by product area, migrations/config, events, exact commands/results, assumptions, skipped/live checks and remaining P0/P1/external blockers. Never claim a check passed when it was not run.

Priloga A — skupni definition of done
User value: change removes a real decision, rework, failure or trust gap; it does not merely add output or another destination.
Truth: UI, emails, pricing, trial, statuses, safety and publishing boundaries match server behavior and canonical configuration.
Control: users can see source/effect, preview material changes, keep/edit/remove/undo where promised, and retain access to their data.
Failure: provider/database/payment failure does not silently lose work, corrupt state, duplicate billing or falsely consume entitlement.
Privacy/security: content, prompts, journal/check-in, allergies, evidence URLs, custom names and payment details do not leak to analytics/logs/email.
Accessibility/quality: keyboard, screen reader, 320px mobile, reduced motion, focus and recovery states are verified.
Operations: migrations, backfill, flags, rollback, monitoring and owner live checks have exact evidence and no secret output.
Scale: acquisition/cohort expands only after the app-specific completion/return/cost and hard safety/billing gates pass.
Priloga B — obvezni zaključni report Claude Code
Outcome and the specific paid user problem solved.
Changed files grouped by UX/content, backend/data, commercial/safety and tests/docs.
Migrations, backfill, feature flags, rollout and rollback instructions.
Analytics events: exact trigger, owner, dedupe, allowed and prohibited fields and product decision.
Exact commands and pass/fail/skipped results; frozen commit and final git status.
Product-contract invariants preserved and new regression/content-contract tests.
P0/P1/external blockers with owner, required evidence and acceptance check.
Unrelated pre-existing work preserved; no destructive git action or live provider mutation.