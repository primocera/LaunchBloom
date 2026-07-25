# Capped beta — plan, scripts and weekly decision (v10 SC-07)

**Purpose:** prove that users complete, revisit and hand off campaigns *before*
expanding acquisition or adding product surface.

The question is not "do people generate content" — they will. It is whether the
campaign-control loop reduces real rework and produces something worth paying
for a second time.

## The cap

**15–25 accounts. Hard stop at 25.**

Invitations stop automatically at the cap: `BETA_INVITE_CAP` (default 25) is
enforced server-side, and the owner can pause earlier at any time. The cap
exists because below ~15 no rate means anything, and above ~25 the support load
prevents the interviews that make a beta worth running.

**Do not expand the cohort while any billing or data-safety P0 is open.**
See `docs/GO_NO_GO_V10.md` for the current list.

## What is measured

`GET /api/admin/cohort?days=30` — the eleven-step funnel:

workspace created → minimum Brand Profile → brief approved → first asset →
**three channel types** → finding resolved → Ready asset → handoff preview →
export → campaign reopened → subscription renewal

Every step reports numerator, denominator, window, state and the decision it
supports. Cohorts under 5 are **suppressed** — with 15–25 accounts most weekly
rates will genuinely not be conclusive, and saying so is the point.

The three steps that matter most, in order:

1. **Three channel types** — the difference between a campaign tool and a
   generator someone uses five times.
2. **Handoff exported** — the value moment. Work leaving the product.
3. **Subscription renewed** — the only durable proof the job was worth paying
   for.

Generation volume is deliberately **not** a success metric. Optimising it over
completed review and handoff would be optimising the wrong loop.

## Interview script (consented, optional, non-blocking)

Consent is asked once, recorded, and refusing changes nothing about the
account, the plan or support. Never make an interview a condition of access.

> "Can I record notes from this call? I'll keep them anonymous, and you can
> stop or withdraw at any point. Declining doesn't affect your account."

Questions are about rework, trust, effort, handoff and price — **not**
satisfaction. "How satisfied are you?" tells you nothing you can build from.

**Rework**
1. Walk me through the last campaign you built here. What did you do *after*
   the assets were generated, before anyone saw them?
2. What did you have to rewrite by hand? Which channel was worst?
3. Was there anything you had to check somewhere else before you trusted it?

**Trust**
4. Was there a moment you didn't believe an output? What did you do next?
5. The review findings — did you read them, act on them, or skip them? Why?
6. Has the product ever told you something that turned out to be wrong?

**Effort**
7. Compared to how you did this before, where did the time actually go?
8. What part of the setup felt like paperwork rather than progress?

**Handoff**
9. Who receives the finished work? What do they do with it?
10. Did you send the packet as-is, or change it first? What did you change?
11. What would have to be true for you to send it without opening it?

**Price**
12. What are you comparing this to — a tool, a freelancer, your own time?
13. If the price doubled, what would you do? If it halved, what would change?
14. What would make you cancel?

Do not lead. If someone volunteers praise, ask what they did last week instead.

## Weekly memo — continue / iterate / pause / stop

One page, same shape every week. Written from the cohort view, not from
impressions.

```
Week of: ____________        Cohort size: ____ (cap 25)

1. What the funnel says
   Biggest drop-off: ______ → ______ (lost __ of __)
   Steps suppressed for small cohort: ____________
   Steps at zero that should not be: ____________

2. What users said (2–3 quotes, anonymised, about rework/trust/effort)

3. Cost
   AI spend: $____   per activated: $____   per exporting: $____
   per renewed: $____   (null = denominator zero, not zero cost)

4. What we changed last week and what it did
   Change: ____________  Expected: ____________  Observed: ____________
   (One variable. If more than one changed, we learned nothing.)

5. DECISION  ☐ continue  ☐ iterate  ☐ pause  ☐ stop
   Because: ____________
   If iterate — the ONE variable next week: ____________
   Kill criteria still unmet: ____________
```

**Decision meanings**, agreed in advance so the weekly call cannot rationalise:

- **Continue** — the loop is working; keep the cohort, keep going.
- **Iterate** — one specific step is losing people; change one variable.
- **Pause** — invitations stop; existing users keep full access. Used when a
  P0, a trust problem or an unexplained metric appears.
- **Stop** — the paid job is not being completed and no single change is
  plausible. Say it out loud rather than letting the beta drift.

## Experiments — one variable at a time

Run **one** of these at a time. Running two means learning nothing from either.

| # | Variable | Hypothesis | Measured by |
|---|---|---|---|
| 1 | Recommended path (SC-V10-01) | One obvious path raises brief-approved | `brief_approved` step rate |
| 2 | Campaign Overview next action | A single next action raises three-channel-types | `three_channel_types` step rate |
| 3 | Handoff preview timing | Showing the packet earlier raises export | `handoff_exported` step rate |

**Start with #1.** It is the largest change already shipped, so it has the
clearest before/after.

No statistical significance will be claimed at this cohort size. A weekly
direction plus interview evidence is what a 20-person beta can honestly
support; anything more is a fabricated benchmark.

## Pruning review — low use, high maintenance, unclear ownership

Candidates. **Nothing is hidden or removed until a data-access check confirms
no user work becomes unreachable.**

| Route / feature | Concern | Data check required | Action |
|---|---|---|---|
| `/app/flow` | Superseded by campaign creation (SC-V10-01) | Already done — it is now the read-only index for legacy launch kits, which are linked from nowhere else | **Keep as archive** |
| `/app/kits/:id` | Legacy launch-kit model | Rows still exist and are reachable only via `/app/flow` | **Keep** until kit rows are migrated or confirmed empty per workspace |
| `/app/weekly-plan` | Low use; separate from the campaign loop | Does any workspace have weekly-plan data? | Review after 4 beta weeks |
| Legacy studio redirects (`/app/landing-page`, `/content-plan`, `/email-sequence`, `/ads`) | Four routes that only redirect | Any inbound links or bookmarks? | Keep — redirects are cheap and breaking a bookmark is not |
| `/api/campaigns/:id/review-packet` (md/html) | Superseded by DOCX/PDF/ZIP (SC-V10-04) | Are text formats still exported? Check `last_handoff_format` | Keep behind the "Plain-text formats" disclosure |

The rule: **a feature with no users can be hidden; a feature holding user data
cannot be removed** until that data is reachable elsewhere or provably absent.
