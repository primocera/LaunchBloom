# Controlled Paid Beta — Checklist & Go/No-Go (Prompt 18)

## Pre-launch checklist
- [ ] All migrations run in Supabase (001–014), confirmed "Success. No rows returned".
- [ ] Vercel env: `ANTHROPIC_MODEL=claude-haiku-4-5`, all `STRIPE_PRICE_*` set (live mode), `STRIPE_WEBHOOK_SECRET` for the live endpoint, `ADMIN_EMAILS` set, `PUBLIC_URL` correct.
- [ ] Stripe live webhook endpoint added and a test event delivered successfully.
- [ ] Email: Resend SMTP configured in Supabase Auth, templates use token_hash links, sender domain verified.
- [ ] Legal pages reviewed; support email correct (check the `.ap` typo).
- [ ] Full journey on production once: signup → verify → trial checkout → generate → cancel → password reset.

## Beta cohort
- 10–20 hand-picked users, invited personally. No public launch, no ads.
- Trial: 3 days / 20 actions / 1 launch kit — do not extend individually; comp via Stripe coupons if needed.

## Feature flags (`FEATURE_FLAGS` env, see backend/lib/flags.js)
- `beta_feedback` (default on) — in-app feedback prompt.
- Add new risky features behind a flag; enable with `FEATURE_FLAGS=flag_name`, disable with `-flag_name`.

## What to watch weekly (from `analytics_events`)
- Activation: % of signups that complete onboarding and generate a launch kit within 3 days.
- Conversion: % of trials that convert to paid (`subscription_updated` with status active after trial).
- Failure rate: `generation_failed / (generation_success + generation_failed)`.
- Feedback: read every `feedback_submitted` event.

## Go/No-Go for public launch
GO when, over 2 consecutive weeks of beta:
- trial→paid conversion ≥ 25% of trials that generated a kit
- generation failure rate < 3%
- zero unresolved P0 bugs (payment, auth, data loss)
- webhook_failures = 0 (or all explained + replayed)

NO-GO otherwise: fix, extend beta 2 weeks, re-measure.
