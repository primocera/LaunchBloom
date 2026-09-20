# Dependency security patch — v23 SV-23-01

**Date (UTC):** 2026-09-21
**Branch:** v23
**Scope:** production dependency advisories only (`npm audit --omit=dev`). No product
feature, pricing, redesign or scale change. Express stays in the **4.x** line — no
Express 5, React 19, Vite major or router major migration.

## Advisories closed

| Advisory | Package | Vulnerable | Fixed floor |
|---|---|---|---|
| GHSA-x5fp-wj9c-mxmx | body-parser | 1.20.6 | **1.20.8** |
| GHSA-4mjr-xmp4-gh2g | qs | 6.15.3 | **6.16.0** |

Both reached production only transitively through `express`. Express's own ranges
(`body-parser: ~1.20.5`, and a nested `qs` under body-parser at 6.15.3) would have
kept the vulnerable versions locked, so `package.json` pins the floors with
`overrides` (`body-parser: "1.20.8"`, `qs: "6.16.0"`). `body-parser` is pinned to
the exact 1.x patch — a bare `>=1.20.8` lets npm jump to the 2.x **major**, which
Express 4 cannot use, so the exact pin is deliberate.

## Versions

| Package | Before | After |
|---|---|---|
| express | 4.22.2 | **4.22.3** |
| body-parser | 1.20.6 | **1.20.8** |
| qs | 6.15.3 | **6.16.0** (deduped across express, stripe, supertest) |

## Reachability note (does NOT justify skipping the patch)

The application mounts **only** `express.json({ limit: '10kb' })` (backend/server.js).
It never calls `express.urlencoded` and never `require`s `qs` directly (verified:
no `urlencoded` or `qs` reference in `backend/` or `api/` source outside
`node_modules`). The advisories center on body-parser's `urlencoded`
extended-parse path (arrays/depth via qs), which this app does not reach. Express's
internal query-string parser (`lib/middleware/query.js`) does use `qs` and is
reachable, but now runs on the fixed 6.16.0. The patch is therefore
defense-in-depth with low live reachability — recorded here as a reachability
observation, **not** as a reason to defer the fix.

## Result

`npm audit --omit=dev` → **0 vulnerabilities** (info/low/moderate/high/critical all 0).
The machine-readable, SHA-pinned JSON audit artifact is produced by the
`release-candidate.yml` audit gate (v23 SV-23-02).
