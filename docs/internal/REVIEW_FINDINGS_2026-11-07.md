# Old-bug sweep, 2026-11-07 (Scalvya) - found, NOT fixed

Read-only sweep by parallel review agents, excluding everything already in
`REVIEW_FIXES_2026-11.md`. Nothing here is fixed yet; each needs the owner's OK.
"Verified" = re-checked in the code by hand after the agent report.

The server / schema / email sweep did not finish (session limit) and should be
re-run: schema-vs-code drift, server.js mount order, cron/admin routes,
lifecycle email recipients/unsubscribe, account delete/export completeness.

## High (frontend)

| # | Bug | Where | Verified |
|---|---|---|---|
| F1 | Email Studio ignores `?campaign=`: emails save with `campaign_id = null`, no brief snapshot, the approved brief is not in the prompt, the campaign never shows them. No local draft either (lost across the Stripe round-trip and on tab switch) | `app-src/routes/studios/EmailFlowStudio.jsx` | yes |
| F2 | Campaign Overview is stuck on "Choose what this campaign needs": `GET /api/campaigns/:id` returns the raw row without `deliverable_plan` / `asset_counts` (only the list route adds them) | `backend/routes/campaigns.js` (detail route), `campaign-next-action.js` | yes |
| F3 | Brief autosave reloads the whole workspace (`setCampaign(undefined)`): focus lost, groups collapse, typing during a save is lost on a silent 409 | `BriefEditor.jsx`, `CampaignWorkspace.jsx` load() | no |
| F4 | Active workspace is shared across browser tabs via localStorage: an agency with two tabs can overwrite client B's Brand Profile with client A's | `app-src/lib/api.js`, `BrandProfile.jsx` | no |
| F5 | Brand Profile load error shows an empty editable form; the first keystroke PUTs one field and replaces the whole stored profile | `BrandProfile.jsx` (`.catch(() => setProfile({}))`) | yes |

## Medium

| # | Bug | Where |
|---|---|---|
| B1 | Creative "ready" compliance gate only runs on the status change; later edits / AI rewrite / restore keep a non-compliant creative "ready" | `library.js`, `workspaces.js` |
| B2 | Brief approval is client-only: studios and `/strategy` generate from an unapproved brief; approval accepted with missing fields; `brief_approved_at` is read but no migration creates it (verified) | `campaigns.js` |
| B3 | Archived assets count as live in the gap map / review queue (false "all ready", unresolvable blocking findings) | `campaigns.js` assetsByTableFor |
| B4 | `resolveWorkspace` silently falls back to the first workspace when the requested one is archived/deleted - writes land in another client's workspace | `workspaces.js` |
| B5 | Idempotency takeover of a failed job is unconditional: two concurrent retries both run (double generation + double charge) | `idempotency.js` |
| B6 | Regenerate-section and the strategy prompt omit brand restrictions / proof / key message | `ai.js`, `campaigns.js` |
| F6 | "Fix key fields" inputs keep the pre-rewrite values; blurring one writes the old value back over the AI rewrite | `generator.jsx` StructuredEdits |
| F7 | Focus trap re-runs on every render (inline onEscape), focus jumps inside the paywall | `use-focus-trap.js` |
| F8 | Asset drawer: AI rewrite drops unsaved manual edits; switching assets keeps the old asset's state | `AssetDrawer.jsx` |
| F9 | Deleting the active workspace leaves the UI on it while the API serves another workspace | `Account.jsx` |
| F10 | Paid/trial user at the limit: "See plans" leads to checkout → 409 (top-ups now cover paid plans when pack prices are set; trial still dead-ends) | `generator.jsx`, `TrialPaywall.jsx` |
| F11 | An expired/revoked session mid-flow never reaches login; Brand Profile retries forever claiming changes are on the device | `api.js`, `BrandProfile.jsx` |
| F12 | A failed Handoff export replaces the whole Handoff panel with the error | `campaign/panels.jsx` |
| U1 | "resets on" date is a few days early for subscriptions anchored on the 29th-31st (cumulative month clamping) | `usage.js` windowResetsAt |
| U2 | The metering window looks the customer up by email, not the canonical app_user_id | `usage.js` windowStart |

## Low

Duplicate Stripe sessions on sign-in with a pending plan; Account billing spinner never resolves on non-503 errors; Library bulk archive / favourite / delete have no error handling and CSV exports one page; feedback text over 120 chars is dropped silently; double-click creates duplicate campaigns; Dashboard shows archived campaigns (`status` vs `archived`); reused idempotency key can replay an old result after edits; deep links lost on login; object URL revoked in the same tick (Safari); duplicated campaigns inherit export history; restore resets favourite/metrics; evidence links not moved/removed with the asset; unused `/api/ai/email/:id/subject|body` overwrite without a version; false "urgency without deadline" warnings; launch-kit item tables can be left empty on insert error; `finding_resolved` analytics missing `code`; duplicate `flow_types` exceed the schema max; `/strategy` skips `aiLimit`; items PATCH reports DB errors as 404.
