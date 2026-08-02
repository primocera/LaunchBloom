# Legacy billing surface removed; one canonical portal (v13 SC-P0-05)

Date: 2026-08-02 · Branch: `v13`

## Decision

Two legacy billing routes in `backend/routes/customers.js` are **deleted**, and
the return URL of the one remaining portal endpoint is **server-configuration
only**.

| Removed | Why |
| --- | --- |
| `POST /api/customers` | Took the billing email from `req.body`, so any signed-in user could mint a Stripe customer for someone else's address, and forwarded arbitrary `metadata` straight to Stripe. |
| `GET /api/customers/:id/portal?returnUrl=` | Opened a Stripe Billing Portal session with a client-controlled `return_url` — an open redirect anchored on a trusted billing domain. Superseded by the account flow. |

## Reachability audit (before deletion)

Searched `app-src/`, `api/`, `backend/` (routes, scripts, tests), and `docs/`
for `/api/customers` callers. Results: the only client call in the product is
`app-src/lib/api.js` → `POST /api/account/billing-portal` (used by
`app-src/routes/Account.jsx` `openPortal`). Every other reference to
`routes/customers` is a **module import** of `planFor` / `pricePlans` /
`resolveEntitlement`, not an HTTP call. Neither deleted route had a frontend,
script, test, or documentation caller. `GET /api/customers/:id` is retained —
it is read-only and already ownership-checked against `req.userEmail`.

Customer rows are created in exactly one place: `backend/routes/payments.js`
checkout, which derives the email from the session. No route accepts a
client-supplied billing identity or client metadata.

## Canonical portal

`POST /api/account/billing-portal` is the single portal endpoint:

* identity is `req.userEmail` (session), never a path/body customer id;
* the return URL is built by `configuredAppUrl('/app/account')` in
  `backend/lib/launch-config.js`;
* any `returnUrl` in the query or body is **ignored** — there is no redirect
  parameter left to attack;
* a misconfigured `PUBLIC_URL` yields a generic `503 LAUNCH_CONFIG_INCOMPLETE`
  rather than a redirect to an unvalidated destination.

`configuredAppUrl()` rebuilds the URL from the parsed origin plus an in-app
literal path, and rejects: protocol-relative values, non-HTTPS schemes
(`http://` is tolerated for a local host outside production only),
`javascript:` / `data:`, embedded credentials, a configured query string or
fragment, non-internal or traversal paths, and localhost/placeholder hosts in
production mode. Errors name the variable, never its value.

## Coverage

`backend/tests/legacy-customer-portal.test.js` (12/12 passing) asserts the
removals, that no Stripe customer or portal session can be created through
them, that the canonical endpoint ignores external / protocol-relative /
encoded / mixed-case / localhost / `javascript:` / `data:` return URLs and
requires auth, and the full `configuredAppUrl` rejection matrix.
