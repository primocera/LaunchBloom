# Weekly capped-beta decision record (SC-95-05)

This record is **generated** from the canonical value scorecard
(`GET /api/admin/weekly-decision`, backed by `backend/lib/weekly-decision.js`),
not filled in by hand. It applies the **pre-declared** hypotheses (fixed before
the cohort, `predeclared_at: 2026-08-06`) and explicit maturity rules, then maps
the result to exactly one decision and one bounded action.

**Rules that keep it honest**

- Gates are HYPOTHESES, never benchmarks or customer-facing proof.
- A windowed metric (repeat campaign ≥14d, D7 ≥7d, renewal ≥30d) is `pending`
  until the cohort is old enough. **New users are pending, not failures.**
- No-data / insufficient / pending / below / pass are mechanically distinct.
- An analytics outage makes every metric `unavailable` and blocks expansion —
  never a decision from a zero.
- One low metric → one bounded learning action at the relevant stage (remove
  friction / rework), **never** "add another generator".
- Beta readiness may reach 9.5 after technical + owner gates. Public-paid
  readiness cannot without mature value and real billing evidence.

## Pre-declared gates (do not tune after a cohort starts)

| Gate | Hypothesis | Maturity window |
|---|---|---|
| `reviewed_asset_rate` | ≥ 60% of activated reach a reviewed asset | none |
| `generation_failure_rate` | ≤ 5% of generation attempts fail | none |
| `campaign_completion_rate` | ≥ 40% of activated reach campaign-ready | none |
| `second_campaign_rate` | ≥ 25% of activated start a second campaign | 14 days |
| billing incidents | zero billing-severity incidents in the window | none |
| qualitative | interviews confirm coordinated handoff reduced rework | interview |

## Decision ladder (one decision per week)

1. Any billing-severity incident → **Stop** (halt expansion, investigate first).
2. Analytics unavailable → **Continue** (status quo, no expansion; restore analytics).
3. Generation failure above ceiling → **Pause intake** (fix reliability).
4. Reported heavy rework / nothing-usable → **Interview** before changing product.
5. A mature gate below hypothesis → **Iterate** at the largest drop (one flagged experiment).
6. All mature gates pass + reduced-rework supported → **Continue**, expansion allowed.
7. Otherwise (pending / immature / too small) → **Continue** gathering.

## Blank weekly template

```
Week of: __________            Cohort start: __________   Cohort age (days): ____
Invited: ____   Activated: ____   Reportable (>= MIN_COHORT): yes / no
Data available: yes / no

Gates:
  reviewed_asset_rate ........ ____%  [pass | below | insufficient | no_data | unavailable]
  generation_failure_rate .... ____%  [pass | below | ...]
  campaign_completion_rate ... ____%  [pass | below | ...]
  second_campaign_rate ....... ____%  [pass | below | pending(<14d) | ...]
  billing incidents .......... ____   (0 required)

Largest drop: ______ -> ______  (lost __ points)
Handoff feedback: respondents ____ / response ____%  reduced-rework claim: supported / BLOCKED

DECISION: Continue | Interview | Iterate | Pause intake | Stop
Expansion allowed: yes / no
ONE action: ______________________________________________
```

## Synthetic example — NOT CUSTOMER EVIDENCE

> Illustrative only. Fabricated numbers to show the shape; **no real user data.**

```
Week of: 2026-09-01           Cohort start: 2026-08-02   Cohort age (days): 30
Invited: 20   Activated: 10   Reportable: yes
Data available: yes

Gates:
  reviewed_asset_rate ........ 30%   [below]
  generation_failure_rate .... 2%    [pass]
  campaign_completion_rate ... 50%   [pass]
  second_campaign_rate ....... 30%   [pass]
  billing incidents .......... 0     [pass]

Largest drop: first_generation_completed -> first_asset_reviewed (lost 60 points)
Handoff feedback: respondents 6 / response 60%  reduced-rework claim: BLOCKED

DECISION: Iterate
Expansion allowed: no
ONE action: Remove friction at first_generation -> first_asset_reviewed; one
            experiment behind an owner flag, one canonical flow preserved.
```
