# V7 Route-by-route audit matrix (LB-00 deliverable)

> The audit the LB-00 master prompt requires. One row per customer-facing
> surface: **intent · current promise · actual capability · risk · what v7
> did · how it was verified**. This is the documentary trail; the backend and
> `backend/tests/` remain the final source of truth.
>
> Scope: `primocera/LaunchBloom` @ `main` (v7). Legend for **State**:
> ✅ compliant & tested · 🔧 fixed in v7 · ➖ intentionally subordinated (legacy).

---

## Public surfaces

| Route / file | User intent | Current promise | Actual capability | Risk if wrong | v7 action | Verified by | State |
|---|---|---|---|---|---|---|---|
| `/` `Landing.jsx` | Understand product + start | "Turn one offer into a launch-ready campaign" + defines launch-ready | Static hero, `/api/plans` pricing, 4-step mechanism, example, FAQ | Over-promise / fake proof | LB-02: added "launch-ready = structured, connected, review-ready; publishing stays with you" | `content-contract.test.js` (promise + hero define), `smoke.spec.js` | 🔧 |
| `/app/signup` `Signup.jsx` | Create free account | Free setup, plan only when generating | Creates account, resumes pending checkout | Signup dead-ends on generic dashboard | LB-02: route new users to `/app/brand?welcome=1` (first activation) | `content-contract.test.js` (signup route), `smoke.spec.js` consent test | 🔧 |
| `/app/login` `Login.jsx` | Return | Sign in, resume checkout | HMAC session, pending-plan resume | — | none needed | `smoke.spec.js`, `auth-routes.test.js` | ✅ |
| `/app/forgot-password`, `/app/reset-password` | Recover | Recovery link flow | Supabase recovery | Broken recovery | none needed | `auth-routes.test.js` | ✅ |
| `/legal/:slug` `Legal.jsx` | Read terms | Env-backed legal | `/api/legal` config; no placeholders | Placeholder text live | none needed (v6) | `smoke.spec.js` (no `[PLACEHOLDER`), `legal-config.test.js` | ✅ |
| `*` `NotFound.jsx` | — | 404 | Renders not-found | — | none | `smoke.spec.js` | ✅ |

## Authenticated core

| Route / file | User intent | Current promise | Actual capability | Risk | v7 action | Verified by | State |
|---|---|---|---|---|---|---|---|
| `/app` `Dashboard.jsx` | Next best action | One primary action, ≤3 next steps | `homePlan()` derives from real state | Generic/dead metrics | LB-05 (v6-solid): verified five paths, no sixth; "launch kit"→"campaign package" reason | `next-actions.test.js`, `content-contract.test.js` | ✅ |
| `/app/brand` `BrandProfile.jsx` | Ground truth | Reusable facts, no invented claims | 7-Q onboarding + 7 sections, autosave, structured records | User can't tell baseline vs optional; snapshot unclear | LB-03: minimum-baseline line via `minimumViableProfile()`, snapshot semantics in intro, safer autosave-fail copy | `content-contract.test.js` (baseline+snapshot), `brand-profile.test.js` | 🔧 |
| `/app/campaigns` `Campaigns.jsx` | Campaign decision record | Brief drives all assets; approval is human | Manual brief + optional AI strategy, approve/reopen, dup/archive/delete | Forced to buy strategy to approve; reopen hides downstream effect | LB-04: approve without strategy (gated on required decisions), "Reopen brief" confirm w/ snapshot note, strategy labeled optional·1 action, dup tooltip | `content-contract.test.js` (approve-without-strategy, reopen), `campaigns.test.js` | 🔧 |
| `/app/create` `Create.jsx` | Choose next asset | Exactly 5 destinations w/ campaign context | 5 cards, campaign_id carried | Hidden sixth studio | LB-05: asserted 5 paths in Create + Sidebar | `content-contract.test.js` (five paths) | ✅ |
| `/app/assets` `AssetLibrary.jsx` | Campaign memory | Provenance, statuses, safe export | Filters, provenance line, version restore, export gates | Divergent status labels vs studios | LB-11: shared `status-labels.js`; Library imports it | `content-contract.test.js` (shared vocab), `library.test.js`, `library-export.test.js` | 🔧 |
| `/app/account` `Account.jsx` | Billing truth | Plan/usage/trial/cancel from Stripe | `/api/account/billing`, portal, export, delete | Stale/ wrong billing state | LB-12: added `trial_eligible`; states covered | `account-routes.test.js`, `customers.test.js` | 🔧 |

## Studios (five canonical)

