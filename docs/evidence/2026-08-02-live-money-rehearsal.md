# Live-money rehearsal — 2026-08-02

Owner-executed live billing evidence against real Stripe, recorded step by step to
close risk `live-money` (`P1-live-money-unrehearsed`). The owner performs every
live charge/refund; Claude only records the attested Stripe evidence.

Context: run against current production (post-EUR pricing). Charges are in **EUR**
now that region pricing is live. Card and customer are the owner's own test account.

## Transition matrix

| # | Transition | Status | Evidence |
|---|------------|--------|----------|
| 1 | New subscription charged (access granted) | ✅ DONE | €11.31 EUR **Succeeded**, `checkout.session.completed` `evt_1TzxO00YzvSNMCpNx4aORP9p` delivered **200 OK** (webhook), card ••••9065, customer fitsprimozem@gmail.com, 2026-08-02 13:16 CEST |
| 2 | Cancel (access ends at period end) | ⏳ pending | |
| 3 | Reactivate / resubscribe (access restored) | ⏳ pending | |
| 4 | Payment failed (declined) → entitlement gated | ⏳ pending | |
| 5 | Recovery (retry succeeds → access restored) | ⏳ pending | |
| 6 | Late `payment_failed` AFTER recovery (SC-00 ordering case) | ⏳ pending | |
| 7 | Refund issued (entitlement + records correct) | ⏳ pending | |

## Notes

- Step 1 confirms the happy-path charge and that the webhook handler acknowledged
  `checkout.session.completed` with 200 (no delivery failure).
- Remaining steps to be appended as the owner runs them. Risk `live-money` stays an
  accepted risk (public_paid CONDITIONAL GO) until the recovery/ordering/refund
  steps are recorded — those are the ones the risk was actually about.
