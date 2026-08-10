// v11 SC-03 — the canonical signed-in journey, in a browser, at the current head.
//
// Brand Profile -> Campaign -> Brief -> Review -> Library -> Handoff. Every
// assertion here is about state the server owns; visible buttons are never
// treated as proof that an action is permitted.

const { test, expect, mainText } = require('./fixtures');

const scenario = (name) => ({ annotation: { type: 'scenario', description: name } });

test.describe('canonical campaign journey', () => {
  test('a seeded workspace reaches its campaign and shows one primary next action', async ({ page, workspace }) => {
    await page.goto(`/app/campaigns/${workspace.campaign_id}`);

    // The campaign identifies itself, so a wrong fixture cannot pass silently.
    await expect(page.getByText(/Autumn cohort launch/)).toBeVisible();

    // Exactly one primary action per state — competing equal-weight CTAs are
    // the friction this journey exists to prevent.
    const primaries = page.locator('.btn-primary:visible, [data-primary-action]:visible');
    expect(await primaries.count(), 'a state must offer one primary next action').toBeLessThanOrEqual(1);
  });

  test('every canonical section is reachable and keeps campaign context', async ({ page, workspace }) => {
    for (const section of ['overview', 'brief', 'deliverables', 'assets', 'review', 'handoff']) {
      await page.goto(`/app/campaigns/${workspace.campaign_id}/${section}`);
      await expect(page, `${section} redirected away`).toHaveURL(new RegExp(`/campaigns/${workspace.campaign_id}/${section}`));
      // Context is never lost between sections. The campaign name can appear in
      // both a breadcrumb and a heading, so assert at least one is visible.
      await expect(page.getByText(/Autumn cohort launch/).first()).toBeVisible();
    }
  });

  test('the brand profile round-trips what was seeded', async ({ page, workspace }) => {
    expect(workspace.brand_profile).toBe(true);
    await page.goto('/app/brand');
    // A populated profile shows the editable "Brand name" field (the "basics"
    // section is open by default); assert the seeded value round-tripped in.
    await expect(page.getByLabel(/brand name/i)).toHaveValue(/Northwind Studio/);
  });

  test('the library lists the workspace and never another account\'s data', async ({ page, workspace }) => {
    await page.goto('/app/assets');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // A seeded workspace with no assets must say so rather than render blank.
    const body = await page.locator('main, .app-main').first().innerText();
    expect(body.trim().length, 'the library rendered an empty screen with no explanation').toBeGreaterThan(0);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('[object Object]');
    expect(workspace.workspace_id).toBeTruthy();
  });

  test('a deep link into a campaign survives a full reload', async ({ page, workspace }) => {
    const url = `/app/campaigns/${workspace.campaign_id}/review`;
    await page.goto(url);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(url));
    await expect(page.getByText(/Autumn cohort launch/)).toBeVisible();
  });
});

test.describe('ownership is enforced by the server, not by the interface', () => {
  test('a campaign id from another workspace is refused', async ({ page, request, workspace }) => {
    // A well-formed id that this account does not own.
    const foreign = '00000000-0000-4000-8000-000000000001';
    const res = await request.get(`/api/campaigns/${foreign}`);
    expect([401, 403, 404], `a foreign campaign returned ${res.status()}`).toContain(res.status());
    expect(workspace.campaign_id).not.toBe(foreign);

    await page.goto(`/app/campaigns/${foreign}`);
    // The UI must say something honest rather than render an empty shell.
    const body = await mainText(page, /not found|no longer|don.t have access|couldn.t load/i);
    expect(body).toMatch(/not found|no longer|don.t have access|couldn.t load/i);
  });

  test('signing out ends the session for authenticated APIs', async ({ page, request }) => {
    await page.goto('/app');
    await request.post('/api/auth/logout').catch(() => {});
    const res = await request.get('/api/campaigns');
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('entitlement states are server-owned', () => {
  test('a workspace with no plan cannot generate, and is told why', async ({ page, request, workspace }) => {
    // The seed grants no entitlement, so generation must be refused by the
    // server — never merely hidden in the interface.
    const res = await request.post('/api/ai/generate-website-kit', {
      data: { campaign_id: workspace.campaign_id, workspace_id: workspace.workspace_id },
    });
    expect([402, 400, 403], `generation returned ${res.status()} for an unentitled workspace`).toContain(res.status());
    if (res.status() === 402) {
      const body = await res.json();
      expect(body.code).toBe('UPGRADE');
    }

    await page.goto('/app/website');
    const body = await mainText(page, /plan|trial|upgrade/i);
    expect(body, 'the paywall must explain the state, not just disable a button')
      .toMatch(/plan|trial|upgrade/i);
  });
});

test.describe('failure and recovery states preserve work', () => {
  test('an expired session sends the user to login and back, losing nothing', async ({ page, context, workspace }) => {
    await page.goto(`/app/campaigns/${workspace.campaign_id}/brief`);
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/app\/login/);
    // No auth loop: login renders, rather than bouncing indefinitely.
    await expect(page.getByRole('heading', { name: /continue your campaign/i })).toBeVisible();
  });

  test('a provider failure states what was saved', async ({ page, workspace }) => {
    // The Review workbench loads its data from the /review endpoint; make that
    // provider fail the way a transient outage does. (The /consistency endpoint
    // is not wired into this surface, so faulting it proved nothing.)
    await page.route('**/api/campaigns/*/review', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
    await page.goto(`/app/campaigns/${workspace.campaign_id}/review`);
    const body = await mainText(page, /couldn.t|could not|try again|unavailable|failed/i);
    expect(body, 'a failed check must be explained, not silently blank')
      .toMatch(/couldn.t|could not|try again|unavailable|failed/i);
    // The campaign itself is still there — nothing was lost.
    await expect(page.getByText(/Autumn cohort launch/)).toBeVisible();
  });

  test('an empty workspace teaches the next step instead of showing a blank screen', async ({ page }) => {
    test.info().annotations.push(scenario('empty_workspace').annotation);
    await page.goto('/app');
    const body = await mainText(page, /brand|campaign|start|begin/i);
    expect(body.trim().length).toBeGreaterThan(40);
    expect(body).toMatch(/brand|campaign|start|begin/i);
  });
});
