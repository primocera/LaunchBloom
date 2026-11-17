# Auth, sessions and user data

## D1. `ensureWorkspace` creates workspaces it should not (High, confirmed)

**Where:** `backend/routes/workspaces.js:21-63`, `:93-98`, `:133-135`.

**What:**
- Every read ignores its error. If the lookup fails, the function falls through and inserts a new empty workspace. `listWorkspaces` also returns `[]` on error, so `resolveWorkspace` reaches this path on any transient failure. The user lands in a blank workspace and their real one looks deleted.
- On first login the app fires several requests at once. Each finds no workspace and inserts one. There is no constraint to stop it, so a Free user (limit 1) can start with two or three.
- The lookup uses `.limit(1).single()` with no order, so which workspace it returns is up to Postgres, while `resolveWorkspace` picks the oldest. It can also return an archived one.

**Fix:** Check errors and throw (503). Order by `created_at`. Make first-workspace creation atomic: a small SQL function, or insert then re-read and delete the loser.

## D2. Five tables have no row-level security (High, needs live check)

**Where:** `backend/migrations/014_analytics_events.sql`, `015_email_events.sql`, `023_admin_audit.sql`, `036_email_suppressions.sql`, `038_stripe_object_ownership.sql`. None contains an `enable row level security` statement, and no later migration adds one.

**What:** In Supabase, a `public` table without RLS is readable and writable through the REST API by anyone holding the anon key. The app keeps that key server-side, but an anon key is not designed to be a secret. `email_events` holds recipient addresses, `email_suppressions` holds unsubscribes, `admin_audit` holds admin emails.

**Check in the SQL editor:**
```sql
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
```

**Fix:** One migration enabling RLS on every table it lists (no policies needed; the service role bypasses RLS). Add the query to `CHECK_APPLIED.sql`.

## D3. Read errors are treated as "not found" across the app (Medium, confirmed pattern)

**What:** About 149 Supabase calls destructure only `data`; 57 also check `error`. The billing path is careful; most other paths are not. Consequences depend on the call:
- `account.js:209-216`: a failed workspace read during export falls back to a single workspace, so a data-rights export can be silently incomplete.
- `payments.js:296-317`, `webhooks.js:245-253`, `:509-514`: ownership and email lookups turn an outage into "not ours" or "no email", dropping a refund signal or a lifecycle email.
- D1 and B2 are the two worst instances.

**Fix:** A small helper (`must(result)` that throws on a non-`PGRST116` error) and a lint rule or test that flags `const { data } = await supabase`. Convert decision-making reads first; display-only reads can wait.

## D4. Deletion keeps the local billing row (Medium, confirmed; check against the privacy policy)

**Where:** `backend/routes/account.js` step list.

**What:** `customers` (email, `app_user_id`, Stripe id) and `subscriptions` rows stay after deletion. The receipt mentions Stripe's records and "account-level events", not this row. It is also the cause of B1.

**Fix:** Anonymise the email and unlink `app_user_id` at deletion, or state the retention explicitly.

## S1. Rate limiting does not match the platform or the customer (Medium, confirmed)

**Where:** `backend/server.js:31-62`, `backend/routes/auth.js:39-78`.

**What:**
- All limiters use the default in-memory store. On Vercel each instance has its own counters, and they reset on cold start. Login (20 per 15 min), signup and email-send limits are therefore soft.
- Auth calls are proxied through the backend, so Supabase's own per-IP limits see Vercel's addresses, not the attacker's. Supabase is not a backstop here.
- The general limit is 100 requests per 15 minutes per IP across the whole API, autosaves included. The target customer is an agency, where several people share an office IP. They will hit 429 during normal work whenever requests land on a warm instance.

**Fix:** Key the general limiter by user id when signed in. Move auth limiters to a shared store (a Postgres table is enough at this scale) or to Vercel's firewall rules. Add a CAPTCHA (Turnstile) to signup and forgot-password.

## S2. The app shell is served without security headers (Medium, confirmed)

**Where:** `vercel.json` has no `headers` block. Helmet only covers responses from the Express function.

**What:** `/app/*` and `/` have no Content-Security-Policy and no frame restriction, so the signed-in app can be framed by another site (clickjacking on delete, checkout or approve buttons).

**Fix:** Add `headers` in `vercel.json`: `X-Frame-Options: DENY` (or `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, and a CSP once inline styles are accounted for.

## S3. Email-link callback (Low to medium, confirmed)

**Where:** `backend/routes/auth.js:345-406`.

- **Login CSRF:** the callback is a GET that sets session cookies from a token in the URL, with no state check. An attacker can send a victim a link carrying the attacker's own token; the victim ends up signed in to the attacker's account and may enter real brand data there.
- **`flow=recovery` is caller-controlled:** adding it to any valid email link (for example a signup confirmation) sets the password-reset marker. The link already proves inbox access, so impact is small, but the marker should come from the verified token type.

**Fix:** For recovery, trust only `type === 'recovery'` (and a server-set cookie for the PKCE form). Consider landing on a confirm page that POSTs.

## S4. Destructive actions need no re-authentication (Low to medium, confirmed)

Password reset was hardened against a stolen cookie; `POST /api/account/delete` was not. Ask for the password (or a fresh login) before deletion.

## S5. Session handling notes (Low)

- **Parallel refresh:** when the one-hour access token has expired, every parallel request refreshes with the same refresh token. It works only inside Supabase's reuse window; outside it the session can be revoked, which looks like a random logout. A client-side single refresh call before the burst avoids it.
- **A Supabase call per request:** `getUser` is a network round trip on every API call. Verifying the JWT locally removes the latency and the dependency, at the cost of slower revocation. Worth doing with A6.

## S6. Small items (Low)

- `email-preferences.js:54,82`: the email address is written into HTML unescaped. The HMAC and helmet's CSP make exploitation unlikely; escape it anyway.
- `auth.js:197`: consent IP is taken from the first `X-Forwarded-For` hop, which the client controls. Use `req.ip`.
- `server.js:101`: a rejected CORS origin becomes a logged 500. Return 403 without the stack.
- `auth.js:157-161`: the signup cap counts workspaces, not users.
- `POST /api/events` accepts unauthenticated analytics for allowlisted names; fine, but it can inflate landing-funnel numbers.
