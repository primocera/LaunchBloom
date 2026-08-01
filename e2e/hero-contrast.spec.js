// Hero rendering in a real browser.
//
// The stylesheet test (backend/tests/landing-contrast.test.js) does the contrast
// arithmetic. This file asserts what arithmetic on a stylesheet cannot see:
// which rule actually won the cascade, and whether anything overlaps, clips or
// overflows at real widths and zoom. A cascade conflict is exactly how the hero
// eyebrow shipped at 1.10:1 before.
//
// v12 SC-V12-02: the contrast defect is fixed without a scrim and without
// touching the approved blue — --sky-top is held flat across the text band and
// the wash to white is delayed below it. The stylesheet test now REQUIRES AA
// across the band; this file proves the cascade still resolves every hero style
// to opaque white and the sky stays blue-dominant at real widths.

const { test, expect } = require('@playwright/test');

const WIDTHS = [320, 375, 768, 1024, 1440];

// Every hero text style, with the surface it is supposed to be readable on.
const HERO_TEXT = [
  { name: 'eyebrow', selector: '.lp-hero-eyebrow' },
  { name: 'headline', selector: '.lp-hero h1' },
  { name: 'sub-headline', selector: '.lp-sub' },
  { name: 'CTA note', selector: '.lp-cta-note' },
  { name: 'proof label', selector: '.lp-proof-label' },
  { name: 'proof detail', selector: '.lp-proof-detail' },
];

const rgbaParts = (value) => {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
};

test.describe('hero text renders as the stylesheet intends', () => {
  test('every hero text style resolves to opaque white after the cascade', async ({ page }) => {
    await page.goto('/');
    for (const { name, selector } of HERO_TEXT) {
      const color = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
      const c = rgbaParts(color);
      expect(c, `${name} has no resolvable colour`).not.toBeNull();
      expect(c.a, `${name} is translucent (${color}) — alpha over a gradient is what broke AA before`).toBe(1);
      expect([c.r, c.g, c.b], `${name} resolved to ${color}, not white — a later rule won the cascade`)
        .toEqual([255, 255, 255]);
    }
  });

  test('the brand blue is still the dominant hero colour', async ({ page }) => {
    await page.goto('/');
    // The scrim must not have turned the sky grey or black.
    const sky = await page.locator('.lp-sky').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(sky).toContain('linear-gradient');
    const stops = [...sky.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    expect(stops.length).toBeGreaterThan(2);
    // Every stop stays blue-dominant.
    for (const [r, g, b] of stops.slice(0, -1)) {
      expect(b, `sky stop rgb(${r},${g},${b}) is no longer blue-dominant`).toBeGreaterThanOrEqual(g);
    }
  });
});

test.describe('hero layout holds at every supported width', () => {
  for (const width of WIDTHS) {
    test(`no clipping, overlap or horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(1);

      const hero = await page.locator('.lp-hero').boundingBox();
      for (const { name, selector } of HERO_TEXT) {
        const el = page.locator(selector).first();
        await expect(el).toBeVisible();
        const box = await el.boundingBox();
        expect(box.width, `${name} collapsed to nothing`).toBeGreaterThan(0);
        expect(box.height, `${name} collapsed to nothing`).toBeGreaterThan(0);
        // Text must stay inside the hero rather than escaping its surface.
        expect(box.x, `${name} starts left of the hero`).toBeGreaterThanOrEqual(hero.x - 1);
        expect(box.x + box.width, `${name} runs past the hero's right edge`)
          .toBeLessThanOrEqual(hero.x + hero.width + 1);
        // Content is only really lost when the box also clips overflow —
        // a tight line-height legitimately overflows a visible box.
        const clipped = await el.evaluate((node) => {
          const overflowY = getComputedStyle(node).overflowY;
          if (overflowY === 'visible') return false;
          return node.scrollHeight - node.clientHeight > 1;
        });
        expect(clipped, `${name} is clipped by its own box`).toBe(false);
      }

      // The CTA note and proof cards must not collide with their neighbours.
      const note = await page.locator('.lp-cta-note').boundingBox();
      const firstProof = await page.locator('.lp-proof-strip li').first().boundingBox();
      expect(firstProof.y, 'the proof strip overlaps the CTA note')
        .toBeGreaterThanOrEqual(note.y + note.height - 1);

      await testInfo.attach(`hero-${width}px`, {
        body: await page.locator('.lp-sky').screenshot(),
        contentType: 'image/png',
      });
    });
  }

  test('hero text stays readable and inside the page at 200% text scaling', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    // Emulating zoom by halving the CSS viewport is equivalent to 200% zoom.
    await page.setViewportSize({ width: 640, height: 450 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (const { name, selector } of HERO_TEXT) {
      await expect(page.locator(selector).first(), `${name} disappeared at 200%`).toBeVisible();
    }
  });
});

test.describe('hero interaction states', () => {
  test('both CTAs show a visible focus ring without moving anything', async ({ page }) => {
    await page.goto('/');
    for (const selector of ['.lp-hero-actions .lp-cta', '.lp-cta-ghost']) {
      const el = page.locator(selector);

      // Layout position, not boundingBox(): boundingBox() is viewport-relative
      // and tabbing scrolls the control into view, so the box legitimately
      // "moves". offsetLeft/offsetTop describe layout, which is what "the
      // outline must not reflow the button" actually means.
      const layout = () => el.evaluate((n) => ({ x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight }));

      // Reach the control with the KEYBOARD, not el.focus(). The rings are
      // :focus-visible, whose heuristic depends on the browser's current input
      // modality — after any pointer interaction, programmatic focus does not
      // match, so this test passed alone and failed in a full run. Tabbing sets
      // keyboard modality explicitly and also proves the control is genuinely
      // reachable, which is the property worth asserting anyway.
      await page.keyboard.press('Tab');
      for (let i = 0; i < 40 && !(await el.evaluate((n) => n === document.activeElement)); i += 1) {
        await page.keyboard.press('Tab');
      }
      expect(await el.evaluate((n) => n === document.activeElement), `${selector} is not reachable by Tab`).toBe(true);

      const style = await el.evaluate((node) => {
        const s = getComputedStyle(node);
        return { width: s.outlineWidth, style: s.outlineStyle };
      });
      expect(style.style, `${selector} has no focus outline`).not.toBe('none');
      expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
      // An outline is drawn outside the box and must not reflow it — position
      // and size both, since padding or a border would change the latter.
      //
      // Both measurements are taken AFTER tabbing, so the reveal animations
      // have settled for both. Measuring the unfocused state first compared a
      // mid-animation layout against a settled one and failed intermittently.
      const focused = await layout();
      await el.evaluate((n) => n.blur());
      const blurred = await layout();
      expect(focused, `${selector} reflowed when focused`).toEqual(blurred);
    }
  });

  test('reduced motion keeps every hero element present and still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    for (const { name, selector } of HERO_TEXT) {
      await expect(page.locator(selector).first(), `${name} is hidden under reduced motion`).toBeVisible();
    }
  });

  test('forced colors keeps all hero content', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/');
    for (const { name, selector } of HERO_TEXT) {
      await expect(page.locator(selector).first(), `${name} vanished in forced-colors mode`).toBeVisible();
    }
  });
});