| Route / file | Intent | Promise | Capability | Risk | v7 action | Verified by | State |
|---|---|---|---|---|---|---|---|
| `/app/website` `WebsiteStudio.jsx` | Web copy drafts | Structured drafts, not deployed | 9 page types, sections, meta checks, export | Implies production/deploy | LB-06: page-type descriptions; shared export note (draft, review facts/links/claims, free) | `website-studio.test.js`, `content-contract.test.js` (export note) | 🔧 |
| `/app/email-studio` `EmailFlowStudio.jsx` | Sequence drafts | Review-ready, LB never sends | Lifecycle+campaign flows, timing, plain-text | Implies sending/deliverability | LB-07: "does not send emails", 1-AI-action disclosure both forms, flow-type descriptions | `email-studio.test.js`, `content-contract.test.js` (no-send + cost) | 🔧 |
| `/app/social` `SocialStudio.jsx` | Plan, not publish | Plans; never posts/schedules | Channel content + calendar (planned_date) | Calendar said "schedule" | LB-08: "does not post or schedule", transfer-to-tool copy, Unschedule→Clear date, Unscheduled→Unplanned | `social-studio.test.js`, `content-contract.test.js` (plans-not-schedules) | 🔧 |
| `/app/creative` `CreativeStudio.jsx` | Ad briefs | Briefs for humans, not media | Static/video/UGC/carousel/search, proof-gated compliance | Implies rendered/approved ads | LB-09: "not rendered media, approved ads or launched campaigns"; format descriptions incl. UGC rights | `creative-studio.test.js`, `content-contract.test.js` (briefs-not-media) | 🔧 |
| `/app/seo` `SeoStudio.jsx` | Ideas to research | Ideation; no fake metrics | Ideas + research checklist, "Not researched" badge, page-brief handoff | Fabricated volume/ranking | LB-10: export header reflects recorded research vs NOT RESEARCHED | `seo-honesty.test.js`, `golden-eval.test.js` | 🔧 |

## Legacy (intentionally subordinated — kept, not deleted)

| Route / file | Why kept | v7 action | State |
|---|---|---|---|
| `/app/flow` `Flow.jsx` | Guided offer→package template | "launch kit"→"campaign package", per-step 1-AI-action disclosure | ➖ |
| `/app/kits/:id` `KitDetail.jsx` | Existing package data | Vocabulary + export review reminder | ➖ |
| `/app/weekly-plan`, `ContentStudio.jsx`, `LandingStudio.jsx` | Existing user work | `NoKit` empty state → `/app/campaigns` (was dashboard dead end) | ➖ |
| `/app/{landing-page,content-plan,email-sequence,ads}` | Old deep links | Redirect to canonical studio | ➖ |

## Commercial / backend (behaviour audited, not a UI surface)

| Concern | Promise | Capability | Risk | v7 action | Verified by | State |
|---|---|---|---|---|---|---|
| Pricing source | One catalog | `plan-catalog.js`+`plan-limits.js` via `/api/plans` | Duplicate price copies | LB-12: no second copy; corrected EUR→USD comment | `plan-catalog.test.js`, `smoke.spec.js` catalog contract | ✅ |
| Trial (no double) | One 3-day trial | `hadTrialOrActiveSubscription` skips 2nd `trial_period_days`; UI `trial_eligible` pay-today | Fake 2nd-trial promise | LB-12: pay-today paywall + honest success banner | `payments.test.js`, `content-contract.test.js` (pay-today) | 🔧 |
| Metering | 1 action = 1 success | `planGate` reserve/finalize/release; `usage.js` | Charge failed generations | (v6-solid) re-verified | `plan-gate.test.js`, `spend-guard.test.js` | ✅ |
| Unknown Stripe price | Fail closed | 400/config error, allowlist only | Wrong charge | (v6-solid) | `customers-unknown-price.test.js`, `webhooks.test.js` | ✅ |

---

## Residual / open (honest)

- **Process:** v7 prompts were implemented from extracted requirements, not
  executed verbatim START→END per commit; verification ran per commit-batch.
  This matrix closes the missing LB-00 audit artifact. See `docs/HANDOFF_V7.md` §2.
- **AskBox divergence:** the v7 doc references a landing AskBox handoff; v6
  removed it for the one-promise hero. Confirm with owner before restoring.
- **External blockers (not code):** live Stripe prices, `PUBLIC_URL`+domain,
  verified Resend domain, cron-job.org outbox trigger, legal entity, and one
  manual test-mode checkout. See `docs/BETA_GO_NO_GO.md`.

## Verification snapshot

`npm run check` → lint 0 errors · 242 backend tests pass · Vite build · app-fresh
hash match. `npm run test:e2e` → 18/18 Playwright. Every 🔧 row is guarded by a
regression assertion in `backend/tests/content-contract.test.js` so the fix
cannot silently drift back.
