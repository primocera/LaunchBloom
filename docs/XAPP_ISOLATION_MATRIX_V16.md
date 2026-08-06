# Cross-app Stripe isolation matrix — Scalvya side (XAPP-95-01)

One Stripe account serves **Scalvya** and **Mellowa** (and Frost). Stripe
broadcasts every event of a subscribed type to every endpoint on the account, so
isolation must be enforced *inside* each app, at every boundary — never by
separate URLs.

**Ownership stamps (namespaces do not overlap):**

- Scalvya customer: `metadata.source === 'launchbloom'` **and** `metadata.app_user_id === <stable user UUID>` (`APP_STRIPE_SOURCE` in `backend/routes/payments.js`).
- Scalvya checkout session: `metadata.scalvya === '1'` (the only event that upserts `customers.stripe_customer_id`).
- Mellowa customer: `metadata.app === 'mellowa'` + `metadata.supabase_user_id` (different keys — no collision).

**One rule, applied at every boundary** (`isOwnedScalvyaCustomer`): object
presence, a local DB row, or email equality is never proof. Missing metadata,
wrong `source`, wrong `app_user_id`, or a deleted object all fail closed.

| Boundary | Object / event | Ownership rule | Foreign → | Test |
|---|---|---|---|---|
| Checkout — durable DB link | Customer (`customers.stripe_customer_id`) | `isOwnedScalvyaCustomer` | reconciliation-required, no session, link untouched | `billing-customer-ownership.test.js` |
| Checkout — search recovery | Customer | exact `source` + `app_user_id` search filter | not returned | `billing-idempotent-customer.test.js` |
| Checkout — created response | Customer | `isOwnedScalvyaCustomer` on the create response | unavailable, no session | `billing-customer-ownership.test.js` |
| Checkout — link-race winner | Customer | `isOwnedScalvyaCustomer` on read-back | reconciliation-required, not adopted | `billing-customer-ownership.test.js` |
| **Billing portal** | Customer | `isOwnedScalvyaCustomer` before `billingPortal.sessions.create` | 404, no portal session | `xapp-account-isolation.test.js` |
| **Account delete** | Customer → Subscriptions | `isOwnedScalvyaCustomer` before `subscriptions.list/cancel` | cancellation **skipped**, no cross-tenant mutation; local data still deleted | `xapp-account-isolation.test.js` |
| Webhook `checkout.session.completed` | Session | `metadata.scalvya === '1'` (exact) | acked (200) and dropped, no customer upsert | `webhook-isolation.test.js` |
| Webhook `customer.subscription.*` | Subscription | our `app_user_id` stamp or a configured `STRIPE_PRICE_*` | acked and dropped | `webhook-isolation.test.js` |
| Webhook `invoice.*` | Invoice | mirrored subscription or our price | acked and dropped | `webhook-isolation.test.js` |
| Webhook `charge.*` / dispute | Charge | our metadata stamp or mirrored subscription | acked and dropped | `webhook-isolation.test.js` |

**Failure semantics:** foreign / unresolved input produces **zero** side effects
— no DB mutation, no entitlement, no email, no analytics, no trial consumption,
no Checkout/Portal session, no customer creation, no subscription cancellation.
Public messages stay generic (billing-unavailable / start-a-plan); operator
signals (`ownership_mismatch`, `stale_link_recovered`, `link_race_reconciliation`)
carry categories only — never email, Stripe ids, or the other product's details.

**Owner-run, not passed by mocks:** production price verification and the
live-money lifecycle (charge → trial/charge-date → entitlement → cancel →
reactivate/recover → portal → refund) remain owner-run; this matrix is the
mechanical (fixture-level) half.
