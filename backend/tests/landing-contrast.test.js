// ---------------------------------------------------------------------------
// v10 SC-05 — WCAG AA contrast on the landing hero, checked by computation
// rather than by eye.
//
// The hero sits on a blue gradient that lightens downward, so "white text on
// blue" is not one contrast ratio — it is a different ratio at every scroll
// position. Before this slice the eyebrow, sub-headline and CTA note used
// translucent white, which measured as low as 2.07:1 against the lower stops.
//
// This test parses the real stylesheet, so lightening a gradient stop or
// re-introducing a translucent hero colour fails the build instead of quietly
// shipping unreadable copy.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Comments are stripped first: they sit between rules and would otherwise be
// captured as part of the following selector (and this file documents hex
// values in comments, which must never be mistaken for gradient stops).
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'app-src', 'landing.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const AA_NORMAL = 4.5;
// Hero copy sits on the saturated band; below this the gradient bleaches into
// the next (white) section and carries no text.
const TEXT_BAND_END = 70;

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const composite = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

/** The .lp-sky gradient stops, as [{ hex, position }]. */
function skyStops() {
  const rule = CSS.match(/\.lp-sky\s*\{[\s\S]*?\}/);
  assert.ok(rule, '.lp-sky rule not found — has the landing been restructured?');
  const gradient = rule[0].match(/linear-gradient\(([\s\S]*?)\);/);
  assert.ok(gradient, '.lp-sky has no linear-gradient');
  return [...gradient[1].matchAll(/(#[0-9a-f]{6})\s+(\d+)%/gi)]
    .map((m) => ({ hex: m[1].toLowerCase(), position: Number(m[2]) }));
}

/**
 * A declaration's effective value for a selector. Walks EVERY rule whose
 * selector list contains it and returns the last match, because these
 * selectors appear in shared rules too (`.lp-cta, .lp-cta-ghost { … }`) and
 * reading only the first would test the wrong declaration.
 */
function declaration(selector, prop) {
  let value = null;
  for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const decl = rule[2].match(new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;]+);`));
    if (decl) value = decl[1].trim();
  }
  return value;
}

test('the hero gradient is dark enough for white text everywhere text sits', () => {
  const stops = skyStops();
  assert.ok(stops.length >= 2, 'gradient has too few stops to reason about');

  const white = [255, 255, 255];
  for (const stop of stops.filter((s) => s.position <= TEXT_BAND_END)) {
    const ratio = contrast(white, hexToRgb(stop.hex));
    assert.ok(
      ratio >= AA_NORMAL,
      `gradient stop ${stop.hex} at ${stop.position}% gives white text ${ratio.toFixed(2)}:1, below AA ${AA_NORMAL}`
    );
  }
});

test('hero text is opaque, because alpha over a gradient is what broke AA', () => {
  // Each of these measured below 4.5:1 before v10 SC-05. A translucent white
  // is always lighter than the white it looks like, and the deficit grows as
  // the background lightens — the exact trap this guards.
  // .lp-hero-eyebrow is written as a compound selector because the element
  // also carries .lp-eyebrow, which is declared later and would otherwise win.
  for (const selector of ['.lp-sub', '.lp-eyebrow.lp-hero-eyebrow', '.lp-cta-note']) {
    const color = declaration(selector, 'color');
    assert.ok(color, `${selector} has no color declaration`);
    const alpha = color.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
    if (alpha) {
      assert.fail(`${selector} uses translucent white (alpha ${alpha[1]}) on a gradient — use an opaque colour`);
    }
    assert.match(color, /^#fff(f{3})?$/i, `${selector} should be opaque white, found ${color}`);
  }
});

test('the ghost CTA is legible: a dark scrim, never a white veil', () => {
  const bg = declaration('.lp-cta-ghost', 'background');
  assert.ok(bg, '.lp-cta-ghost has no background');
  const rgba = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(rgba, `.lp-cta-ghost background should be an rgba overlay, found ${bg}`);

  const overlay = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const alpha = Number(rgba[4]);
  const white = [255, 255, 255];

  // Worst case: the lightest stop the button can sit on.
  const stops = skyStops().filter((s) => s.position <= TEXT_BAND_END);
  const worst = stops.reduce((a, b) => (luminance(hexToRgb(a.hex)) > luminance(hexToRgb(b.hex)) ? a : b));
  const button = composite(overlay, alpha, hexToRgb(worst.hex));
  const ratio = contrast(white, button);

  assert.ok(
    ratio >= AA_NORMAL,
    `ghost CTA text is ${ratio.toFixed(2)}:1 on ${worst.hex}; a white veil lightens the button and fails AA`
  );
});

test('reveal animations degrade to visible content without motion', () => {
  // Content that only appears via an animation is invisible to anyone with
  // reduced motion — and to anyone whose JS never runs.
  assert.match(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'no reduced-motion handling');
  const reduced = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(/opacity:\s*1/.test(reduced[0]), 'reduced motion must leave revealed content visible');
  assert.ok(/transition:\s*none/.test(reduced[0]), 'reduced motion must not animate');
});
