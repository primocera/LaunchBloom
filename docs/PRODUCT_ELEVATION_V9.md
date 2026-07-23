# Product Elevation v9 — Baseline, Route Map & Guardrails (SC-V9-00)

Status legend: **configured** (env/code set) · **deployed** (live on Vercel) · **rehearsed** (manually exercised) · **measured** (observed in production with data). These are separate claims and are not interchangeable in this document.

## 1. Frozen baseline

- **Reviewed baseline commit (from the v9 prompt pack):** `333951702b42f22b780db702dc599ae3e42f19ab`
- **Actual HEAD at v9 kickoff (branch `v9`):** `8ffc159` (docs) → `788cb43` (SC-V9-01) built on top of main `3339517`. The short baseline `3339517` matches the pack's `33395170…`; **no drift** in the reviewed baseline. Work proceeds on branch `v9`, one commit per prompt, merged to `main` only at the SC-V9-12 gate.
- **Repository:** `primocera/LaunchBloom` (unchanged); customer-facing product name **Scalvya**.

## 2. Current verification evidence (as run locally on branch `v9`)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | pass (SC-01 + SC-00 changed files clean) |
| Unit/integration | `npm test` (53 test files, ~343 cases) | repo baseline green; SC-01 (`campaigns`, `next-actions`) and SC-00 (`legal-config`) re-run and pass |
| Production build | `npm run build:app` | pass, 84 modules, fresh bundle |
| Stale bundle | `npm run check:app-fresh` | pass |
| Release evidence | `npm run release:evidence` | emits commit + migration set (33) + build hash; `ready:false` in test mode (live env vars absent by design) — **no secrets** |

> These are **configured/passed-locally**, not **measured**. Browser E2E (`e2e.yml`) is scheduled/on-demand and does **not** gate a release. Live billing/legal paths are **not** rehearsed in this document — see SC-V9-10.

## 3. Route → job → source of truth → decision → next action

### Public / auth
| Route | User job | Source of truth | Next action owner |
|---|---|---|---|
| `/` (Landing) | Understand category, mechanism, value | static + `/api/plans` | SC-V9-08 |
| `/app/login`,`/signup`,`/forgot`,`/reset` | Authenticate | `routes/auth.js` (HMAC session) | stable |
| `/legal/:slug` | Read Terms/Privacy/etc. | `GET /api/legal` (env-backed) | **fixed in SC-00 (fail-closed)** |

### Signed-in app (`/app/*`)
| Route | User job | Source of truth | Next action owner |
|---|---|---|---|
| `/app` (Dashboard) | See one next action | `app-src/lib/next-actions.js` `homePlan()` | SC-V9-02 |
| `/app/brand` (Brand Profile) | Reusable workspace truth | `routes/workspaces.js` brand_profiles | stable |
| `/app/campaigns` | List + create campaigns | `GET /api/campaigns` | **SC-V9-01 (list/create only)** |
| `/app/campaigns/:id/:section?` | Focused campaign workspace (Overview/Brief/Deliverables/Assets/Review/Handoff) | `GET /api/campaigns` + per-section services | **SC-V9-01 (new)**; deepened by SC-02/03/04/07 |
| `/app/create` | Choose next asset in campaign context | `Create.jsx` + `?campaign=` | SC-V9-05 |
| `/app/website\|email-studio\|social\|creative\|seo` | Generate a channel asset | `routes/ai.js`, `routes/assets.js`, schemas | SC-V9-05 |
| `/app/assets` (Library) | Find/edit/version/export assets | `routes/library.js` (`campaign_id` filter) | SC-V9-06 |
| `/app/flow`, `/app/kits/:id` | Guided full-launch template | launch kit tables | stable |
| `/app/account` | Billing, data export/delete | `routes/customers.js`,`account.js` | SC-V9-10 |
| `/app/admin` | Support scorecard (allowlist 403) | `routes/admin.js` | SC-V9-10/11 |

### Legacy redirects (must stay valid)
`/app/landing-page → /app/website`, `/content-plan → /social`, `/email-sequence → /app/email-studio`, `/ads → /app/creative`. **Add for SC-01:** old single-page `/app/campaigns` deep links still resolve (list surface preserved); per-campaign work moved under `/app/campaigns/:id` — no old URL broke because the workspace path is new.

## 4. Known gaps

**P0 (block paid-cohort expansion)**
- Live charge/cancel/refund/recovery path **not rehearsed** with owner evidence (SC-V9-10).
- CI historically PR-only → a direct push to `main` could look green without checks. **Fixed in SC-00** (CI now runs on `push: main`).
- Customer-visible `legal entity TBD` fallback when `/api/legal` failed. **Fixed in SC-00** (fail-closed).

**P1**
- Campaign cockpit was a monolith (`Campaigns.jsx`, 937 lines). **Addressed in SC-V9-01.**
- Deterministic next-best-action fragmented across Dashboard + panels (SC-V9-02).
- Brief creation friction; no inline edit of existing brief before SC-01 bridge (SC-V9-03).
- Review tools split across separate panels (SC-V9-04).
- `.doc` HTML export labeled honestly but not real DOCX (SC-V9-06/07).

**P2**
- ICP positioning still broad (SC-V9-08); design-system/token drift (SC-V9-09); no validated cohort evidence (SC-V9-11).

## 5. Rollout order (per the pack)
0. **SC-00** baseline/guardrails · **SC-10** paid-production hardening
1. **SC-01→04** core campaign UX
2. **SC-05→08** paid value + commercial story
3. **SC-09, SC-11** quality + measured beta
4. **SC-12** RC freeze + GO/NO-GO

Executed so far on `v9`: **SC-01** (commit `788cb43`), **SC-00** (this commit). SC-V9-02 remains open between SC-01 and SC-03.

## 6. Explicit non-goals for v9 baseline
- No repricing, plan-limit, or status-enum changes.
- No brand-name change; `LaunchBloom` retained only in clearly-historical docs and the repo name.
- No live provider (Stripe/Supabase/Vercel/Resend/DNS/cron) mutation from Claude Code without explicit owner authorization.
- No new generators, collaboration, public share links, or direct publishing.
- Baseline prompt does not refactor the whole product; targeted high-confidence fixes only.

## 7. What SC-00 changed
- **Fail-closed legal identity:** `GET /api/legal` no longer emits a placeholder entity when unconfigured (`legal_name: null`); `app-src/brand.js` drops the hardcoded `legal entity TBD`; `Legal.jsx` renders an explicit "unavailable — contact support" state for entity-dependent docs (Terms) instead of a fabricated name. Locked by two new `legal-config.test.js` assertions.
- **CI gate:** `.github/workflows/ci.yml` now runs lint + tests + build + stale-bundle on `pull_request` **and** `push: main`. E2E stays non-gating.
- **Release evidence:** `npm run release:evidence` (`release-check.js --evidence`) emits a machine-readable record pinning commit SHA, full migration set, and built-bundle hash with presence-only env booleans — no secrets.
