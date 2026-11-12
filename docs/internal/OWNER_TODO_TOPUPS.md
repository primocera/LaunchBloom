# Owner TODO: AI-action top-up packs

The top-up code is already on main and in production (since 2026-11-07). It stays
switched off until these owner-only steps are done. No new code push is needed.

## Steps

1. **Supabase:** run `backend/migrations/041_action_topups.sql` in the production
   project. Do this before anyone can buy a pack. Otherwise Stripe charges the
   buyer, but the extra actions only show up after the migration.
2. **Stripe:** create two one-time prices (USD, with EUR in `currency_options`):
   - +40 AI actions: $9.99 / €8.70
   - +100 AI actions: $24.99 / €21.76
3. **Vercel:** set `STRIPE_PRICE_ACTIONS_40` and `STRIPE_PRICE_ACTIONS_100` to those
   price IDs, then **Redeploy** the latest production deployment. New env vars
   only apply after a redeploy. Until both are set, the app does not offer packs.
4. **Stripe webhook:** add the `checkout.session.async_payment_succeeded` event to
   the endpoint (`charge.refunded` and `charge.dispute.closed` should already be on it).
5. **Test mode:** run checks T6–T9 in `docs/evidence/BILLING_TEST_MODE_PLAN_2026-11.md`
   (Stripe test mode, non-prod Supabase, no live money).

## How to check it is live

Sign in as a paying user and open Account. You should see the
"Buy more AI actions" button with both packs. If it is missing, the price env vars
have not been picked up (step 3).

## Rules already built in

- Packs are for starter / pro / studio, monthly and yearly.
- Extra actions only last until the next monthly reset (no rollover).
- Design details: `docs/internal/HANDOFF_2026-11-07.md` ("Top-up design").
