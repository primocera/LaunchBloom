# Runbooks (Prompt 16)

All logs are structured JSON lines with `req_id` — search Vercel/Railway logs by `req_id` from a customer error message.

## Alerts to watch (check `GET /api/admin/health` daily during beta)
- `webhook_failures > 0` — Stripe webhook processing failed.
- `failed_generations` spiking — AI provider errors or schema failures.

## Stripe webhook failing
1. Stripe Dashboard → Developers → Events: find the failed event, note the type + error.
2. Check `stripe_events` table row: `status`, `attempts`, `last_error`.
3. Fix cause (usually env price IDs or DB), then "Resend" from the Stripe dashboard — processing is idempotent, safe to replay.

## Customer says "I paid but I'm still on trial/free"
1. `GET /api/admin/user?email=...` (as an ADMIN_EMAILS account): check `subscription.status`.
2. If no subscription row: webhook never landed — check Stripe events + STRIPE_WEBHOOK_SECRET.
3. If row exists but status wrong: resend the latest `customer.subscription.updated` event.

## AI generation errors / spend spike
1. `failed_generations` in `/api/admin/health`; `usage_events` rows with `status='released'` show which feature.
2. Check ANTHROPIC_API_KEY validity and Anthropic status page.
3. Failed generations never consume the user's quota (reserve→release), so no refunds needed.

## Checkout errors
1. Logs: search `checkout_failed` in `analytics_events` — `properties.reason` has the Stripe error code.
2. Usual causes: missing `STRIPE_PRICE_*` env for a plan/interval, or Stripe key mode mismatch (test vs live).

## Database down / Supabase incident
- All API routes return 500 with a `req_id`; `track()` and logging swallow their own errors so nothing cascades.
- Check Supabase status page; nothing to do app-side but wait or restore from Supabase backups.

## Rollback a bad deploy
- Vercel → Deployments → previous deployment → "Promote to Production". DB migrations are additive-only, so old code runs fine against a newer schema.
