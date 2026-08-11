# Beta value cohort — predeclared plan (LB-V17-07)

> **Predeclared before data collection.** Entry, exclusions, maturity, minimum
> cell size, denominators and decision actions are fixed here so results cannot
> be reinterpreted after the fact. This plan adds **no** new generators,
> publishing, client accounts, share links or analytics vendor — it executes the
> existing scorecard/cohort/admin foundation.
>
> Instrumentation source of truth: `backend/lib/cohort.js` (the funnel + states),
> `backend/lib/beta-scorecard.js`, the weekly loop in
> `docs/BETA_WEEKLY_DECISION_V16.md`, and the interview guide in
> `docs/BETA_INTERVIEW_GUIDE_V13.md`. Nothing computed there is a customer-facing
> or public claim.

## Objective

Show that target users (freelance marketers / boutique agencies) **repeatedly**
get a useful handoff and reduce editing/rework — not that the product generates
assets. Public-paid confidence rests on observed repeat value, not test count.

## Cohort definition (fixed)

- **Size:** 25–50 supervised ICP workspaces. Below the `MIN_COHORT` (5) small-cell
  threshold in `cohort.js`, every rate is suppressed as `insufficient_data`.
- **Window:** a single 4-week observation window per workspace, measured from its
  own `workspace_created` (per-subject maturity, not a shared calendar week).
- **Entry:** an invited workspace that reaches a minimum Brand Profile within the
  window. Acquisition is out of scope for this metric (see funnel step 1's
  decision note).
- **Exclusions:** staff/test workspaces (existing staff-exclusion in the
  scorecard), workspaces created before the invite, and any workspace flagged as
  a support/duplicate artifact.
- **Timezone:** all maturity and "distinct day" logic is evaluated in UTC.
- **Denominator:** the FIRST funnel step (workspaces that entered), never a
  rolling base — so every downstream rate is comparable (`cohort.js` enforces).
- **Maturity:** a workspace counts toward a milestone only after ≥ the window has
  elapsed OR it has already reached that milestone. Immature = `insufficient_data`,
  never a zero.

## Decision metrics (each maps to a server-authoritative event)

| Decision question | Funnel step / event | Reads |
|---|---|---|
| Do they start? | `workspace_created` | acquisition, not product |
| Enough to work with? | `minimum_profile_reached` | setup friction |
| Commit to a campaign? | `brief_approved` | brief-as-decision |
| Produce anything? | `first_asset_saved` | generation reachability |
| Use it as a CAMPAIGN? | `three_channel_types_reached` | the paid job |
| Engage with review? | `first_finding_resolved` | consistency engine |
| Finish an asset? | `first_asset_ready` | rework burden |
| Reach the deliverable? | `handoff_previewed` | packet discoverability |
| **Take the work out?** | `handoff_exported` | **the value moment** |
| **Come back for a 2nd campaign?** | `approved_brief_reopened` / distinct 2nd `brief_approved` | **repeat value** |
| **Pay a second time?** | `subscription_renewed` | durable willingness to pay |
| Money health | `charge.refunded` / `charge.dispute.*` ops signals | billing trust |

Any milestone whose event is not emitted reports `unavailable` (never a zero) —
add instrumentation ONLY where it answers a decision above, never speculatively.

## Qualitative (fixed template)

Per `docs/BETA_INTERVIEW_GUIDE_V13.md`: previous process, time-to-usable-handoff,
editing/rework burden, client-review confidence, repeat use, willingness to pay.
Interview notes live OUTSIDE product analytics; publish no testimonial without
separate written consent.

## Predeclared decision actions (fixed BEFORE results)

- **Expand** the cohort only if: no open P0 (billing/privacy/data/cross-app),
  the value moment (`handoff_exported`) and a distinct second campaign are
  `reported` (not suppressed) with mature denominators, and generation-failure /
  refund / dispute / support burden are within threshold.
- **Hold** if metrics are immature or mixed — keep observing, change nothing.
- **Investigate** one weak metric with ONE bounded learning change — not broad
  feature expansion.
- **Stop / roll back** on any billing/privacy P0, cross-app incident, unresolved
  P1, dispute, excess generation failure, or an unsupported-claim regression.

## Guardrails

Under-5, immature, stale and unavailable are DISTINCT from a zero or a pass
(`cohort.js` states). No-data never becomes zero. Thresholds are not re-tuned
after seeing results. Synthetic data is labelled NOT CUSTOMER EVIDENCE.

## Status

**NOT RUN.** This is the predeclared plan; the cohort itself is owner-executed.
The `public_paid` mature-value evidence stays PENDING until the value moment and
a distinct second campaign are observed with mature denominators.
