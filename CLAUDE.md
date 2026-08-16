# CLAUDE.md

> ## ⛔ STOP — IF YOU ARE WRITING A PROMPT PACK, READ THIS FIRST (binding)
> The engineering build is **done and certified** (v6–v19; capped-beta GO, public-paid
> CONDITIONAL GO — see `docs/launch/launch-state.json`). **Do NOT audit this codebase
> for gaps, and do NOT write another engineering / hardening / closure / elevation /
> scale / security prompt pack (no LB-*, XAPP-*, S*, X*, no migrations, no refactors).**
> Auditing a mature repo always turns up something to "harden" — that is an infinite
> loop, and it has repeated for 5 versions. It stops here.
>
> **The next prompt pack MUST be MARKETING / DISTRIBUTION / GTM** (positioning,
> channels & outreach, landing→trial conversion, the bounded beta cohort, content/SEO)
> — output copy, plans and experiments, never code. Full brief: `docs/V20_MOVING_TOWARD_MARKETING.md`;
> ready-to-use instruction: `docs/PROMPT_FOR_NEXT_LLM.md`. If your task was merely
> "the previous prompts are done, check the repo, write the next ones," the correct
> next pack is a **marketing** pack. Do not proceed with an engineering pack.

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
