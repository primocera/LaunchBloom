# Value analytics, beta experiments & kill criteria (v8 LB-S09)

Decision-grade measurement for the LaunchBloom campaign-control value loop. The
question this document answers: **do paid users repeatedly complete and re-export
campaigns?** Generation volume and clicks are diagnostic only — completion and
return are the value signals.

> Sample-size honesty: beta cohorts are small and directional. Nothing here is a
> validated benchmark or a causal claim. Where a prior doc stated a target, it is
> a **hypothesis** until enough completions exist to say otherwise.

## 1. The one canonical funnel

Defined in `backend/lib/analytics.js` → `VALUE_FUNNEL`. Each step is a
documented event in `CANONICAL_EVENTS`, server-confirmed where possible, and
carries only categorical properties (no prompt/asset text, proof, URLs, email,
brand name, or free-text reasons — enforced by `sanitizeProperties`).

| # | Step (event) | Scope | Dedupe key | Question |
|---|--------------|-------|-----------|----------|
| 1 | `workspace_created` | workspace | `ws:{workspaceId}` | How many accounts start? |
| 2 | `minimum_profile_reached` | workspace | `profile:{workspaceId}` | Enough to work with? |
| 3 | `brief_approved` | campaign | `brief:{campaignId}` | Do they commit to a campaign? |
| 4 | `deliverable_plan_saved` | campaign | (first per campaign, derived) | Do they scope the work? |
| 5 | `first_generation` | workspace | `gen:{workspaceId}` | Do they produce anything? |
| 6 | `first_finding_resolved` | workspace | `finding:{workspaceId}` | Do they engage control, not just generate? |
| 7 | `first_asset_ready` | workspace | `ready:{workspaceId}` | Do they finish an asset? |
| 8 | `campaign_completed` | campaign | `done:{campaignId}` | **Do they complete + export? (value moment)** |
| 9 | `day7_returned` | workspace | `d7:{workspaceId}` | Do they return to revise/export? (retention) |

**Idempotency.** `track(event, { dedupeKey })` writes `analytics_events.dedupe_key`
(migration `033_analytics_dedupe.sql`, partial unique index) and upserts with
`ignoreDuplicates`, so a redelivered webhook, re-posted client event, or re-run
job counts a milestone **at most once**. Volume/diagnostic events omit
`dedupeKey` and stay unconstrained. Step 4 is intentionally repeatable
(plan edits are useful diagnostics); first-per-campaign is derived in the cohort
query below, not by dropping rows.

## 2. Cohort queries (operator)

Run against `analytics_events`. Replace `:since`. All read-only.

**Funnel conversion (accounts reaching each step):**
```sql
with cohort as (
  select distinct workspace_id from analytics_events
  where event = 'workspace_created' and created_at >= :since
)
select e.event, count(distinct e.workspace_id) as accounts
from analytics_events e join cohort c on c.workspace_id = e.workspace_id
where e.event in ('workspace_created','minimum_profile_reached','first_generation',
                  'first_finding_resolved','first_asset_ready','day7_returned')
group by e.event;
```

**Time-to-value (workspace_created → first campaign_completed):**
```sql
select percentile_cont(0.5) within group (order by ttv_hours) as median_hours,
       count(*) as completed
from (
  select w.workspace_id,
         extract(epoch from (min(d.created_at) - min(w.created_at)))/3600 as ttv_hours
  from analytics_events w
  join analytics_events d
    on d.workspace_id = w.workspace_id and d.event = 'campaign_completed'
  where w.event = 'workspace_created' and w.created_at >= :since
  group by w.workspace_id
) t;
```

**Multi-channel adoption** — campaigns whose plan spans ≥2 deliverables:
count `deliverable_plan_saved` rows where `properties->>'total'` ≥ 2.

**Finding resolution rate:** `finding_resolved` distinct workspaces ÷
`consistency_check_viewed` distinct workspaces.

**D7 / D30 return:** `day7_returned` distinct workspaces ÷ `workspace_created`
(D30 = same with a 30-day return event when added).

**Trial conversion:** `subscription_activated` ÷ `trial_started`.

**Cancellation reasons:** `select properties->>'reason_category', count(*) from
analytics_events where event = 'subscription_canceled' group by 1;`
(categorical only — free text is never stored.)

## 3. Beta experiments (one variable each)

Each: hypothesis · eligibility · primary metric · guardrail · sample limitation ·
decision rule · rollback. Small samples → directional, not significant.

**E1 — Package preview before checkout.**
- Hypothesis: showing the deterministic package preview raises trial starts.
- Eligibility: new workspaces at the paywall. Variable: preview shown vs not.
- Primary: `paywall_viewed → trial_started`. Guardrail: refund/cancel rate.
- Limitation: < ~100/arm → directional only.
- Decision: ship if trial-start lifts and guardrail flat; else revert.
- Rollback: feature flag off; preview code stays (adds no AI action).

**E2 — Deliverable-plan default.**
- Hypothesis: a sensible default plan raises campaigns reaching `first_asset_ready`.
- Eligibility: new campaigns. Variable: prefilled plan vs empty.
- Primary: `brief_approved → first_asset_ready`. Guardrail: plan-edit rate
  (a too-aggressive default that everyone rewrites is a fail).
- Decision: ship if completion lifts without an edit-rate spike.
- Rollback: default off; manual plan remains.

**E3 — First-review guidance.**
- Hypothesis: inline first-finding guidance raises `first_finding_resolved`.
- Eligibility: workspaces with ≥1 open finding. Variable: guidance shown vs not.
- Primary: `consistency_check_viewed → first_finding_resolved`. Guardrail:
  unjustified bulk-acknowledge rate.
- Decision: ship if resolution lifts without bulk-ack abuse.
- Rollback: guidance copy off.

## 4. Kill criteria

If, across the 4-week beta, users **do not complete a campaign** (step 8) or **do
not return to revise/export** it (step 9) at a meaningful rate, **stop shipping
new generators.** Instead run user interviews and usability studies to find where
the control loop breaks. More generators on an unfinished loop scales cost, not
customer value. Concretely, trigger the stop-and-interview review if either:
- `campaign_completed / workspace_created` stays near zero after activation, or
- `day7_returned` among completers stays near zero (one-and-done usage).

These are decision triggers, not validated thresholds — set the exact cutlines
with the owner once real completion volume exists.

## 5. Privacy contract

- Prohibited properties (never stored): raw prompts, asset text, proof text,
  URLs, email, brand/business name, free-text cancellation reasons. Enforced by
  `sanitizeProperties` (sensitive-key regex + nested/long-string drop) and
  covered by `analytics-privacy.test.js`.
- No fingerprinting, cross-site tracking, or content analytics.
- Retention/deletion follows the account contract: `POST /api/account/delete`
  states analytics are retained anonymized (no PII in properties, and account
  deletion revokes identity); export via `GET /api/account/export`.
- Analytics failure never blocks the product (`track` swallows all errors).
