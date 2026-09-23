# CLAUDE.md

> ## ⚠️ Prompt-pack scope note (binding, updated for v24)
> **v24 status (2026-09-23):** the release is **PENDING OWNER RC** — `launch:gate`
> computes capped-beta and public-paid **NO-GO** until a green release-candidate
> run, an exact deploy (`GET /health` version) and post-deploy readiness exist at
> ONE v24 FINAL SHA (`docs/evidence/OWNER_CHECKLIST_v24.md`). That is a
> release-integrity hold, not a product regression. The ordered live-money A–H
> rehearsal is complete (H/refund real Stripe time 2026-09-05T16:11Z, after G),
> Stripe ownership enforcement is probe-verified, the dependency audit is 0, and
> the data-rights export/delete drill passed on 2026-09-21. v23 computed GO, but
> its CI provenance was not exact-SHA: no release-candidate run ever had the v23
> candidate's own head SHA. See `docs/launch/launch-state.json`. Do **not** invent a new
> engineering / hardening / elevation / scale / security pack by *auditing the repo
> for gaps you were not asked about* — that turned into an infinite loop for 5
> versions, so a generic "the previous prompts are done, check the repo, write the
> next ones" defaults to a **MARKETING / DISTRIBUTION / GTM** pack (positioning,
> channels, landing→trial, the bounded beta cohort, content/SEO — copy and plans,
> never code). Full brief: `docs/V20_MOVING_TOWARD_MARKETING.md`.
>
> **Approved exception — v21 MVP-launch-closure (owner decision, 2026-08-22):** the
> owner explicitly authorised the narrow billing closure in
> `Scalvya_MVP_Launch_Closure_v21.docx` (finish canonical Stripe ownership /
> app_user_id billing identity, sunset the price-only fallback). That work is
> shipped on branch `v21` (SV-21-01). This exception is scoped to those named
> gaps — it is **not** a licence to resume open-ended hardening; anything beyond
> the v21 doc still defaults to the marketing pack above.
>
> **Approved exception — v22 Final MVP billing fix (owner decision, 2026-08-29):**
> the owner explicitly authorised Prompt 1 of `Scalvya_Final_MVP_Fix_Prompts_v22.docx`
> — closing the two verified v21 billing-correctness DEFECTS the owner named
> directly (not a self-directed repo audit). Shipped on branch `v22` (SV-22-01):
> **Defect A** — migration 039's PARTIAL unique index on `customers(app_user_id)`
> is not an inferable arbiter for the predicate-less `ON CONFLICT (app_user_id)`
> PostgREST emits, so migration `040` swaps it for a NON-partial unique index (real
> PostgreSQL/pglite test proves it) + a readiness probe; **Defect B** —
> `resolveEntitlement`/`planFor` now resolve the customer by the canonical
> `findCustomerRow` (stable `app_user_id` under enforcement) so the plan display
> and duplicate-subscription guard survive an email change; plus 038's UUID-cast
> backfill hardened to exact validation. Scoped to those named defects only. The
> owner-only production steps (apply migrations 038/039/040, backfill `app_user_id`,
> set `STRIPE_OWNERSHIP_ENFORCED=1`, run the live-money A–H rehearsal) are now
> **machine-verified** by the v23 owner probe + corrected rehearsal record (see the
> v23 exception below). Anything beyond the v22 doc still defaults to the marketing pack above.
>
> **Approved exception — v23 Nujne MVP izboljšave (owner decision, 2026-09-21):**
> the owner explicitly authorised Prompt 2 of `Nujne_MVP_Izboljsave_Scalvya_v23`
> — a scoped safe-paid-MVP correction, named directly by the owner (not a
> self-directed repo audit). Shipped on branch `v23` (SV-23-01/02/03/04): **(A)**
> production dependency patch (express 4.22.3 / body-parser 1.20.8 / qs 6.16.0,
> `npm audit --omit=dev` = 0), staying in the 4.x line; **(B)** a mandatory
> fail-closed `npm audit` step in `release-candidate.yml` with a SHA-pinned JSON
> artifact + contract test (`check-audit.js`); **(C)** a launch-state cross-field
> invariant — the manifest may not claim `enforcement_active`/`paid_ready` unless
> migrations 038-040 are probe-verified; **(D)** the rehearsal validator now
> enforces time-monotone A–H, which caught a data-entry timestamp on the recorded
> H; **(E)** the honest verdict. RESOLUTION (2026-09-21): the owner supplied the
> real evidence — the read-only migration 038-040 probe
> (`docs/evidence/2026-09-21-migration-038-040-probe.json`: app_user_id arbiter
> non-partial UNIQUE, `stripe_ownership_uniqueness_ready()` = true), and the Stripe
> dashboard showing the H/refund actually occurred `2026-09-05T16:11Z` (after G),
> so the record's H timestamp was corrected to the real value and
> `rehearsal:validate` passes. `migrations.ownership_enforcement` = `applied_verified`,
> `live_money_rehearsal` = observed, `P1-live-money-unrehearsed` closed —
> **`public_paid` = GO** (evidence-based), `capped_beta` = GO. The re-cut is now
> DONE (2026-09-21): the candidate is re-pinned to the CI-green rc/v23 commit, all
> 11 checks re-observed there, and `launch:gate` is fully green. Still owner-only:
> deploy the pinned candidate on Vercel and confirm readiness, the test-charge
> refund + cancel, and the data-rights export/delete drill (Prompt 3). Scoped to
> the v23 doc only.
>
> **Approved exception — v24 Finalni MVP release popravki (owner decision, 2026-09-23):**
> the owner explicitly authorised Prompt 1 of `Finalni_MVP_Release_Popravki_Scalvya_v24`
> and lifted the no-engineering default for it. It names release-integrity gaps from
> the 2026-09-22 independent audit; it is not a self-directed repo audit. Shipped on branch
> `v24` (SV-24-01): **(A)** one consistent active release record —
> `CERTIFICATION_v23.md` and `OWNER_CHECKLIST_v23.md` reconciled and added to
> `active_documents`, and the active-doc validator now reads Historical sections
> as history and fails on DONE-vs-NOT-RUN steps, a wrong A–H range/count and a blocker
> one document calls open while another calls it closed; **(B)** `GET /health`
> returns a redacted `version` (12-hex prefix of `VERCEL_GIT_COMMIT_SHA`, `-dev`
> fallback); **(C)** real RC provenance — `rc_runs` records each GitHub Actions
> run (URL, head_sha, conclusion, times, jobs), and a `passed_ci` claim or frozen
> candidate needs a green run at that exact SHA. The candidate is
> `pending_owner_rc` (no SHA), so a FINAL SHA is frozen by its RC run and tag,
> never by a later manifest commit; **(D)** the unused nested
> `backend/package-lock.json` is removed (one-manifest test). Prompts 3 (owner
> deploy) and 4 (independent certification) remain owner-run. Scoped to the v24
> doc only.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Scalvya (historical names, kept only for migration history: OfferFlow AI, LaunchBloom) — a SaaS **campaign-control workspace** that turns one approved offer/brief into connected website, email, social, ads/creative and SEO-idea assets that stay consistent on positioning, claims and CTA.

