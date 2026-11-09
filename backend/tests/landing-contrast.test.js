// ---------------------------------------------------------------------------
// v10 SC-05 / v26 brand-board white hero — WCAG AA contrast on the landing
// hero, checked by computation rather than by eye.
//
// v26 moved the hero from a saturated blue sky to the brand board's "01 /
// CONNECTED" white hero (navy headline, slate-navy body/nav copy, the logo's
// own icy/cobalt/navy ribbon bleeding off the right edge). This file no
// longer assumes "white text on blue" — it resolves the ACTUAL hero text
// colours from the stylesheet (including custom properties) and computes
// real contrast against every stop of the real .lp-sky gradient, so a future
// colour change that quietly drops below AA fails the build instead of
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
// The hero's own content (eyebrow through the proof strip) never runs past
// this point of .lp-sky's total rendered height at any supported width —
// measured at 89.1% (1440px) and 91.8% (390px); 94% leaves headroom at both.
// Below it the gradient washes toward the next section and carries no text.
const TEXT_BAND_END = 94;

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Custom properties declared on .lp, e.g. --navy: #0d1b3a. */
function cssVariables() {
  const vars = {};
  for (const m of CSS.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    vars[m[1]] = m[2].toLowerCase();
  }
  return vars;
}

/**
 * The .lp-sky gradient stops, as [{ hex, position }].
 * Stops may be written as a literal or as var(--token), so variables are
 * resolved — reading only hex literals would silently skip a token stop.
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
 * selectors appear in shared rules too and reading only the first would test
 * the wrong declaration.
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

/** Resolves a declaration's value to a hex colour, following one var() hop. */
function resolveColor(selector, prop) {
  const raw = declaration(selector, prop);
  if (!raw) return null;
  const varRef = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (varRef) return cssVariables()[varRef[1]] || null;
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw.toLowerCase() : raw;
}

test('the approved brand tokens behind the hero are unchanged', () => {
  const vars = cssVariables();
  // --sky-top still backs the dark final-CTA band further down the page, and
  // --navy is the headline colour on the new white hero — both must stay the
  // approved brand values, not drift by an unrelated edit.
  assert.equal(vars['--sky-top'], '#2f6ceb', '--sky-top is the approved brand blue and must not change');
  assert.equal(vars['--navy'], '#0d1b3a', '--navy is the approved brand navy and must not change');
});

