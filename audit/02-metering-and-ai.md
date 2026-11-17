# Metering and AI

## M1. The usage ledger fails open (High, confirmed)

**Where:** `backend/lib/usage.js:160-161`, `:178-180`, `:199`; consumed by `backend/lib/plan-limits.js:175-209`.

**What:** `countUserActions` returns 0 on any query error, and `reserveAction` returns null on an insert error. The gate then sees "0 used" and lets the request through with no reservation. During a Supabase incident every user is effectively unlimited. The only remaining ceiling is the global daily cap.

This contradicts the rest of the billing code, which fails closed everywhere.

**Fix:** Throw on error and answer 503 (the entitlement-unavailable pattern already exists). Keep the "table missing" tolerance only if a deployment without migration 007 is still possible; it should not be.

## M2. Reservations never expire (High, confirmed)

**Where:** `backend/lib/usage.js:16` (`reserved` counts), no sweeper anywhere; `backend/routes/admin.js:249` only lists them.

**What:** If the function is killed before `settle` runs (Vercel's 300-second limit, a crash, a cold redeploy), the row stays `reserved` and counts against the user forever. For trial users the pool is lifetime, so each stuck row is a permanently lost action out of 20.

A4 below makes the timeout reachable in practice.

**Fix:** Count `reserved` rows only when younger than about 10 minutes. One extra filter in the two count queries; no cron needed.

## M3. The metering window is looked up by email (Medium, confirmed)

**Where:** `backend/lib/usage.js:62-75`.

**What:** Entitlement resolves the customer by `app_user_id`. The window start resolves it by `customers.email` and falls back to the calendar month on a miss or an error, silently. `customers.email` follows Stripe's email, so after an email change on either side the window jumps from the billing anniversary to the first of the month. The user gets an early reset (extra allowance) and their top-up pack, which is dated from the subscription anchor, no longer lines up with the window that counts usage.

**Fix:** Pass `{ userId, email }` and use `findCustomerRow`. Treat a read error as unavailable, not as "calendar month".

## A1. Work done after the response is lost on Vercel (Medium, confirmed)

**Where:** `backend/lib/idempotency.js:99-113`; unawaited `track(...)` calls across routes (`plan-limits.js:222`, `payments.js:491`, `auth.js:206` and others).

**What:** `plan-limits.js` already documents that Vercel can freeze the function once the response is sent, and awaits `settle` for that reason. The idempotency layer still stores its result fire-and-forget. If that write is lost, the key stays `in_flight`: retries get 409 for 10 minutes, then the generation runs again and is charged again. Unawaited analytics calls are dropped the same way, and the beta scorecard and weekly decision read those events.

**Fix:** Await the idempotency update before sending, the same way `settle` does. For analytics, either await or use `waitUntil` from `@vercel/functions`.

## A2. Idempotency keys are not bound to the request (Low, confirmed)

A key replays the stored result whatever the new body says. Store a hash of the body and return 422 on mismatch.

## A3. One user can exhaust the global daily cap (Medium, confirmed logic; check the production value)

**Where:** `backend/lib/spend-guard.js:23`.

**What:** `MAX_AI_CALLS_PER_DAY` defaults to 300 for the whole app. A Studio user has 400 actions a month and a 30 per hour limiter; a launch kit makes several calls. One busy account can use the day's budget, after which every customer gets `DAILY_CAP` until midnight UTC. The cost comment beside it assumes an older model.

**Fix:** Confirm the production value. Add a per-user daily share (for example 25% of the cap), and alert on the 80% threshold that is already logged.

## A4. Retry budget exceeds the platform limit (Medium, confirmed arithmetic)

**Where:** `backend/lib/ai.js:45-46` (90 s timeout, 3 attempts), `vercel.json` (`maxDuration: 300`).

**What:** Three attempts at 90 seconds plus backoff is about 271 seconds, before roughly a dozen sequential database calls in the gate. A slow provider day pushes requests into the platform kill, which leaves a stuck usage reservation (M2), a stuck spend-ledger reservation and an `in_flight` idempotency row.

**Fix:** One overall deadline (about 240 s) shared across attempts; skip a retry that cannot finish in the time left.

## A5. Truncated output is retried blindly (Low, confirmed)

**Where:** `backend/lib/ai.js:357-375`.

**What:** `stop_reason === 'max_tokens'` is not checked. A truncated response fails JSON parsing and is retried twice with the same limit, paying three times for the same failure. Tokens spent on failed attempts are never recorded, so the spend ledger undercounts.

**Fix:** Detect truncation and fail fast with a distinct code (or retry once with a higher limit). Record tokens for failed attempts.

## A6. Request overhead before every generation (Low, confirmed)

**What:** An AI request makes about twelve sequential Supabase round trips before the model call: session check, customer, subscriptions, payments, workspace, window (two), counts (two or three), top-ups, reserve, recount. `GET /api/auth/me` runs most of the same chain on every page load. `CLAUDE.md` says `planFor()` is cached; it is not.

**Fix:** Run independent reads with `Promise.all`, or move the gate into one SQL function that checks and reserves atomically. That function would also remove the reserve-then-recount race handling.

## A7. Documentation and prompt drift (Low, confirmed)

- `CLAUDE.md` names `claude-opus-4-8` as the model; the code default is `claude-haiku-4-5` and production is on Haiku 5.5 through an env var.
- `BASE_SYSTEM` in `ai.js:22-36` still describes the old audience (solopreneurs, coaches, creators) and "idea to offer to launch", not the campaign-control product for freelance marketers and agencies.
- The cost table row for `claude-haiku-5-5` should be checked against current pricing; unknown models silently fall back to Haiku 4.5 rates.
