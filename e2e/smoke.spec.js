// v5 Prompt 17: credential-free E2E journeys. Runs against the real backend
// (mock AI, no Stripe/Supabase/Resend keys) serving the committed app/ build.
// Journeys that require live Supabase/Stripe (checkout, webhooks, generation
// entitlement) are covered by unit/integration tests plus the Prompt 20
// manual release checklist — they are intentionally NOT faked here.

const { test, expect } = require('@playwright/test');

test.describe('public pages', () => {
  test('landing renders and pricing comes from the canonical /api/plans catalog', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/LaunchBloom/i);
    // Pricing is fetched from the backend — limits must match enforcement.
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('.lp-price-card').first()).toBeVisible();
    await expect(page.getByText('30 AI actions / month').first()).toBeVisible();
    await expect(page.getByText('120 AI actions / month').first()).toBeVisible();
    await expect(page.getByText('400 AI actions / month').first()).toBeVisible();
    await expect(page.getByText('Save up to 36%')).toBeVisible();
    // Trial disclosure is honest about the payment method.
    await expect(page.getByText('Payment method required', { exact: false }).first()).toBeVisible();
    // Banned copy never returns.
    await expect(page.getByText('no card needed', { exact: false })).toHaveCount(0);
  });

  test('legal pages render with no bracketed placeholders', async ({ page }) => {
    for (const slug of ['terms', 'privacy', 'cookies', 'ai-disclaimer', 'refund']) {
      await page.goto(`/legal/${slug}`);
      await expect(page.locator('.legal-card h1')).toBeVisible();
      const text = await page.locator('.legal-card').innerText();
      expect(text).not.toContain('[PLACEHOLDER');
    }
  });

  test('health endpoint answers without leaking config', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(JSON.stringify(body)).not.toMatch(/anthropic|stripe|supabase|model/i);
  });

  test('unknown route shows the not-found page', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz');
    await expect(page.getByText(/not found|doesn.t exist/i).first()).toBeVisible();
  });
});

test.describe('plan catalog contract', () => {
  test('/api/plans limits equal the enforced PLAN_LIMITS values', async ({ request }) => {
    const res = await request.get('/api/plans');
    expect(res.ok()).toBeTruthy();
    const cat = await res.json();
    const byPlan = Object.fromEntries(cat.plans.map((p) => [p.plan, p]));
    expect(byPlan.starter.ai_actions).toBe(30);
    expect(byPlan.pro.ai_actions).toBe(120);
    expect(byPlan.studio.ai_actions).toBe(400);
    expect(cat.trial.ai_actions_total).toBe(20);
    expect(cat.trial.launch_kits_total).toBe(1);
    expect(cat.yearly_badge).toBe('Save up to 36%');
    // Savings are calculated, never handwritten.
    for (const p of cat.plans) {
      const twelve = Math.round(p.price.monthly * 12 * 100) / 100;
      const expected = Math.round((twelve - p.price.yearly) * 100) / 100;
      expect(p.yearly_savings.amount).toBeCloseTo(expected, 2);
    }
  });

  test('/api/legal serves env-backed entity config', async ({ request }) => {
    const res = await request.get('/api/legal');
    expect(res.ok()).toBeTruthy();
    const legal = await res.json();
    expect(legal.version).toBeTruthy();
    expect(typeof legal.configured).toBe('boolean');
  });
});

test.describe('auth boundaries', () => {
  test('signed-out users are sent to login from the app shell', async ({ page }) => {
    await page.goto('/app/campaigns');
    await expect(page).toHaveURL(/\/app\/login/);
  });

  test('signup form requires terms consent and offers optional marketing consent', async ({ page }) => {
    await page.goto('/app/signup');
    await expect(page.getByText('No payment method yet', { exact: false })).toBeVisible();
    const submit = page.getByRole('button', { name: /create account/i });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Email address').fill('e2e@example.com');
    await page.getByLabel('Password', { exact: true }).fill('longpassword1');
    await page.getByLabel('Repeat password').fill('longpassword1');
    await expect(submit).toBeDisabled(); // still needs required consent
    await expect(page.getByText('optional', { exact: false })).toBeVisible();
    await page.locator('.consent input[type="checkbox"]').first().check();
    await expect(submit).toBeEnabled();
  });

  test('AI routes reject unauthenticated generation', async ({ request }) => {
    const res = await request.post('/api/ai/generate-website-kit', { data: {} });
    // 401 with live Supabase auth; 503 in the credential-free E2E env
    // (auth deliberately unconfigured). Never 2xx.
    expect([401, 503]).toContain(res.status());
  });
});

test.describe('mobile smoke @mobile', () => {
  test('landing has no horizontal overflow and CTAs are tappable @mobile', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('link', { name: /build my marketing campaign/i }).first()).toBeVisible();
  });

  test('login page is usable on a phone @mobile', async ({ page }) => {
    await page.goto('/app/login');
    await expect(page.locator('input[type="email"], input[autocomplete="email"]').first()).toBeVisible();
  });
});

test.describe('keyboard access', () => {
  test('landing is keyboard navigable to the primary CTA', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent || '');
    expect(focused.length).toBeGreaterThan(0);
  });
});
