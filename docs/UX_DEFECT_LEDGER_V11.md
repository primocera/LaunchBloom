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
| 5 | Landing hero helper text and proof strip | P0 | White text measured 4.10:1 at 26% and 2.49:1 at 62% of the gradient; helper copy and proof cards visibly disappeared in the lighter zone. | Localized in-hero scrim plus a shared `--hero-surface` token for helper/proof content that passes AA even over pure white. | `backend/tests/landing-contrast.test.js` (computed), `e2e/hero-contrast.spec.js` (rendered) |
| 6 | Hero CTAs | P2 | Hover was a transform only — invisible under reduced motion — and focus had no ring. | Distinct hover backgrounds and non-reflowing focus outlines. | `e2e/hero-contrast.spec.js` |

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