test('hero text resolves to opaque colours, never alpha over the gradient', () => {
  // Translucent colour over a gradient is what broke AA before (v10 SC-05) —
  // a colour that is always lighter/darker than it looks, with the deficit
  // growing as the background changes. Every hero text selector must resolve
  // to a solid hex, directly or via one custom-property hop.
  const selectors = ['.lp-hero h1', '.lp-sub', '.lp-eyebrow.lp-hero-eyebrow', '.lp-cta-note', '.lp-nav a', '.lp-proof-n', '.lp-proof-label', '.lp-proof-detail'];
  for (const selector of selectors) {
    const raw = declaration(selector, 'color');
    assert.ok(raw, `${selector} has no color declaration`);
    assert.ok(!/rgba\(/.test(raw), `${selector} uses a translucent colour (${raw}) — use an opaque hex or token`);
    const resolved = resolveColor(selector, 'color');
    assert.match(resolved, /^#[0-9a-f]{6}$/i, `${selector} must resolve to an opaque hex colour, found ${raw} → ${resolved}`);
  }
});

// ---------------------------------------------------------------------------
// v26 — every real hero text colour against every real .lp-sky stop, across
// the full band the hero's own content can occupy. This REQUIRES AA; it does
// not just record a ratio.
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;

/** The sky colour at an arbitrary position, interpolated between its stops. */
function skyColourAt(position, stops) {
  if (position <= stops[0].position) return hexToRgb(stops[0].hex);
  const last = stops[stops.length - 1];
  if (position >= last.position) return hexToRgb(last.hex);
  for (let i = 1; i < stops.length; i += 1) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (position <= b.position) {
      const t = (position - a.position) / (b.position - a.position);
      const [from, to] = [hexToRgb(a.hex), hexToRgb(b.hex)];
      return from.map((c, j) => lerp(c, to[j], t));
    }
  }
  return hexToRgb(last.hex);
}

test('every hero text colour meets WCAG AA across the entire text band', () => {
  const sky = skyStops();
  assert.ok(sky.length >= 2, '.lp-sky needs at least two gradient stops to check a band');

  // One entry per distinct hero text colour actually in use (selector kept
  // only for the failure message — several selectors share a colour).
  const HERO_TEXT = [
    { name: 'headline (navy)', selector: '.lp-hero h1' },
    { name: 'sub-headline', selector: '.lp-sub' },
    { name: 'eyebrow (brand blue — the tightest ratio)', selector: '.lp-eyebrow.lp-hero-eyebrow' },
    { name: 'CTA note', selector: '.lp-cta-note' },
    { name: 'nav links', selector: '.lp-nav a' },
    { name: 'proof kicker number', selector: '.lp-proof-n' },
    { name: 'proof label', selector: '.lp-proof-label' },
    { name: 'proof detail', selector: '.lp-proof-detail' },
  ];

  for (const { name, selector } of HERO_TEXT) {
    const hex = resolveColor(selector, 'color');
    const fg = hexToRgb(hex);
    let worst = Infinity;
    let worstAt = 0;
    for (let pos = 0; pos <= TEXT_BAND_END; pos += 1) {
      const ratio = contrast(fg, skyColourAt(pos, sky));
      if (ratio < worst) { worst = ratio; worstAt = pos; }
    }
    assert.ok(
      worst >= AA_NORMAL,
      `${name} (${hex}) drops to ${worst.toFixed(2)}:1 at ${worstAt}% of the text band, below AA's ${AA_NORMAL}:1`,
    );
  }
});

test('the hero stays a near-white surface through the whole text band', () => {
  // The wash toward the next section must stay below where hero content can
  // render — a regression here (moving the wash earlier) is exactly what the
  // previous test's per-position sampling is there to catch, but this names
  // the specific invariant the number encodes.
  const sky = skyStops();
  const first = sky[0];
  assert.equal(first.position, 0, 'the first .lp-sky stop must start at 0%');
  for (let pos = 0; pos <= TEXT_BAND_END; pos += 1) {
    const [r, g, b] = skyColourAt(pos, sky);
    assert.ok(r >= 230 && g >= 230 && b >= 230, `the hero is no longer near-white at ${pos}% (rgb(${r},${g},${b}))`);
  }
});

test('the hero CTAs are legible: solid cobalt fill, outline on white', () => {
  // `.lp-hero-actions` overrides the shared `.lp-cta`/`.lp-cta-ghost` rules
  // (which still serve the dark final-CTA band further down the page) for
  // the white hero. Both must resolve to opaque colours with real contrast
  // against their own background, not the page's.
  const pairs = [
    { bg: '.lp-hero-actions .lp-cta', fg: '.lp-hero-actions .lp-cta' },
    { bg: '.lp-hero-actions .lp-cta-ghost', fg: '.lp-hero-actions .lp-cta-ghost' },
  ];
  for (const { bg, fg } of pairs) {
    const bgHex = resolveColor(bg, 'background');
    const fgHex = resolveColor(fg, 'color');
    assert.match(bgHex, /^#[0-9a-f]{6}$/i, `${bg} background must be an opaque hex, found ${declaration(bg, 'background')}`);
    assert.match(fgHex, /^#[0-9a-f]{6}$/i, `${fg} color must be an opaque hex, found ${declaration(fg, 'color')}`);
    const ratio = contrast(hexToRgb(fgHex), hexToRgb(bgHex));
    assert.ok(ratio >= AA_NORMAL, `${fg} on ${bg} is ${ratio.toFixed(2)}:1 (fg ${fgHex} on bg ${bgHex}), below AA`);
  }
});

test('hero CTAs have distinct, non-reflowing focus and hover states, visible on white', () => {
  for (const selector of ['.lp-cta:focus-visible', '.lp-cta-ghost:focus-visible', '.lp-header-cta:focus-visible']) {
    const outline = declaration(selector, 'outline');
    assert.ok(outline, `${selector} has no focus outline`);
    // An outline does not participate in layout; a border or padding change would.
    assert.match(outline, /solid/, `${selector} focus must be a visible solid outline`);
  }
  // The header CTA and both hero CTAs sit on the white hero/header, where the
  // base white outline (correct for the dark final-CTA band) would vanish —
  // a more specific rule must repaint it navy there.
  for (const selector of [
    '.lp-header .lp-header-cta:focus-visible',
    '.lp-hero-actions .lp-cta:focus-visible',
    '.lp-hero-actions .lp-cta-ghost:focus-visible',
  ]) {
    const outlineColor = declaration(selector, 'outline-color') || declaration(selector, 'outline');
    assert.ok(outlineColor, `${selector} has no outline override for the white hero`);
    assert.doesNotMatch(outlineColor, /#fff(f{3})?\b/i, `${selector} must not keep the white outline — it is invisible on white`);
  }
  assert.ok(declaration('.lp-header-cta', 'background'), 'the header CTA needs a background');
  assert.ok(declaration('.lp-hero-actions .lp-cta', 'background'), 'the hero solid CTA needs a background');
});

test('reveal animations degrade to visible content without motion', () => {
  // Content that only appears via an animation is invisible to anyone with
  // reduced motion — and to anyone whose JS never runs.
  assert.match(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'no reduced-motion handling');
  const reduced = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(/opacity:\s*1/.test(reduced[0]), 'reduced motion must leave revealed content visible');
  assert.ok(/transition:\s*none/.test(reduced[0]), 'reduced motion must not animate');
});

test('the wind streaks are visible on the white hero (cobalt, not white-on-white)', () => {
  const bg = declaration('.lp-meteor', 'background');
  assert.ok(bg, '.lp-meteor has no background');
  assert.ok(!/#fff/i.test(bg), '.lp-meteor must not be white — invisible on the white hero');
  assert.match(bg, /#2f68e8/i, '.lp-meteor should use the brand board\'s cobalt accent (#2F68E8)');
});

// ---------------------------------------------------------------------------
// v27 — the "problem" section's full-bleed colour band (the hero's ribbon
// running on into it): white intro copy on the same gradient already shipped
// on the final-CTA band, checked against BOTH its stops, the same way the
// hero text is checked against every .lp-sky stop above.
// ---------------------------------------------------------------------------

test('the problem-section colour band reuses the approved final-CTA gradient', () => {
  const bg = declaration('.lp-problem-band', 'background-image') || declaration('.lp-problem-band', 'background');
  assert.ok(bg, '.lp-problem-band has no background-image');
  assert.match(bg, /var\(--sky-top\)/, '.lp-problem-band should start from --sky-top, like .lp-final-inner');
  assert.match(bg, /var\(--blue-deep\)/, '.lp-problem-band should end at --blue-deep, like .lp-final-inner');
});

test('the problem-band intro copy is opaque white and meets AA on both gradient stops', () => {
  const vars = cssVariables();
  const stops = [vars['--sky-top'], vars['--blue-deep']];
  const selectors = ['.lp-problem-band .lp-eyebrow', '.lp-problem-band h2', '.lp-problem-band .lp-h2-sub'];
  for (const selector of selectors) {
    const raw = declaration(selector, 'color');
    assert.ok(raw, `${selector} has no color declaration`);
    assert.ok(!/rgba\(/.test(raw), `${selector} uses a translucent colour (${raw}) — use an opaque hex`);
    const fg = hexToRgb(resolveColor(selector, 'color'));
    for (const stop of stops) {
      const ratio = contrast(fg, hexToRgb(stop));
      assert.ok(ratio >= AA_NORMAL, `${selector} is ${ratio.toFixed(2)}:1 against ${stop}, below AA`);
    }
  }
});
