# Value Analytics v9 — cockpit funnel, beta learning & pruning

Extends `VALUE_ANALYTICS_V8.md`. Metrics are **decision aids, not marketing
claims** — never shown to customers as proof. All events carry codes/bands/counts
only; the privacy boundary is enforced by `sanitizeProperties` (drops content/PII)
and the `CLIENT_EVENTS`/`CANONICAL_EVENTS` registries in `backend/lib/analytics.js`.

## The cockpit funnel

Server-confirmed, deduped milestones (unchanged from v8's `VALUE_FUNNEL`):

workspace_created → minimum_profile_reached → brief_approved →
deliverable_plan_saved → first_generation → first_finding_resolved →
first_asset_ready → campaign_completed (handoff produced) → day7_returned

Each step's `dedupe` key and decision question live in `VALUE_FUNNEL`. A step is
counted at most once per scope (`ws:{id}` / `campaign:{id}`) so retries/replays
never inflate it.

## New v9 diagnostic events

Client-fired (allowlisted in `CLIENT_EVENTS`; dropped otherwise). Bands = `0`,
`1-3`, `4-10`, `10+`.

| Event | Trigger | Server-confirmed | Allowed fields | Decision it informs |
|-------|---------|------------------|----------------|---------------------|
| campaign_section_viewed | Workspace section opened | no | section, state | Which cockpit jobs get attention |
| next_action_viewed | Recommended action shown | no | action_code, severity, evaluated | Is the next step legible? |
| next_action_completed | Action advanced after a durable change | no | action_code, next, evaluated | Does the cockpit move work forward? |
| brief_section_completed | Brief group fully filled | no | section | Where briefs stall |
| approved_brief_reopened | Approved brief reopened | no | had_strategy | Rework after approval |
| review_item_opened | Review item opened | no | group, severity, kind, bucket | Which risks users engage |
| review_item_resolved | Item resolved by explicit action | server (ack/keep) + client | group/kind, resolution, severity | Do users clear review, not just generate? |
| asset_opened / version_compared / version_restored | Library drawer / compare / restore | no | type, status | Editing & version reliance |
| export_completed | Asset exported from drawer | no | type, status, format | Which formats matter |
| handoff_previewed / handoff_exported | Handoff screen / export | **yes** | format, asset_count_band, blocker_count_band | The value moment |
| onboarding_path_selected | Landing path chosen | no | path (own\|client) | ICP split (SC-08 test) |

## Admin cohort view

Read cohorts from `analytics_events` with an explicit **numerator, denominator,
date window and cohort definition**. The dashboard must distinguish three states:
**no data**, **insufficient data** (below a minimum sample), and **below
hypothesis**. Segment only by safe `plan` / `use_case` categories with adequate
sample size. AI cost per activated/completed/retained account is computed from
`ai_spend_ledger` — never joined to customer content.

## Three four-week beta tests (one variable, one primary metric each)

1. **Onboarding path** — own vs client-work guidance → primary: `campaign_completed` rate.
2. **Overview next action** — deterministic action vs none → primary: `next_action_completed` → `campaign_completed`.
3. **Handoff preview before trial/upgrade** → primary: trial start / retention.

Experiments change one variable; rollback = remove the flag, no data migration.

## Interview triggers (consented, optional, neutral)

Fire an interview invite (never blocking) on: drop-off after brief approval,
after first generation, after first blocker, and after first export. Script asks
about **lost time, rework, confidence and willingness to pay** — not a feature
wish-list.

## Stop criteria (stop acquisition & interview before adding generators)

- Near-zero `campaign_completed` among activated workspaces.
- Near-zero `day7_returned` among completers.
- High abandonment with unresolved blockers (`review_item_opened` without resolve).
- Refund/complaint spike, or AI cost per completed account exceeds unit economics.

## Product-pruning review

Maintain a table of routes/features × usage × user job × maintenance/safety cost.
Deprecate only after **preserving data access** and measuring impact — never
remove a user's access to their own data when hiding a surface.

## Weekly beta review

One meeting decides: **continue / change / interview / pause / prune** — using
the funnel, cohort states and cost per completed account. No vanity generation
target, no arbitrary "healthy" score.
