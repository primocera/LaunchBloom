# Handoff export limits — measured, not estimated

**Measured:** 2026-07-27 · Node v24 · `backend/lib/handoff-docs.js`
**Re-measure with:** `node --test backend/tests/handoff-export-integrity.test.js`
(the last test in that file fails the build if the cost moves outside the
headroom below).

## What the numbers are

Synthetic fixtures, all five canonical asset types, statuses spread across
Draft / Needs review / Ready to export.

| Fixture | Included assets | Open items | DOCX | PDF | ZIP bundle | Time | Heap |
|---|---:|---:|---:|---:|---:|---:|---:|
| minimal | 0 | 0 | 1.6 kB | 2.2 kB | 3.7 kB | 6 ms | ~1 MB |
| normal | 4 | 2 | 1.7 kB | 2.6 kB | 4.0 kB | 6 ms | <1 MB |
| **maximum supported** | 120 | 40 | 2.4 kB | 17 kB | 6.7 kB | 10 ms | <1 MB |
| stress (beyond support) | 600 | 200 | 4.7 kB | 79 kB | 15 kB | 41 ms | 2.6 MB |

DOCX compresses far better than PDF because asset rows are repetitive; that is
why the size assertions in the test compare **uncompressed** `document.xml` and
outline block counts, not archive bytes.

## Enforced limits

Defined in `LIMITS` in `backend/lib/handoff-docs.js`:

| Limit | Value | Why |
|---|---|---|
| `MAX_PART_BYTES` | 4 MB | any single file inside the bundle |
| `MAX_TOTAL_BYTES` | 8 MB | the whole download |

The maximum supported campaign produces a **6.7 kB** bundle — roughly **0.08%**
of the download limit. Even the deliberately-out-of-support 600-asset stress
case lands at 15 kB. These limits therefore cannot be reached by ordinary
customer use; they exist to bound a pathological input, not to ration normal
ones.

Runtime headroom on the deployed serverless tier: the maximum fixture completes
in ~10 ms and allocates under 1 MB, against a 10-second function timeout and
1 GB of memory. Generation is synchronous and buffered, which is safe at these
sizes and is the reason the limits are checked *before* the response is written.

## Failure is closed, never partial

Exceeding either limit raises `ExportTooLarge` (`code: EXPORT_TOO_LARGE`)
carrying both the limit and the actual size. The route
(`GET /api/campaigns/:id/handoff/export`) turns that into a 4xx that names the
narrower recovery: export a single format instead of the bundle, or archive
assets not needed in this handoff. **No truncated file is ever returned** —
that is asserted by `exceeding a limit fails closed instead of delivering a
truncated file`.

## What changed in v11

`wrap()` never broke a word longer than the line width, so a long URL in
`proof` or an unbroken campaign name was emitted as one oversized line and ran
past the PDF's right margin — clipped by the page edge in every reader. PDF
content streams have no soft wrap, so oversized words are now hard-broken.
Regression: `a PDF has no blank page and no line that runs off the page` and
`a 300-character campaign name is wrapped, never clipped`.

## What is still not proven

The DOCX is validated by **parsing** it (OPC package structure, balanced
`<w:p>` runs, every outline block present, verified CRCs) and the PDF by
checking its object graph, `/Count` against real page objects, stream lengths
and drawn text. Neither has been **opened in Word or Acrobat** — no such
renderer exists in this environment. That distinction is deliberate and is
carried into `docs/launch/launch-state.json` rather than rounded up to
"verified".
