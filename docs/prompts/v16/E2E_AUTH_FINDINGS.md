# Authenticated E2E — first real execution: findings & fixes

The authenticated seeded browser matrix (`npm run test:e2e:auth`,
`e2e/authenticated/*`) had **never actually executed** against a live
non-production Supabase before v16 (it was owner-gated and recorded `skipped`).
Running it for the first time — against a disposable EU Supabase project
(`E2E_MARKER.sql` opted in) — surfaced a set of latent **harness bugs** and two
genuine **product bugs**. All are now fixed; the matrix is **45/45 green** under
the RC-gate runner (`RC_GATE=1`, workers:2).

Result progression while fixing: **6 → 23 → 27 → 33 → 39 → 45** passing.

## How to run it locally

```bash
# 1. A disposable, NON-production Supabase project, schema applied
#    (backend/migrations/001..NNN + E2E_MARKER.sql), service-role grants present.
# 2. A backend with the built app/ bundle served:
NODE_ENV=test SERVE_APP=1 E2E_SEED_ENABLED=1 \
  E2E_SEED_SECRET=<24+ chars> PORT=3109 \
  ALLOWED_ORIGINS=http://127.0.0.1:3109,http://localhost:3109 \
  node backend/server.js
# 3. Point env at the disposable project and run the RC-gate runner:
RC_GATE=1 E2E_AUTH=1 npm run test:e2e:auth
```

Supabase notes: raise the project's GoTrue **Auth rate limits** (disposable
project) or the login burst 401s; tables created by direct SQL need
`grant ... to anon, authenticated, service_role` or PostgREST/service-role reads
return `42501` and seeding 409s.

## Product bugs the E2E caught (real, shipped defects)

1. **Transient plan-verification 503 bounced a signed-in user to `/app/login`.**
   `app-src/lib/auth.jsx` retried `/api/auth/me` on `PLAN_UNAVAILABLE`, but the
   retry used a bare `return refresh(attempt+1)`. In an async function the outer
   call's `finally { setLoading(false) }` runs **before** the returned retry
   promise resolves, so React rendered `loading:false, planUnavailable:null` for
   one frame and the shell guard redirected to login before the safe state was
   set. Fix: `return await refresh(attempt+1)` so `finally` waits for the retry.
   Also `app-src/App.jsx`: when `!account && planUnavailable` on a cold load,
   render the retryable "We couldn't verify your plan" `ErrorState` instead of
   `<Navigate to="/app/login">`. (billing.spec.js:16)

2. **The Library route `/app/assets` 404'd when the backend serves the SPA.**
   Vite emits build assets under `/app/assets/`, and `express.static` 301-
   redirected the client route `/app/assets` into that directory, which the SPA
   fallback deliberately excludes → server `{"error":"Not found"}`. Fix:
   `express.static(appDir, { redirect: false })` in `backend/server.js` so the
   route falls through to the SPA index (matching Vercel). (journey.spec.js:42)

## Harness / test-infra bugs (the suite had never run)

- **`problems` watcher failed every navigating test** on the browser's benign
  `Failed to load resource: 401` (the logged-out `/api/auth/me` probe) and on
  navigation-aborted requests. Rewrote `fixtures.js` to catch real faults
  (`pageerror` + genuine `console.error`) and ignore resource-load status noise
  + `ERR_ABORTED`.
- **Login never actually authenticated.** `waitForURL(/\/app(\/|$)/)` also
  matched `/app/login`, so it returned instantly on the login page and tests ran
  unauthenticated. Now waits for a real non-login `/app` route + polls
  `/api/auth/me == 200`.
- **The `request` fixture was a separate, unauthenticated context** → a request
  to your OWN resource 401'd. Bound `request` to `page.request` so it carries
  the session. (isolation.spec.js:27, journey.spec.js:85)
- **Reading `body.innerText()` immediately after `goto`** raced React's first
  paint (the sidebar shell already has text) → `""`. Added a `mainText(page,
  expected)` helper that waits (auto-retrying `toContainText`) for the route's
  real content. (journey.spec.js:63/85/114/128, billing.spec.js:16)
- **`keyboard.spec.js:76`** destructured `{ page }` without `workspace`, so it
  never logged in. Added `workspace`.
- **`journey.spec.js:24`** strict-mode violation — the campaign name appears in
  breadcrumb + heading; use `.first()`.
- **`journey.spec.js:33`** asserted the onboarding-only label `/brand called/i`;
  the populated profile shows `/brand name/i`.
- **`journey.spec.js:114`** faulted `/consistency`, an endpoint the Review
  surface never calls; re-pointed at its real provider `/review` (whose failure
  `ReviewWorkbench` already surfaces).
- **Seed data key mismatch:** `backend/routes/e2e-seed.js` set the brand fixture
  as `name`, but the Brand Profile UI reads `brand_name` → the field was blank.
  Added `brand_name` to the fixture.

## Files touched

Product: `app-src/App.jsx`, `app-src/lib/auth.jsx`, `backend/server.js`,
`app/` (rebuilt bundle). Seed: `backend/routes/e2e-seed.js`. Harness:
`e2e/authenticated/fixtures.js`, `journey.spec.js`, `keyboard.spec.js`,
`billing.spec.js`.

No pricing / plan-limit / trial / status-enum / verdict changes; no new
generators, share links or publishing. The canonical GO/NO-GO stays in
`docs/launch/launch-state.json`.
