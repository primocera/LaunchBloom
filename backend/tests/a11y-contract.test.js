// v9 SC-09 — accessibility & design-system contract. Pure fs checks that lock
// the interaction guarantees: no primary flow depends on window.prompt/alert, a
// single design-token layer exists, focus is visible, reduced-motion is honored
// and primary controls meet a 44px touch target.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app-src');
const read = (p) => fs.readFileSync(p, 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (['.jsx', '.js'].includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

test('no primary flow depends on window.prompt or window.alert', () => {
  const hits = [];
  for (const f of walk(APP)) {
    // Ignore comments; the guarantee is about live calls, not prose mentions.
    const code = read(f).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/window\.(prompt|alert)\s*\(/.test(code)) hits.push(path.relative(APP, f));
  }
  assert.deepEqual(hits, [], `window.prompt/alert still used in: ${hits.join(', ')}`);
});

test('a single design-token layer defines the canonical palette', () => {
  const css = read(path.join(APP, 'flow.css'));
  for (const token of ['--sc-bg', '--sc-surface', '--sc-text', '--sc-muted', '--sc-primary', '--sc-danger', '--sc-border', '--sc-tap']) {
    assert.ok(css.includes(token), `missing token ${token}`);
  }
});

test('keyboard focus is visible and reduced-motion is honored', () => {
  const css = read(path.join(APP, 'flow.css'));
  assert.match(css, /:focus-visible\s*\{[^}]*outline/, 'focus-visible must draw an outline');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion must be handled');
});

test('primary interactive controls meet a 44px touch target', () => {
  const css = read(path.join(APP, 'flow.css'));
  assert.match(css, /--sc-tap:\s*44px/);
  assert.match(css, /min-height:\s*var\(--sc-tap\)/);
});
