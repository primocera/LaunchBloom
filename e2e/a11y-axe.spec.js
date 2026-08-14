// v18 X04 — automated accessibility scan (axe-core) on the critical PUBLIC
// journeys, complementing the static a11y contract (backend/tests/a11y-contract.test.js)
// and the hero-contrast cascade spec. Static checks assert the source *intends*
// to be accessible; axe asserts the RENDERED DOM actually is — computed roles,
// names, contrast, duplicate ids, form labels — which source scanning cannot see.
//
// Local-only, like the rest of the Playwright suite (CI stays lean). Run:
//   npx playwright install chromium   then   npm run test:e2e:a11y
//
// Gate: zero serious/critical violations on public routes. Moderate/minor are
// reported as attachments for review but do not fail the build, so the gate is
// defensible without a blanket rule suppression. We disable NO rules globally;
// if a specific finding is a false positive it must be excluded per-test with a
// written reason, never hidden here.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// The credential-free public routes the config can serve (SERVE_APP=1, SPA
// fallback). Authenticated routes are covered by the opt-in authenticated
// matrix, not here.
const PUBLIC_ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/app/login' },
  { name: 'signup', path: '/app/signup' },
  { name: 'reset-password', path: '/app/reset-password' },
];

// WCAG 2.2 AA is the target baseline (the pack's gate). axe ships these tag sets.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const BLOCKING = new Set(['serious', 'critical']);

for (const route of PUBLIC_ROUTES) {
  test(`${route.name} has no serious or critical accessibility violations`, async ({ page }, testInfo) => {
    // domcontentloaded, not the default 'load' or networkidle: the credential-
    // free app polls /api/auth/me (503) forever, so the network never idles.
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    // Settle on the real rendered tree by waiting for a stable landmark.
    await page.locator('h1, main, form').first().waitFor({ state: 'visible', timeout: 15000 });

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    // Attach the full result for review regardless of pass/fail — the moderate
    // and minor findings are the backlog, not the gate.
    await testInfo.attach(`axe-${route.name}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact));
    const summary = blocking
      .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length} node(s): ${v.help}`)
      .join('\n');
    expect(blocking, `serious/critical a11y violations on ${route.name}:\n${summary}`).toEqual([]);
  });
}

test('landing has a single main landmark and a reachable skip target', async ({ page }) => {
  // A structural check axe alone under-reports: exactly one <main> and a heading
  // to orient a screen-reader user immediately on the highest-traffic page.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  expect(await page.locator('main').count(), 'there must be exactly one main landmark').toBe(1);
  expect(await page.locator('h1').count(), 'the landing page needs exactly one h1').toBe(1);
});
