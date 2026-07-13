# OfferFlow AI (LaunchBloom) — Deployment Guide

Stack: Express API + Vite/React frontend, deployed as one Vercel project.
Live: https://launch-bloom.vercel.app · Repo: https://github.com/primocera/LaunchBloom

## 1. Supabase setup

1. Create a Supabase project (separate from any other app).
2. In the SQL Editor, run the migrations **in order**:
   - `backend/migrations/001_initial_schema.sql`
   - `backend/migrations/002_studio_status.sql`
   - `backend/migrations/003_users.sql`
   - `backend/migrations/004_marketing_assets.sql` — website/email/social/creative/SEO asset tables for the new studios
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
| `STRIPE_PRICE_{STARTER,PRO,STUDIO}_{MONTHLY,YEARLY}` | for payments | 6 recurring price IDs (starter/pro/studio × monthly/yearly) |
| `STRIPE_PRICE_STARTER/_PRO/_BUSINESS` | optional | legacy single-price vars for old accounts (`_BUSINESS` → studio) |
| `PUBLIC_URL` | optional | checkout redirect base; falls back to request origin |
| `ALLOWED_ORIGINS` | optional | extra CORS origins; `*.vercel.app` auto-allowed |
| `RESEND_API_KEY` | optional | transactional email |

## 3. Stripe setup

1. Create 3 recurring Products, each with a **monthly and a yearly** Price:
   Starter (€12.99 / €99), Pro (€24.99 / €199), Studio (€59 / €499) → copy the
   6 price IDs into `STRIPE_PRICE_{STARTER,PRO,STUDIO}_{MONTHLY,YEARLY}`.
   Keep the Stripe prices as plain recurring prices — the **3-day free trial is
   applied in code** (`subscription_data.trial_period_days: 3`) for first-time
   subscribers only, so returning customers are never double-trialed.
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
- [ ] Dashboard shows "Next best actions" after a kit exists
- [ ] New generator studios return structured data and save assets:
  - [ ] `POST /api/ai/generate-website-kit`
  - [ ] `POST /api/ai/generate-email-flow`
  - [ ] `POST /api/ai/generate-campaign-emails`
  - [ ] `POST /api/ai/generate-social-assets`
  - [ ] `POST /api/ai/generate-creative-assets`
- [ ] Frontend studios load, generate, copy, export (Markdown) and flip status:
      Website Studio · Email Studio (Lifecycle/Campaign/Saved) · Captions Studio · Creative Studio
- [ ] Free/limit reached → studio shows an upgrade prompt (no crash)
- [ ] If Stripe configured: pricing (monthly **and** yearly) → checkout (test card
      `4242 4242 4242 4242`) → 3-day trial shown → webhook marks plan active;
      a second checkout for the same customer gets **no** new trial
- [ ] Browser devtools: no requests expose service_role key or Anthropic key

## 6. Costs & guardrails

- Model: `claude-haiku-4-5`, ~$0.08 per full launch kit (7 AI calls).
- Three protection layers: prepaid Anthropic credits (no auto-reload),
  per-plan usage limits (`backend/lib/plan-limits.js`),
  global `MAX_AI_CALLS_PER_DAY` ceiling.
- Failed generations are never charged to the user (credits settle after success).
