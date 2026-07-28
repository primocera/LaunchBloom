# Capped beta — weekly scorecard

The cohort, the cap and the funnel definition live in `docs/BETA_PLAN_V10.md`
and are unchanged. This is the **weekly decision sheet**: one page the owner
fills in from `GET /api/admin/cohort?days=30` plus the feedback categories, and
which forces a keep / fix / stop decision rather than a list of feature
requests.

## Rules for filling it in

1. **Every rate carries its numerator and denominator.** "60% exported" from
   3 of 5 accounts is not the same claim as 60 of 100, and writing only the
   percentage hides that.
2. **No data is written as `no data`, never as `0%`.** A step nobody reached
   yet and a step everybody failed are different facts.
3. **Cohorts under 5 are suppressed** by the endpoint. Leave the row as
   `suppressed (n<5)`; do not work around it by widening the window.
4. **Decide something.** A week with no decision is a week the beta cost
   support time and bought nothing.

## Week of `__________` · cohort size `____` · window `30d`

| Step | Numerator | Denominator | Rate | Target | Decision |
|---|---:|---:|---:|---:|---|
| Workspace created | `____` | `____` | `____` | — | `____` |
| Minimum Brand Profile | `____` | `____` | `____` | `____` | `____` |
| Brief approved | `____` | `____` | `____` | `____` | `____` |
| First asset saved | `____` | `____` | `____` | `____` | `____` |
| **Three channel types** | `____` | `____` | `____` | `____` | `____` |
| Finding resolved | `____` | `____` | `____` | `____` | `____` |
| Ready to export asset | `____` | `____` | `____` | `____` | `____` |
| Handoff previewed | `____` | `____` | `____` | `____` | `____` |
| **Export completed** | `____` | `____` | `____` | `____` | `____` |
| Campaign reopened | `____` | `____` | `____` | `____` | `____` |
| **Subscription renewed** | `____` | `____` | `____` | `____` | `____` |

The three bold rows are the beta's actual question. The rest are diagnostics
that explain them.

### Time to value

| Measure | Median | n | Notes |
|---|---:|---:|---|
| Time to first approved brief | `____` | `____` | `____` |
| Time to first export | `____` | `____` | `____` |
| Review blockers resolved per campaign | `____` | `____` | `____` |

### Feedback categories (from `beta_feedback`)

Counts only. Free-text notes are read individually during interviews and are
never aggregated here — they are not a metric.

| Question | Answers | n |
|---|---|---:|
| What did you finish? | full `__` · part `__` · single asset `__` · nothing usable `__` | `____` |
| How much manual work? | almost none `__` · light `__` · heavy `__` · rewrote most `__` | `____` |
| Price for what you got? | worth more `__` · about right `__` · too high `__` · would not pay `__` | `____` |

`nothing usable`, `rewrote most` and `would not pay` are the three answers
worth acting on. If they cluster, the problem is the loop, not the pricing
page.

### Support and cost

| Signal | This week | Notes |
|---|---:|---|
| Support conversations | `____` | `____` |
| P0 / P1 opened | `____` | `____` |
| AI spend (7d) | `____` | against the ceiling in `docs/OWNER_EVIDENCE_V11.md` |
| Refunds / cancels | `____` | reason categories only |

## This week's decision

Exactly one of:

- [ ] **Keep going** — the loop is working; continue the cohort unchanged.
- [ ] **Fix** — one named blocker, repeated by more than one account:
      `______________________________`
- [ ] **Stop** — the loop is not reducing rework; do not expand acquisition.

**Feature work stays frozen during the beta.** Requests are routed into problem
categories and only P0 safety/money/data issues or a repeated P1 blocker are
implemented. A request from one account is an anecdote; the same blocker from
three is a finding.

**Expansion gate:** the cohort does not grow past the cap, and public paid
launch stays NO-GO, until `docs/OWNER_EVIDENCE_V11.md` is complete and the
export and renewal rows above are non-suppressed and meeting target.

Signed: `__________`  Date: `__________`