**Canonical flow (do not fork it):** Brand Profile → Campaign Brief → Create → Review → Library → Export. The user fills a Brand Profile, defines and **approves** a Campaign Brief (a human decision, not an AI-strategy purchase), then Create runs the studios against that approved brief; generated assets are reviewed, kept in the Library, and Export packages the user-approved drafts.

**ICP:** the primary customer is **freelance marketers and boutique agencies** (client work); **solo founders / small brands** are a secondary use case served by the *same* product, never a separate one.

**Honest boundaries (must hold in customer copy and model instructions):** Scalvya does **not** publish, post, schedule or send anything; it reports **no** SEO search-volume, difficulty or ranking data (ideas only); it does **not** give legal/compliance approval; and **export means packaging the user's approved drafts** for handoff, not sending them. A generated asset is a **complete draft that requires human review** — never described to the customer as "send-ready", "production-ready" or "ready to paste". The content contract (`backend/tests/content-contract.test.js`) enforces this and forbids the retired brand names on customer-visible surfaces.

**Marketing studios (upgrade prompts 5-18):** `backend/routes/assets.js` mounts five `/api/ai/generate-*` routes (website-kit, email-flow, campaign-emails, social-assets, creative-assets), each plan-gated on `asset_generations`, workspace-scoped, saving into the `004_marketing_assets` tables (`website_pages`, `email_assets`, `social_assets`, `creative_assets`, `seo_assets`). Schemas live in `backend/lib/schemas.js` (exported separately from `SECTION_SCHEMAS`). The frontend generator studios share `app-src/routes/studios/generator.jsx`. Non-blocking `quality_warnings` come from `backend/lib/quality-checks.js`.

**Pricing:** a **3-day paid Stripe trial** then starter/pro/studio (monthly or yearly). `payments.js` adds `trial_period_days: 3` for first-time subscribers only; `planFor()` returns `'trial'` while `trialing`. Price→plan mapping uses `STRIPE_PRICE_{STARTER,PRO,STUDIO}_{MONTHLY,YEARLY}` (legacy `_BUSINESS` → studio). Limits per plan live in `backend/lib/plan-limits.js`; `free` is a very limited public/demo plan (0 full kits until the trial starts).

