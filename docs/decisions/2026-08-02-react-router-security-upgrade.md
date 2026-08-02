# React Router security upgrade + centralized redirect validation (v13 SC-P0-06)

Date: 2026-08-02 · Branch: `v13`

## Advisories

| Advisory | Affects | Patched | Status here |
| --- | --- | --- | --- |
| GHSA-jjmj-jmhj-qwj2 (CVE-2026-53668) — open redirect / XSS vector | `react-router-dom` 6.30.2–6.30.4 | no 6.x fix; `react-router` ≥ 7.13.0 | **Closed** by the upgrade |
| GHSA-wrjc-x8rr-h8h6 (CVE-2026-53669) — open redirect via backslash in `<Link>` / `useNavigate` | ≥ 6.0.0, < 7.18.0 | 7.18.0 | **Closed** by the upgrade |
| GHSA-337j-9hxr-rhxg (CVE-2026-53666) — arbitrary constructor injection in `deserializeErrors()` during SSR hydration | ≥ 6.4.0, < 7.18.0 | 7.18.0 | **Closed** by the upgrade (and never reachable: no SSR) |
| GHSA-qwww-vcr4-c8h2 — RSC-mode CSRF bypass | ≥ 7.12.0, < 8.3.0 | 8.3.0 | **Open, not applicable** — see residual risk |

## Decision

`react-router-dom` 6.30.4 → **^7.18.0** (lockfile 7.18.2). There is no patched
6.x release for any of the three advisories: the 6.x line was not backported,
so staying on 6 means staying vulnerable.

The app uses React Router in **declarative mode only** — `BrowserRouter`,
`Routes`/`Route`, `Link`, `NavLink`, `Navigate`, `useNavigate`, `useParams`,
`useSearchParams`. No data routers, loaders, actions, `RouterProvider`, SSR
hydration, or RSC APIs. All of those imports are unchanged in v7, so the
upgrade required **no application code changes** and no UI behavior change.

`npm audit fix --force` was not used (it downgrades to `react-router-dom@7.11.0`,
which is vulnerable to the three advisories above).

## Residual risk: GHSA-qwww-vcr4-c8h2 (high, not applicable)

Fixed only in `react-router` 8.3.0. React Router 8 **removes the
`react-router-dom` package** (latest published `react-router-dom` is 7.18.2) and
raises the floor to Node ≥ 22.22, React ≥ 19.2.7 and Vite ≥ 7 — this repo is on
React 18.3.1 / Vite 5. Taking 8.3.0 means a React 19 + Vite 7 migration plus an
import rewrite across every routed file; that is not the smallest coherent
change for this prompt and carries far more UI regression risk than the
advisory it removes.

The advisory text states it "only affects your application if you are using the
unstable RSC APIs". This app has no RSC entry point, no server rendering, and
no `react-router/rsc` import — so the vulnerable code path is not shipped in the
bundle's execution paths. The advisory stays **open in `npm audit --omit=dev`**
and must not be reported as closed. Remediation owner: repository owner;
revisit with the React 19 / Vite 7 upgrade, or sooner if a 7.x backport ships.

## Centralized internal-navigation validation

New: `app-src/lib/safe-path.js` — `isSafeInternalPath(value)` /
`safeInternalPath(value, fallback = '/app')`. A value is accepted only when it
is a same-origin application path: starts with a single `/`, no `//` prefix, no
backslash anywhere, no control characters or spaces, no scheme. Everything else
falls back.

Sink inventory (searched `app-src/` for `navigate(`, `<Navigate`,
`window.location.*`, `searchParams.get`, `redirect`/`next`/`returnTo`):

- **No user-controlled redirect parameter exists today.** No `?redirect=`,
  `?next=` or `?returnTo=` is read anywhere in `app-src/`. Auth redirects
  (`Login`, `Signup`, `ResetPassword`) navigate to hardcoded literals.
- **Backend redirects** (`backend/routes/auth.js`) are built from server
  environment config (`appUrl()`, `callbackUrl()`), never from request input.
  SC-P0-05 already removed the last client-controlled `returnUrl`.
- **One dynamic sink**: `CampaignWorkspace` `na.destination` from
  `campaign-next-action.js`. Now routed through `safeInternalPath()` for both
  the `navigate()` and the `<a href>` branch.
- **Deliberately external and left alone**: Stripe Checkout / Billing Portal
  URLs (`Login.resumePendingCheckout`, `Account.openPortal`,
  `TrialPaywall`) — these come from our own server's Stripe API response and
  must leave the origin.

Exploit-oriented tests: `backend/tests/safe-path.test.js` (22 rejection
payloads incl. `//evil`, `/\evil`, `\\evil`, `javascript:`, `data:`, tab/newline
smuggling; plus non-string input).

## Evidence

| | |
| --- | --- |
| `npm audit --omit=dev` before | 2 moderate (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) on `react-router` / `react-router-dom` 6.30.4 |
| `npm audit --omit=dev` after | 2 high (GHSA-qwww-vcr4-c8h2, RSC-only, not applicable) on `react-router` / `react-router-dom` 7.18.2 |
| Lockfile | `npm install react-router-dom@^7.18.0` then `npm ci` — reproducible |
| `npm run lint` | PASS (0 errors) |
| `npm test` | PASS 716/716 |
| `npm run build:app` + `check:app-fresh` | PASS (bundle regenerated and committed) |
| `npm run test:e2e` | PASS 52/52 on the new dependency tree |
