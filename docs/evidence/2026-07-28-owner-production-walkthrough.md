# Evidence — owner walkthrough of the signed-in product in production

**Item:** `owner_evidence.owner_production_walkthrough`
**Date (UTC):** 2026-07-28
**Verified by:** owner (primoz2.cerar@gmail.com)
**Environment:** production (`https://…` live deployment, live Stripe, live Resend)

## What was exercised

The owner used the real product, signed in, against production:

| Path | Result |
|---|---|
| Signup and login | works |
| Stripe checkout → 3-day trial → access granted | works |
| Cancel the subscription | works |
| AI generation | works |
| Lifecycle email delivery (Resend) | mail received |

## Why this is recorded as evidence

The launch record previously said the signed-in journey "has never been
executed" and treated that as a P0 for both tracks. That was accurate about
*automated browser coverage* and misleading as a statement about the product:
the owner has used the paid loop end to end in production and it works.
Continuing to call the core journey unproven, when the person who owns it has
walked it against live Stripe, would be the gate lying in the cautious
direction — which is still lying.

So the authenticated browser matrix is now scoped to `public_paid` rather than
required for a capped beta, with the rationale recorded on the check itself.

## What this does NOT cover

Stated plainly, because this is the evidence a beta is being opened on:

- **One person, one device, one browser, happy path.** Nothing here covers
  phone layout, keyboard-only operation, or a screen reader.
- **No cross-account isolation test.** That workspace A cannot read workspace
  B's campaign is enforced by ownership filters and unit tests, but nobody has
  driven two real accounts in a browser to confirm it.
- **No failure paths.** Session expiry, a provider timeout mid-generation, a
  reload during export, an interrupted checkout.
- **Not recorded while it happened.** No screenshots, no timestamps, no
  request logs. This is owner attestation, not an artefact anyone else can
  re-read.
- **Not pinned to the candidate SHA.** It describes production as deployed
  before v11 landed, so it says nothing about the v11 changes to the signup
  screen, the landing CTAs or the PDF export.

## Consequence

Good enough to open a **capped, supervised beta** of invited accounts with the
owner watching and a hard cap. Not good enough for an unrestricted public paid
launch, where nobody is watching and the failure paths above meet strangers.
`npm run test:e2e:auth` remains required for `public_paid` and is the thing
that closes the gaps listed above.