The build follows the prompt playbook in `OfferFlow_AI_Claude_Code_Prompts.docx`, but the stack was deliberately changed from the playbook's Next.js/OpenAI to a **ConversionForge-derived architecture** (the sibling ConversionForge project). When in doubt about a pattern, look at how ConversionForge does it.

## Commands

```bash
npm install
npm run dev              # node --watch backend/server.js (API)
npm run dev:app          # vite dev server (frontend)
npm test                 # node --test backend/tests/*.test.js
npm run lint             # eslint backend app-src api
npm run build:app        # vite build → committed app/ bundle
npm run check            # lint + test + build:app + check:app-fresh
node -c file.js          # quick syntax-check a changed file
```

Backend needs a `.env` (copy `backend/.env.example`): Supabase service-role, Stripe, Anthropic, SESSION_SECRET. Stripe webhooks locally: `stripe listen --forward-to localhost:3002/api/webhooks/stripe`.

## Architecture

**Stack:** Node.js + Express (CommonJS, plain JS — no TypeScript, no Zod), Supabase Postgres via service_role client, Anthropic Claude (`claude-opus-4-8`) with structured JSON output, Stripe Checkout + webhooks, optional Resend. Frontend is a **real, shipped** Vite + React + react-router-dom v7 app in `app-src/` (Landing, auth, Brand Profile, Campaigns, Create, the five studios, Asset Library, Account, Admin), built into the committed `app/` bundle and served statically on Vercel; `npm run check:app-fresh` guards that `app/` matches `app-src/`.

**Identity model (Supabase Auth):** `backend/lib/auth.js` `requireAuth` authenticates each request from the HttpOnly `sb_access` cookie (validated against Supabase Auth); an expired access token is silently refreshed from the `sb_refresh` cookie. It attaches **`req.userId` (a stable Supabase user UUID)** and `req.userEmail`. The stable UUID is the identity and the primary owner key — `workspaces.user_id` owns data; **`user_email` is mutable contact/display data and a legacy fallback** only for pre-`user_id` rows (get-or-create adopts and stamps them) and for the `customers` billing table keyed by email. Every service-role query is scoped by `user_id` (with the `user_email` fallback for un-backfilled rows). `SESSION_SECRET` is still used by the inherited credit helpers, not for identity. (The old stateless-HMAC/localStorage token is gone.)

**Plan gating:** every AI route is wrapped in `planGate(feature)` from `backend/lib/plan-limits.js` — it authenticates, resolves the plan via `planFor()` (cached), ensures the workspace, and enforces the per-feature limit by counting rows (monthly for paid plans, lifetime for `trial`/`free`). Returns 402 code `UPGRADE` when a limit is hit; failed generations never count. (`backend/lib/gate.js` `creditGate` is the inherited ConversionForge credit system and is not wired into the AI routes.)

**Plan resolution:** `routes/customers.js` `planFor(email)` is the single source of plan truth — active/trialing subscription row, or a succeeded one-time payment (= lifetime). Price→plan mapping comes from env (`STRIPE_PRICE_STARTER/_PRO/_BUSINESS`), not hardcoded IDs.

**AI generation:** `backend/lib/ai.js` `generateJson({system, prompt, schema})` calls Claude with `output_config: { format: { type: 'json_schema', schema } }` so responses parse directly into the shapes in `backend/lib/schemas.js`. Those schemas mirror the Supabase jsonb columns 1:1 — a generation result is stored without transformation. The shared BASE_SYSTEM enforces the product rules: guided business workflow (not a generic content generator), ethical marketing, no income promises.

**Data flow:** onboarding_answers → positioning_outputs → offers (3 options, user picks one) → launch_kits (one row per kit, sections as jsonb + exploded into content_items/email_items/ad_ideas/seo_items for per-item editing). Every generated asset must stay tied to its offer via `offer_id`/`launch_kit_id`.

**server.js mount order matters (inherited from CF):**
1. Stripe webhook router BEFORE `express.json()` (needs raw body for signature verification)
2. Routes with their own body parsers before the global 10kb JSON parser
3. Restrictive CORS allowlist (`ALLOWED_ORIGINS`) after any public endpoints
4. On Vercel the app is imported (no `listen`); Railway/local runs `listen`

## Rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or any secret to client code.
- Ownership checks: every workspace-scoped query must filter by both id AND `user_email` (service_role bypasses RLS, so the route IS the security boundary).
- UI palette when frontend work starts: bg #F8F7F4, cards #FFF, text #111827, muted #6B7280, primary #2563EB, success #10B981, border #E5E7EB.
- Ask before deleting major files or changing architecture.
