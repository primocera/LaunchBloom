# Golden campaign eval — v10 SC-03

Corpus version: **v10.1** · rules version: **v8.1** · prompt version: **v2**

## What this measures, and what it does not

The corpus in `backend/tests/fixtures/golden-campaigns.js` measures the
**deterministic quality gate**: given a campaign brief and a set of generated
assets, does the product catch the defects it promises to catch, and does it
stay quiet otherwise.

It does **not** measure generation quality. Nothing in this corpus comes from a
live model — every fixture is hand-written, so the suite costs nothing, cannot
flake, and runs on every push. Judging whether the model's output got *better*
requires the live harness below.

That distinction is the whole point. A green corpus means *the gate works*, not
*the writing is good*. No release document may claim the second from the first.

## The corpus

14 fixtures across the sectors the pack names: services, ecommerce, events,
regulated claims, multi-audience, and no-date campaigns.

**Four are clean and must produce zero findings.** These matter as much as the
failing ones: a checker that flags healthy campaigns trains people to ignore it,
which is indistinguishable from having no checker. Without clean baselines the
gate could pass by flagging everything.

**Ten isolate one defect each** (plus one that compounds four, because real
campaigns fail in combination): unsupported claim references, unresolved
placeholders, promo-term drift, conflicting destination URLs, a missing CTA, a
date outside the campaign window, audience drift, and a stale brief snapshot.

Each fixture states *why* it exists, so a failure reads as a product regression
rather than a broken assertion.

### Prohibited inventions

`PROHIBITED_INVENTIONS` guards the corpus itself — if banned claim language ever
appears in the reference copy, the fixture is the bug and every assertion built
on it is worthless.

## Baseline recorded at SC-V10-03

| Property | Value |
|---|---|
| Corpus | v10.1, 14 fixtures |
| Consistency rules | v8.1 |
| Prompt registry | v2 (`CURRENT_PROMPT_VERSION`) |
| Result | 14/14 fixtures match their expected findings; 4 clean fixtures produce none |
| Determinism | finding fingerprints stable across repeated runs |

Fingerprint stability is load-bearing: an acknowledgement is keyed to a
fingerprint, so if fingerprints moved between identical runs, resolved findings
would reappear forever.

## Prompts were deliberately NOT changed in this slice

The pack asks for a baseline first, then per-channel prompt improvement with
append-only version bumps in `prompt-registry.js`.

The baseline is recorded above. **No prompt was changed and no version was
bumped**, because improvement cannot be measured here: the eval harness runs in
mock mode with no `ANTHROPIC_API_KEY`, so a prompt edit would produce a version
bump with no evidence behind it — exactly the "configuration equals observed
behaviour" mistake v10 exists to remove.

Bumping a prompt version is a claim that output improved. That claim needs the
live harness.

## Running the live eval (owner, credentialed, costs money)

Not wired into CI by project decision: this repo runs on free tiers, and a job
that spends Anthropic credits on every push is not acceptable.

```bash
# Owner shell, with ANTHROPIC_API_KEY set. Spends real credits.
ANTHROPIC_API_KEY=... node --test backend/tests/golden-eval.test.js
```

With a key present, `generateJson` leaves mock mode and the schema-level golden
tests exercise real output. Per-channel scoring against the corpus rubric is
**not yet built** — it is the natural next step and belongs with whoever holds
the budget for it.

### Rubric for a human reviewing live output

Score each channel 1–5. Anything below 4 blocks a prompt version bump.

1. **Faithful** — every fact traces to the brief; nothing invented.
2. **Specific** — could not be reused verbatim for a different business.
3. **Structurally usable** — required fields present and the right length.
4. **Consistent** — offer, audience and CTA match across channels.
5. **Honest** — no proof, metric, urgency or guarantee the brief does not supply.

## Provenance

Prompt and schema version already reach the user: `provenanceLine` in
`app-src/components/AssetDrawer.jsx` renders campaign, brief version, prompt
version and source on every asset, and `lib/ai.js` records the registry version
at generation time. No change was needed in this slice — verified, not assumed.
