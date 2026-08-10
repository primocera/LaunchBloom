// v15 SC-03 — a controlled billing/entitlement READ FAILURE, in a browser.
//
// The most dangerous billing bug is silent: a transient entitlement-read failure
// that renders a paying user as Free, or offers a returning user a second free
// trial. v14 made the server fail closed (503 PLAN_UNAVAILABLE); this journey
// proves the SIGNED-IN UI honours that — it shows a safe temporary-unavailable
// state, keeps the user signed in, and never renders Free or a start/second
// trial CTA. The failure is injected deterministically with page.route: no real
// Stripe, no live money.

const { test, expect, mainText } = require('./fixtures');

const ME = '**/api/auth/me';

test.describe('a billing/entitlement read failure fails safe in the UI', () => {
  test('a transient plan-verification 503 shows a safe state, never Free or a second trial', async ({ page, workspace }) => {
    // The fixture has already signed in and loaded the app once (a successful
    // /api/auth/me), so an account exists. NOW make the plan re-check fail the
    // way a transient Supabase outage does — every subsequent call 503s with the
    // canonical fail-closed code.
    await page.route(ME, (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PLAN_UNAVAILABLE', error: 'plan verification unavailable' }),
    }));

    // Re-mount the provider so it re-runs the plan check against the failing
    // endpoint, then land on a plan-sensitive surface.
    await page.goto(`/app/campaigns/${workspace.campaign_id}/overview`);

    const body = await mainText(page, /couldn.t verify your plan|temporary|try again|unavailable/i);

    // 1. A safe, honest temporary-unavailable state is shown.
    expect(body, 'the plan-verification failure must be explained, not silently swallowed')
      .toMatch(/couldn.t verify your plan|temporary|try again|unavailable/i);

    // 2. The user is NOT signed out and NOT bounced to login.
    expect(page.url(), 'a plan-read failure must not sign the user out').not.toMatch(/\/app\/login/);

    // 3. The user is NEVER rendered as Free, and is NEVER offered a (second) trial.
    expect(body, 'a lookup failure must never downgrade the user to Free').not.toMatch(/\bFree plan\b/i);
    expect(body, 'a returning user must never be offered a trial on a read failure')
      .not.toMatch(/start (your )?(free )?trial|start.*3-day|second trial/i);

    // The injected 503 is intentional for this journey, so it must not count as a
    // real server error against the strict page guard in fixtures.js.
    page.__problems = (page.__problems || []).filter((p) => !/\/api\/auth\/me/.test(p));
  });
});
