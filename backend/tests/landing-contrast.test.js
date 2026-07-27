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

/** Custom properties declared on .lp, e.g. --sky-top: #2f6ceb. */
function cssVariables() {
  const vars = {};
  for (const m of CSS.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    vars[m[1]] = m[2].toLowerCase();
  }
  return vars;
}

/**
 * The .lp-sky gradient stops, as [{ hex, position }].
 * Stops may be written as a literal or as var(--sky-top), so variables are
 * resolved — reading only hex literals silently skipped the first stop, which
 * is the one the headline sits on.
 */
function skyStops() {
  const rule = CSS.match(/\.lp-sky\s*\{[\s\S]*?\}/);
  assert.ok(rule, '.lp-sky rule not found — has the landing been restructured?');
  const gradient = rule[0].match(/linear-gradient\(([\s\S]*?)\);/);
  assert.ok(gradient, '.lp-sky has no linear-gradient');
  const vars = cssVariables();

  return [...gradient[1].matchAll(/(#[0-9a-f]{6}|var\(\s*(--[a-z0-9-]+)\s*\))\s+(\d+)%/gi)]
    .map((m) => {
      const hex = m[2] ? vars[m[2]] : m[1].toLowerCase();
      assert.ok(hex, `gradient references ${m[2]}, which is not defined as a colour`);
      return { hex, position: Number(m[3]) };
    });
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

// The owner restored the original v9 palette on 2026-07-26, accepting that the
// lower gradient stops fall below WCAG AA for normal text. That is a product
// decision, so this test no longer fails the build for it — but it PINS the
// measured ratios, so the palette cannot silently get worse, and any change
// forces a deliberate re-measurement here.
const RECORDED = [
  { hex: '#2f6ceb', position: 0, ratio: 4.70, meetsAA: true },
  { hex: '#3d78ee', position: 26, ratio: 4.10, meetsAA: false },
  { hex: '#7ba4f3', position: 62, ratio: 2.49, meetsAA: false },
];

test('the hero gradient matches the recorded palette and has not got worse', () => {
  const stops = skyStops();
  const white = [255, 255, 255];

  for (const expected of RECORDED) {
    const stop = stops.find((s) => s.position === expected.position);
    assert.ok(stop, `no gradient stop at ${expected.position}% — the palette changed; re-measure and update RECORDED`);
    const actual = contrast(white, hexToRgb(stop.hex));
    assert.ok(
      actual >= expected.ratio - 0.01,
      `stop at ${expected.position}% is now ${actual.toFixed(2)}:1, worse than the recorded ${expected.ratio}:1`
    );
  }

  // The h1 sits on the top stop. That one is not negotiable — if the headline
  // itself drops below AA the hero is unreadable, not merely imperfect.
  const top = stops.find((s) => s.position === 0);
  assert.ok(contrast(white, hexToRgb(top.hex)) >= AA_NORMAL, 'the top stop must meet AA — the headline sits on it');
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

  // The buttons sit at the top of the hero, on the first stop. A dark scrim
  // must always beat a white veil there: 6.43:1 with the current scrim versus
  // 4.70:1 with none. A regression here means someone reintroduced the white
  // overlay that made the button LIGHTER than the sky behind it (3.41:1).
  const top = skyStops().find((s) => s.position === 0);
  const onTop = contrast(white, composite(overlay, alpha, hexToRgb(top.hex)));

  assert.ok(
    onTop >= AA_NORMAL,
    `ghost CTA text is ${onTop.toFixed(2)}:1 on ${top.hex}; a white veil lightens the button and fails AA`
  );
  assert.ok(
    overlay[0] === 0 && overlay[1] === 0 && overlay[2] === 0,
    `.lp-cta-ghost must use a dark scrim, found rgba(${overlay.join(',')})`
  );
});

// ---------------------------------------------------------------------------
// v11 SC-02 — the recorded ratios above describe the sky ALONE. Text does not
// sit on the sky alone any more: a localized scrim covers the hero band, and
// the two lowest text blocks carry their own surface. These tests measure the
// pairs that actually render, which is what the earlier "known trade-off" note
// could not do.
// ---------------------------------------------------------------------------

/** rgba(R, G, B, A) → { rgb, alpha }, resolving `rgba(var(--token), a)`. */
function rgbaValue(value) {
  const vars = {};
  for (const m of CSS.matchAll(/(--[a-z0-9-]+)\s*:\s*([\d]+,\s*[\d]+,\s*[\d]+)\s*;/gi)) {
    vars[m[1]] = m[2].split(',').map((n) => Number(n.trim()));
  }
  const viaVar = value.match(/rgba\(\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*,\s*([\d.]+)\s*\)/i);
  if (viaVar) return { rgb: vars[viaVar[1]], alpha: Number(viaVar[2]) };
  const literal = value.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
  if (!literal) return null;
  return { rgb: [Number(literal[1]), Number(literal[2]), Number(literal[3])], alpha: Number(literal[4]) };
}

/** Resolve a custom property declared on .lp to its raw value. */
function token(name) {
  const m = CSS.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** The scrim stops inside .lp-hero::before, as [{ alpha, position }]. */
function scrimStops() {
  const rule = CSS.match(/\.lp-hero::before\s*\{[\s\S]*?\}/);
  assert.ok(rule, '.lp-hero::before scrim not found — hero readability depends on it');
  const gradient = rule[0].match(/linear-gradient\(([\s\S]*?)\);/);
  assert.ok(gradient, 'the hero scrim must be a gradient: the sky bleaches downward, so a flat scrim over-darkens the top');
  return [...gradient[1].matchAll(/rgba\(\s*var\(--hero-scrim\)\s*,\s*(?:([\d.]+)|var\(\s*(--[a-z0-9-]+)\s*\))\s*\)\s+(\d+)%/g)]
    .map((m) => ({
      alpha: m[1] !== undefined ? Number(m[1]) : Number(token(m[2])),
      position: Number(m[3]),
    }));
}

const lerp = (a, b, t) => a + (b - a) * t;

/** The scrim alpha at an arbitrary position, interpolated as the browser does. */
function scrimAlphaAt(position, stops) {
  if (position <= stops[0].position) return stops[0].alpha;
  const last = stops[stops.length - 1];
  if (position >= last.position) return last.alpha;
  for (let i = 1; i < stops.length; i += 1) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (position <= b.position) {
      return lerp(a.alpha, b.alpha, (position - a.position) / (b.position - a.position));
    }
  }
  return last.alpha;
}

/** The sky colour at an arbitrary position, interpolated between its stops. */
function skyColourAt(position, stops) {
  for (let i = 1; i < stops.length; i += 1) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (position <= b.position) {
      const t = (position - a.position) / (b.position - a.position);
      const [ca, cb] = [hexToRgb(a.hex), hexToRgb(b.hex)];
      return ca.map((c, j) => lerp(c, cb[j], t));
    }
  }
  return hexToRgb(stops[stops.length - 1].hex);
}

test('the scrim is a deep blue, not black and not a white veil', () => {
  const rgb = token('--hero-scrim').split(',').map((n) => Number(n.trim()));
  const [r, g, b] = rgb;
  assert.ok(b > r && b > g, `the scrim must stay in the brand blue family, found rgb(${rgb.join(',')})`);
  assert.ok(b < 140, 'the scrim must be dark enough to raise contrast, not a light blue veil');
  // Pure black would read as a grey wash over the brand colour.
  assert.ok(r + g + b > 30, 'a pure-black scrim greys out the approved blue');
});

test('white hero text passes AA everywhere in the scrimmed band', () => {
  const sky = skyStops();
  const scrim = scrimStops();
  assert.ok(scrim.length >= 3, 'the scrim needs enough stops to track the bleaching sky');

  const white = [255, 255, 255];
  const failures = [];
  // Sampled across the whole band that carries scrimmed hero text. Below
  // TEXT_BAND_END the only content is the proof strip, which has its own
  // surface and is checked separately.
  //
  // The scrim's percentages are relative to .lp-hero and the sky's to .lp-sky,
  // which also contains the header — so at any given sky position the real
  // scrim is slightly STRONGER than modelled here. Treating them as the same
  // axis keeps this check conservative rather than optimistic.
  for (let pos = 0; pos <= TEXT_BAND_END; pos += 2) {
    const background = composite(
      rgbaValue(`rgba(var(--hero-scrim), ${scrimAlphaAt(pos, scrim)})`).rgb,
      scrimAlphaAt(pos, scrim),
      skyColourAt(pos, sky),
    );
    const ratio = contrast(white, background);
    if (ratio < AA_NORMAL) failures.push(`${pos}%: ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `hero text falls below ${AA_NORMAL}:1 at: ${failures.join(', ')}`);
});

test('the scrim leaves the top of the sky essentially untouched', () => {
  // The headline already passes on the top stop. Darkening there would change
  // the approved look for no accessibility gain.
  const scrim = scrimStops();
  assert.ok(scrimAlphaAt(0, scrim) <= 0.02, 'the scrim must start transparent at the top of the hero');
});

test('helper and proof surfaces carry their own contrast, whatever is behind them', () => {
  const surface = rgbaValue(token('--hero-surface'));
  assert.ok(surface, '--hero-surface must be an rgba value');
  const white = [255, 255, 255];

  // Pure white is the worst backdrop that can occur anywhere on this page —
  // the sky's final stop, and the brightest point of the cloud layer. Passing
  // there means these surfaces never depend on the gradient.
  const worstCase = contrast(white, composite(surface.rgb, surface.alpha, [255, 255, 255]));
  assert.ok(
    worstCase >= AA_NORMAL,
    `--hero-surface gives only ${worstCase.toFixed(2)}:1 over white; helper and proof text would depend on the gradient`,
  );

  // Both consumers must actually use the token rather than a local value.
  for (const selector of ['.lp-cta-note', '.lp-proof-strip li']) {
    const bg = declaration(selector, 'background');
    assert.equal(bg, 'var(--hero-surface)', `${selector} must use the shared hero surface token, found ${bg}`);
  }
});

test('proof and helper text on that surface is opaque white', () => {
  for (const selector of ['.lp-cta-note', '.lp-proof-n', '.lp-proof-label', '.lp-proof-detail']) {
    const color = declaration(selector, 'color');
    assert.match(color, /^#fff(f{3})?$/i, `${selector} should be opaque white, found ${color}`);
  }
});

test('hero CTAs have distinct, non-reflowing focus and hover states', () => {
  for (const selector of ['.lp-cta:focus-visible', '.lp-cta-ghost:focus-visible', '.lp-header-cta:focus-visible']) {
    const outline = declaration(selector, 'outline');
    assert.ok(outline, `${selector} has no focus outline`);
    // An outline does not participate in layout; a border or padding change would.
    assert.match(outline, /solid/, `${selector} focus must be a visible solid outline`);
  }
  assert.ok(declaration('.lp-cta:hover', 'background'), 'the solid CTA needs a hover state that is not only a transform');
  const ghostHover = rgbaValue(declaration('.lp-cta-ghost:hover', 'background'));
  const ghostBase = rgbaValue(declaration('.lp-cta-ghost', 'background'));
  assert.ok(ghostHover.alpha > ghostBase.alpha, 'ghost CTA hover must darken, never lighten — a white veil cuts contrast');
});

test('the hero scrim is decorative and never blocks interaction', () => {
  const rule = CSS.match(/\.lp-hero::before\s*\{[\s\S]*?\}/)[0];
  assert.match(rule, /pointer-events:\s*none/);
  // A pseudo-element is not in the accessibility tree, and it must stay behind
  // the content rather than over it.
  assert.match(rule, /z-index:\s*-1/);
  assert.match(CSS, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.lp-hero::before[\s\S]*?display:\s*none/,
    'forced-colors mode must drop the scrim so the system palette wins');
});

test('reveal animations degrade to visible content without motion', () => {
  // Content that only appears via an animation is invisible to anyone with
  // reduced motion — and to anyone whose JS never runs.
  assert.match(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'no reduced-motion handling');
  const reduced = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(/opacity:\s*1/.test(reduced[0]), 'reduced motion must leave revealed content visible');
  assert.ok(/transition:\s*none/.test(reduced[0]), 'reduced motion must not animate');
});
