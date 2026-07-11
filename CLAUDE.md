# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OfferFlow AI — a SaaS web app that takes solopreneurs, creators, freelancers, coaches and small service providers **from idea to offer to launch**. The user answers onboarding questions; the AI generates positioning → 3 offer options → a full "Launch Kit" (landing page copy, 30-day content plan, 7-email sequence, Meta ad ideas, SEO starter plan, weekly action plan).

The build follows the prompt playbook in `OfferFlow_AI_Claude_Code_Prompts.docx`, but the stack was deliberately changed from the playbook's Next.js/OpenAI to a **ConversionForge-derived architecture** (sibling project at `c:\Users\primo\conversionForge`). When in doubt about a pattern, look at how ConversionForge does it.

## Commands

```bash
cd backend
npm install
npm run dev      # nodemon server.js (default port 3002)
npm start        # node server.js
node -c file.js  # syntax-check a changed file (no test suite yet)
```

Backend needs a `.env` (copy `backend/.env.example`): Supabase service-role, Stripe, Anthropic, SESSION_SECRET. Stripe webhooks locally: `stripe listen --forward-to localhost:3002/api/webhooks/stripe`.

## Architecture

**Stack:** Node.js + Express (CommonJS, plain JS — no TypeScript, no Zod), Supabase Postgres via service_role client, Anthropic Claude (`claude-opus-4-8`) with structured JSON output, Stripe Checkout + webhooks, optional Resend. Frontend (planned): Vite + React + react-router, reusing ConversionForge's `app-src/` landing components with OfferFlow copy.

**Identity model (no Supabase Auth):** `backend/lib/auth.js` mints stateless HMAC session tokens (`email|exp` signed with SESSION_SECRET, 30 days). The session email IS the identity; `workspaces.user_email` links data to accounts. Free accounts get 10 lifetime credits tracked in a Supabase Storage bucket (`offerflow-data/credits.json`); active subscribers are unlimited.

**Credit gating:** every AI route is wrapped in `creditGate(cost)` from `backend/lib/gate.js` — it authenticates, checks plan (cached 10 min), and rejects free users out of credits. Credits are charged only **after** success via `settleCredit(req)`; failed generations never cost anything.

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
