// v11 SC-01 — the acquisition path in a real browser.
//
// The previous suite proved the signup fields existed. It could not see that
// the consent checkboxes were stretched to the card width, or that the primary
// CTA handed anonymous visitors a login screen. These assert measured geometry
// and actual destinations, not screenshots.

const { test, expect } = require('@playwright/test');

const WIDTHS = [320, 375, 768, 1440];

test.describe('acquisition CTA reaches signup', () => {
  // Located by their section rather than by index, so a new CTA elsewhere on
  // the page cannot shift what this test is actually clicking.
  const CTAS = {
    header: '.lp-header-cta',
    hero: '.lp-hero-actions .lp-cta',
    closing: '.lp-final .lp-cta',
  };

  for (const [name, selector] of Object.entries(CTAS)) {
    test(`the ${name} "Create my campaign" CTA lands on signup in one navigation`, async ({ page }) => {
      await page.goto('/');
      const cta = page.locator(selector);
      await expect(cta).toHaveText(/create my campaign/i);
      await cta.scrollIntoViewIfNeeded();
      await cta.click();
      await expect(page).toHaveURL(/\/app\/signup$/);
      // Signup, not login: the account-creating heading and the consent row.
      await expect(page.getByRole('heading', { name: /create your .* workspace/i })).toBeVisible();
      await expect(page.getByRole('checkbox').first()).toBeVisible();
    });
  }

  test('the explicit login link still reaches login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).first().click();
    await expect(page).toHaveURL(/\/app\/login$/);
    await expect(page.getByRole('heading', { name: /continue your campaign/i })).toBeVisible();
  });
});

test.describe('signup consent row geometry and semantics', () => {
  for (const width of WIDTHS) {
    test(`consent checkbox and label render correctly at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/signup');

      const box = page.getByRole('checkbox').first();
      await expect(box).toBeVisible();
      const rect = await box.boundingBox();

      // The defect this test exists for: a checkbox stretched to card width.
      expect(rect.width).toBeLessThanOrEqual(24);
      expect(rect.height).toBeLessThanOrEqual(24);
      expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(2);

      // The label is the interactive target and must clear 44x44.
      const label = page.locator('.consent').first();
      const labelRect = await label.boundingBox();
      expect(labelRect.height).toBeGreaterThanOrEqual(44);
      expect(labelRect.width).toBeGreaterThanOrEqual(44);

      // The label text wraps inside the card instead of overflowing it.
      const cardRect = await page.locator('.login-card').boundingBox();
      expect(labelRect.x + labelRect.width).toBeLessThanOrEqual(cardRect.x + cardRect.width + 1);

      // No horizontal overflow anywhere on the page.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('clicking the label text toggles the checkbox', async ({ page }) => {
    await page.goto('/app/signup');
    // The marketing row, whose label carries no links — inside the legal row a
    // click on "Terms" must navigate, which is correct and not a toggle.
    const row = page.locator('.consent').nth(1);
    const box = row.getByRole('checkbox');
    await expect(box).not.toBeChecked();
    await row.locator('span').click();
    await expect(box).toBeChecked();
  });

  test('the consent checkbox is keyboard reachable with visible focus', async ({ page }) => {
    await page.goto('/app/signup');
    const box = page.getByRole('checkbox').first();
    await box.focus();
    await expect(box).toBeFocused();
    const outline = await box.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  });

  test('the consent checkbox is never pre-checked', async ({ page }) => {
    await page.goto('/app/signup');
    for (const cb of await page.getByRole('checkbox').all()) {
      await expect(cb).not.toBeChecked();
    }
  });
});

test.describe('signup errors and verification copy', () => {
  test('a mismatched password reports on the field that caused it', async ({ page }) => {
    await page.goto('/app/signup');
    await page.getByLabel('Email address').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill('abcd1234');
    await page.getByLabel('Repeat password').fill('abcd9999');
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /create workspace/i }).click();

    const err = page.locator('#signup-error');
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(page.getByLabel('Repeat password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Repeat password')).toHaveAttribute('aria-describedby', 'signup-error');
    // The email survives a recoverable error.
    await expect(page.getByLabel('Email address')).toHaveValue('someone@example.com');
  });

  test('the submit button stays disabled until consent is given', async ({ page }) => {
    await page.goto('/app/signup');
    const submit = page.getByRole('button', { name: /create workspace/i });
    await page.getByLabel('Email address').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill('abcd1234');
    await page.getByLabel('Repeat password').fill('abcd1234');
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').first().check();
    await expect(submit).toBeEnabled();
  });

  test('signup and login are distinct screens, not one ambiguous form', async ({ page }) => {
    await page.goto('/app/signup');
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await page.goto('/app/login');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});
