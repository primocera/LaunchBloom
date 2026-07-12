# OfferFlow AI (LaunchBloom) — Deployment Guide

Stack: Express API + Vite/React frontend, deployed as one Vercel project.
Live: https://launch-bloom.vercel.app · Repo: https://github.com/primocera/LaunchBloom

## 1. Supabase setup

1. Create a Supabase project (separate from any other app).
2. In the SQL Editor, run the migrations **in order**:
   - `backend/migrations/001_init.sql`
   - `backend/migrations/002_items.sql`
   - `backend/migrations/003_users.sql`
3. Storage: the app auto-creates the `offerflow-data` bucket on first use
   (credits + daily AI usage). No manual step needed.
4. Grab from **Project Settings → API**:
   - Project URL → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never in client code)

> RLS is enabled on all tables, but the API uses the service_role key, which
> bypasses RLS — **the Express routes are the security boundary**. Every
> workspace-scoped query filters by `user_email` from the session token.

## 2. Required environment variables

Documented in `backend/.env.example` (copy to `backend/.env` for local dev).

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-only |
| `SESSION_SECRET` | yes | long random string; changing it signs everyone out |
| `ANTHROPIC_API_KEY` | for real AI | empty = free mock mode (sample copy, 0 cost) |
| `ANTHROPIC_MODEL` | recommended | `claude-haiku-4-5` (~$0.08/kit) |
| `MAX_AI_CALLS_PER_DAY` | recommended | global daily spend ceiling, default 300 |
| `STRIPE_SECRET_KEY` | for payments | |
| `STRIPE_WEBHOOK_SECRET` | for payments | from the webhook endpoint (step 3) |
| `STRIPE_PRICE_STARTER/_PRO/_BUSINESS` | for payments | price IDs from Stripe Products |
| `PUBLIC_URL` | optional | checkout redirect base; falls back to request origin |
| `ALLOWED_ORIGINS` | optional | extra CORS origins; `*.vercel.app` auto-allowed |
| `RESEND_API_KEY` | optional | transactional email |

## 3. Stripe setup

1. Create 3 recurring Products (Starter €12, Pro €29, Business €59) →
   copy each **price ID** into `STRIPE_PRICE_*` env vars.
2. Developers → Webhooks → Add endpoint:
   - URL: `https://<your-domain>/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid`, `invoice.payment_failed`, `customer.created`, `customer.updated`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Local testing: `stripe listen --forward-to localhost:3002/api/webhooks/stripe`

## 4. Vercel deployment

1. Import the GitHub repo into Vercel. No framework preset needed —
   `vercel.json` routes everything: `/api/*` → serverless Express
   (`api/index.js`), `/app/*` → the **committed** `app/` build output.
2. Add all env vars from step 2 (Production scope).
3. Frontend changes require rebuilding the committed bundle before pushing:
   ```bash
   npm run build:app   # writes app/ — commit it
   ```
   (The script is deliberately not named `build` so Vercel doesn't run it.)
4. Push to `main` → Vercel auto-deploys.

## 5. Post-deployment smoke test

- [ ] `GET https://<domain>/health` → `{"status":"ok","ai":"live","model":"claude-haiku-4-5"}` (`"ai":"mock"` means the API key env var is missing)
- [ ] Landing page loads at `/`, app at `/app` redirects to login
- [ ] Sign up with a fresh email → lands on dashboard
- [ ] Sign out → protected routes redirect to `/app/login`
- [ ] Wrong password → friendly error, unknown email → "create one below"
- [ ] Onboarding → Generate positioning → offers (3) → pick one → launch kit
- [ ] Launch kit opens; each studio (landing/content/emails/ads/SEO/weekly) shows items
- [ ] Regenerate one section works; edits save
- [ ] Free-plan limits kick in on the 2nd kit (upgrade prompt, no crash)
- [ ] If Stripe configured: pricing → checkout (test card `4242 4242 4242 4242`) → webhook marks plan active
- [ ] Browser devtools: no requests expose service_role key or Anthropic key

## 6. Costs & guardrails

- Model: `claude-haiku-4-5`, ~$0.08 per full launch kit (7 AI calls).
- Three protection layers: prepaid Anthropic credits (no auto-reload),
  per-plan usage limits (`backend/lib/plan-limits.js`),
  global `MAX_AI_CALLS_PER_DAY` ceiling.
- Failed generations are never charged to the user (credits settle after success).
