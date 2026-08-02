# Billing findings — live rehearsal, 2026-08-02

For the next prompt-pack author. Three billing defects surfaced while running real
money through Scalvya (and checking Mellowa). All are the kind of bug that passes
unit tests and a config check but strands a paying customer — worth explicit
prompt coverage and live-rehearsal steps.

## P0 — Paying customer shown as Free (stale-subscription masking)

**Symptom:** a real, successful Starter payment (€11.31) left the account on
**Plan: Free, 0 AI actions**. Stripe's billing portal showed the subscription
active; the app did not.

**Root cause:** `planFor` (routes/customers.js) selected ONE entitling
subscription row with `.limit(1)` and **no ordering**. The account held a second
entitling row on a now-retired price (which maps to no configured plan). planFor
landed on the retired-price row, failed the price→plan lookup, and returned
`null` → free — even though a valid current subscription existed.

**Fix:** `b037394` — scan ALL entitling rows (newest first), return the first
whose price maps; only stay free when none map (and log loudly). Regression test:
`backend/tests/customers-multi-sub.test.js`.

**Prompt-pack hardening:**
- Any entitlement resolver must be robust to MULTIPLE entitling rows and to a
  subscription on a **retired/unmapped price** — never let one stale row mask a
  valid one. Add a contract test for "valid sub + retired-price sub → still paid".
- Retiring or replacing a Stripe price id strands every customer still on it if
  the resolver keys strictly on the current env price ids. Prefer editing prices
  in place (currency_options) over minting new ids; if ids must change, migrate
  existing subscriptions.

## P1 — Renewal date null / "renews on ." (Stripe moved the field)

**Symptom:** account page showed "Starter renews on **.**" (blank date).

**Root cause:** on Stripe API version `2026-04-22.dahlia`,
`subscription.current_period_end` is undefined — the field moved onto the
subscription **item** (`subscription.items.data[0].current_period_end`). The
webhook stored null.

**Fix:** `f3917c7` — read the item-level period with a top-level fallback; the
page shows "<plan> is active" when no date is present instead of a bare ".".

**Prompt-pack hardening:**
- When mirroring Stripe objects, read period/renewal fields from the subscription
  ITEM with a top-level fallback. Pin/track the API version; a version bump can
  silently move fields.

## Lesson (Mellowa) — displayed currency must equal charged currency

Mellowa's live prices were **USD** behind €9.99/€59.99 labels (owner confirmed the
charge currency by live test). Any surface that shows a price must be asserted
against the ACTUAL Stripe price currency+amount, and a real recent payment's
currency is authoritative over any static check. See docs/EUR_PRICING_HANDOFF.md.

## Launch-gate implication

All three predate the frozen v12 candidate (`1e46543`) or landed after it, so that
candidate is now superseded: a NEW release candidate including `b037394` +
`f3917c7` (and the EUR pricing commits) must be cut before `public_paid` can move
toward GO, and the owner must reconfirm on the deployed candidate that a live
paid account shows its plan and renewal date. Even then, `public_paid` stays
CONDITIONAL GO while the `authenticated-e2e` risk remains accepted.
