# Capped-beta value scorecard (SC-P1-12)

Purpose: run a controlled 10–20 user ICP beta and decide **expand / iterate /
stop** on evidence that customers repeatedly reach paid value — not on page
views. This scorecard is an **internal decision aid**. Nothing here may be shown
to a customer or quoted as public proof, and no number here is statistically
significant at beta scale.

Source of truth: the append-only analytics ledger (`analytics_events`), read
through `backend/lib/beta-scorecard.js` and exposed read-only at
`GET /api/admin/beta-scorecard?days=7` (admin only, audited).

## Event model (value loop)

Pseudonymous ids only — never offer text, briefs, generated copy, emails, brand
voice, user email, or raw identifiers. Envelope: `schema_version` (`v13.1`),
`event`, `ts`, `env`, `source`, plus categorical `properties`. Idempotency: each
once-per-scope milestone is written with a `dedupe_key`, so a retried webhook,
re-posted client event, or re-run job counts **at most once**.

| Value-loop event | Ledger event (server-confirmed) | Scope | Question it answers |
|---|---|---|---|
| brand_profile_completed | minimum_profile_reached | workspace | Enough brand to work with? |
| campaign_brief_completed | brief_approved | campaign | Do they commit to a campaign? |
| first_generation_completed | first_generation | workspace | Do they produce anything? |
| first_asset_reviewed | first_finding_resolved | workspace | Do they engage with review? |
| first_asset_ready_to_export | first_asset_ready | workspace | Do they finish an asset? |
| campaign_reached_ready | campaign_completed | campaign | Do they complete the paid job? |
| first_export | first_asset_exported | workspace | Do they take value out? (value moment) |
| second_campaign_created | _(not yet instrumented — reports `unavailable`)_ | workspace | Do they repeat? |
| workspace_returned | day7_returned | workspace | Do they return across days? |

Failure taxonomy for `*_failed` events (properties.reason): `timeout`,
`model_error`, `rate_limited`, `invalid_output`, `plan_limit`, `spend_ceiling`,
`validation_failed`, `cancelled`, `other`. Free-text reasons are rejected.

## Derived metrics

Time to first reviewed asset, time to first export, campaign completion rate,
retry/failure rate **by studio**, second-campaign rate, D1/D7/D30 workspace
return, trial-to-paid conversion, paid retention, export frequency per active
workspace.

**Denominator rule:** every activation-funnel rate is measured against ONE base
— the **activated cohort** (distinct workspaces that completed a brand profile).
Mixing denominators is how funnels lie, so we do not. Technical failure
(generation failure rate) is reported **separately** from product-fit funnel
steps so product quality, technical failure, and acquisition quality never blur.

Cohorts below **5** subjects are suppressed (`insufficient_data`), and
`no_data` / `unavailable` are kept distinct from a real zero.

## Staff / test / demo exclusion (auditable)

Excluded from all KPIs by a pure, reproducible rule driven by env, so an
operator can audit exactly which accounts left the base and why:
`STAFF_EMAILS` (exact), `STAFF_EMAIL_DOMAINS`, `STAFF_WORKSPACE_IDS`,
`STAFF_USER_IDS` (falls back to `ADMIN_EMAILS`). `classifyAccount()` returns the
reason (`staff_email` / `staff_domain` / `staff_workspace` / `staff_user`).
Denominators are never otherwise manipulated.

## Weekly cohort view

Per week: invited, activated, first reviewed asset, first export, campaign
ready, second campaign, paid, retained, canceled, and top failure reasons.

## Provisional gates — HYPOTHESES, not market facts

Chosen **before** collecting results. Marked `hypothesis: true` in code and here
so none is ever quoted as a benchmark. Expand only when **all** hold:

- **reviewed_asset_rate** ≥ 60% of activated users reach a reviewed asset.
- **generation_failure_rate** ≤ 5% of generation attempts fail.
- **campaign_completion_rate** ≥ 40% of activated users reach campaign-ready.
- **second_campaign_rate** ≥ 25% of activated users start a second campaign.
- **billing_incident** = zero billing-severity incidents in the window.
- **qualitative_confirmation** = interviews confirm the coordinated campaign
  saves meaningful rework.

Iterate if the funnel is healthy but interviews disagree; stop if activated
users do not reach a reviewed asset or generation failure is high.

## Failure isolation

Analytics is best-effort everywhere: `track()` swallows errors, the scorecard
route degrades a failed pull to an empty cohort, and `computeScorecard()` never
throws on malformed input. Analytics never blocks core product use or leaks
data.
