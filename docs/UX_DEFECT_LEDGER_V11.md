# v11 · UX defect ledger

What was observed, what was fixed, and — stated plainly — what could not be
observed at all. Public surfaces were walked in a real browser; authenticated
surfaces were not, because the matrix that walks them is blocked on
credentials (see `docs/RUNBOOK_AUTH_E2E.md`).

## Fixed in v11

| # | Route / state | Severity | Defect | Fix | Guarded by |
|---|---|---|---|---|---|
| 1 | Landing header, hero and closing CTA | P0 | "Create my campaign" pointed at `/app`, where an anonymous visitor is redirected to **login** — a silent detour at the highest-intent moment. | All three acquisition CTAs go to `/app/signup`; "Sign in" stays separate. | `e2e/signup-conversion.spec.js`, `backend/tests/signup-conversion.test.js` |
| 2 | `/app/signup` consent rows | P1 | `.login-card input { width: 100% }` matched the consent checkboxes, stretching them across the card and displacing their labels. | Text-input rule scoped with `:not([type='checkbox'])`; consent row pins an 18px box and a 44px label target. | measured geometry at 320/375/768/1440 in `e2e/signup-conversion.spec.js` |
| 3 | `/app/signup` verification screen | P1 | "Open it on this device" described a same-device restriction the backend does not have — verification uses a device-independent token hash. | Cross-device wording plus honest expiry/reuse guidance. | `backend/tests/signup-conversion.test.js` |
| 4 | `/app/signup` errors | P1 | Errors were loose text at the bottom of the form, unassociated with any field and unannounced. | `role="alert"`, `aria-invalid` and `aria-describedby` on the field that caused it. | both suites |
| 5 | Landing hero helper text and proof strip | P0 | White text measured 4.10:1 at 26% and 2.49:1 at 62% of the gradient; helper copy and proof cards visibly disappeared in the lighter zone. | ~~Localized in-hero scrim plus a shared `--hero-surface` token.~~ **Reverted 2026-07-28 — see UX-V11-CONTRAST below.** | — |
| 6 | Hero CTAs | P2 | Hover was a transform only — invisible under reduced motion — and focus had no ring. | Distinct hover backgrounds and non-reflowing focus outlines. | `e2e/hero-contrast.spec.js` |

## Fixed in the v12 candidate — was accepted risk

### UX-V11-CONTRAST · hero text does not meet WCAG AA · P1

**Status:** **fixed in the v12 candidate (SC-V12-02).** The previous frozen v11
candidate (`e2ba23bc…`) still carries this as an accepted risk, and the
canonical release blocker `P1-hero-contrast-below-aa` / risk `hero-contrast`
stays open until the new candidate is cut at SC-V12-08 and the new tests are
recorded at that SHA. Nothing here closes the blocker early.

**The defect (v11 state).** White hero text on the restored sky gradient
measured **4.70:1 at the top of the hero, falling to 1.99:1 at the bottom of the
text band** — no part of the band reached AA (4.5:1), and the lowest content
(CTA note, proof strip) was the least readable. v11 fixed it with a navy scrim
and opaque surfaces; the owner rejected both for dulling the approved blue
(objection behind commit `445d29e`) and reading as glass cards, and it was
reverted 2026-07-28.

**The v12 fix, and why it satisfies the earlier constraints.** SC-V12-02 reaches
AA without a scrim and without touching the approved blue. `--sky-top`
(`#2f6ceb`) is unchanged and is now **held flat across the whole text band
(0–70%)**, with the wash toward pale blue and white delayed to below it
(70–100%). White hero copy therefore measures a uniform **4.70:1 (≥ AA)**
everywhere it renders, the open-sky character and the section transition are
preserved, and no scrim or glass surface is introduced. This is one of the
"options that do not touch the blue" recorded here previously (delay the wash /
move it below the text band).

**How it is held.** `backend/tests/landing-contrast.test.js` now **requires AA**:
it samples the full text band and fails if any sample drops below 4.5:1, asserts
the approved `--sky-top` token is unchanged, and asserts no hero scrim or new
glass surface exists. `e2e/hero-contrast.spec.js` proves the cascade resolves
every hero style to opaque white and the sky stays blue-dominant at 320–1440px
and 200% zoom.

## Added, not a defect fix

- **Code-native product proof** on the landing page (`app-src/components/ProductPreview.jsx`):
  Brief → connected channel assets → review findings → handoff, rendered
  through the product's own `statusLabelFor()` and using the same synthetic
  fixture the authenticated matrix seeds. Chosen over maintained screenshots
  because it cannot go stale against a rebuild. Labelled "a product view,
  rendered from example data — not a customer result", and pinned by
  `backend/tests/product-proof.test.js` against invented metrics, testimonials,
  logos and non-existent statuses.

## NOT observed — this is a blocker, not an omission

The authenticated screens (Campaign overview/brief/deliverables/assets/review/
handoff, the five studios, Library drawer, version and provenance UI, filters,
export preview, paywall surfaces) have **not** been walked in a browser at any
commit. The matrix to do it now exists (`e2e/authenticated/`), but running it
needs a non-production Supabase project and an `E2E_SEED_SECRET`.

Until it runs:

- No claim is made about hierarchy, density, responsive drawers, loading or
  empty states behind the login.
- `e2e_authenticated` is recorded as `skipped` in
  `docs/launch/launch-state.json`, which holds both verdicts at NO-GO.
- Any P0/P1 friction in those screens is, by definition, still unknown. This
  ledger will be wrong by omission until the walk happens — that is the point
  of saying so here rather than presenting the table above as complete.

**Owner action:** follow `docs/RUNBOOK_AUTH_E2E.md`, run `npm run test:e2e:auth`,
then re-open this ledger with what the walk found.
