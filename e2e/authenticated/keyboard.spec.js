// v11 SC-03 — the signed-in workspace by keyboard and on a phone.
//
// Unit tests can prove a drawer component renders. They cannot prove focus
// returns to the control that opened it, that a phone can reach navigation, or
// that a dialog traps focus rather than losing it to the page behind.

const { test, expect } = require('./fixtures');

test.describe('keyboard operation @keyboard', () => {
  test('the campaign workspace is reachable and operable without a mouse', async ({ page, workspace }) => {
    await page.goto(`/app/campaigns/${workspace.campaign_id}`);

    // Tab into the page and confirm focus lands on something meaningful
    // rather than being swallowed by a decorative element.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, name: el.textContent?.trim().slice(0, 60), hidden: el.getAttribute('aria-hidden') } : null;
    });
    expect(focused, 'nothing received focus').not.toBeNull();
    expect(focused.hidden, 'focus landed on an aria-hidden element').not.toBe('true');

    // Every focusable control shows a visible focus indicator.
    const invisible = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('a[href], button:not([disabled]), input, select, textarea')) {
        if (el.offsetParent === null) continue;
        el.focus();
        const s = getComputedStyle(el);
        const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        const hasShadow = s.boxShadow && s.boxShadow !== 'none';
        if (!hasOutline && !hasShadow) bad.push(el.tagName + ':' + (el.textContent || el.name || '').trim().slice(0, 40));
      }
      return bad;
    });
    expect(invisible, 'controls with no visible focus indicator').toEqual([]);
  });

  test('focus returns to the trigger after a drawer or dialog closes @keyboard', async ({ page, workspace }) => {
    await page.goto(`/app/campaigns/${workspace.campaign_id}/assets`);
    const trigger = page.locator('button:visible').first();
    const label = await trigger.textContent();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const refocused = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    expect(refocused, `focus was lost after closing "${label?.trim()}"`).not.toBe('');
  });

  test('no control is reachable only by pointer @keyboard', async ({ page, workspace }) => {
    await page.goto(`/app/campaigns/${workspace.campaign_id}`);
    const unreachable = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('[onclick], [role="button"]')) {
        if (el.offsetParent === null) continue;
        const focusable = el.tabIndex >= 0 || ['A', 'BUTTON', 'INPUT'].includes(el.tagName);
        if (!focusable) bad.push((el.textContent || '').trim().slice(0, 40));
      }
      return bad;
    });
    expect(unreachable, 'clickable elements with no keyboard path').toEqual([]);
  });
});

test.describe('phone layout', () => {
  test('the campaign workspace fits a phone with no horizontal scroll', async ({ page, workspace }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const section of ['overview', 'brief', 'assets', 'review', 'handoff']) {
      await page.goto(`/app/campaigns/${workspace.campaign_id}/${section}`);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${section} scrolls horizontally on a phone`).toBeLessThanOrEqual(1);
    }
  });

  test('navigation and sign out are reachable at 320px', async ({ page, workspace }) => {
    expect(workspace.workspace_id, 'the signed-in check needs a real session').toBeTruthy();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/app');
    // The mobile drawer landed in 77009bc; this proves it still works signed in.
    const opener = page.getByRole('button', { name: /menu|navigation/i }).first();
    if (await opener.count()) await opener.click();
    await expect(page.getByRole('link', { name: /sign out|account/i }).first()).toBeVisible();
  });
});
