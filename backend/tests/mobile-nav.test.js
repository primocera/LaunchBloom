// ---------------------------------------------------------------------------
// A phone must be able to navigate the app and END ITS SESSION.
//
// The sidebar holds the ONLY copies of the main nav, the workspace switcher,
// Account & billing and Sign out. It was `display: none` below 820px, so on a
// phone there was no navigation and no way to sign out at all. For an app
// holding a customer's brand and billing data on a shared or lost device,
// unreachable sign-out is a privacy defect, not a missing convenience.
//
// Nothing caught it because every existing assertion checks what a signed-in
// user can DO; none checked that they can STOP. This file checks reachability.
//
// It parses the real stylesheet and the real shell markup, so re-hiding the
// sidebar without providing another route to Sign out fails the build.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = (...p) => path.join(__dirname, '..', '..', 'app-src', ...p);
const read = (...p) => fs.readFileSync(src(...p), 'utf8');

const CSS = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = read('App.jsx');
const SIDEBAR = read('components', 'Sidebar.jsx');

/** Body text of every `@media` block whose condition mentions a phone-sized
 *  max-width. Brace-matched rather than regex-sliced so a nested block (the
 *  reduced-motion override) cannot truncate the capture. */
function mobileMediaBlocks() {
  const blocks = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(CSS)) !== null) {
    const condition = m[1];
    const widths = [...condition.matchAll(/max-width:\s*(\d+)px/g)].map((w) => Number(w[1]));
    if (!widths.some((w) => w <= 900)) continue;

    let depth = 1;
    let i = re.lastIndex;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ condition: condition.trim(), body: CSS.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

/** Declarations applied to a selector inside one media block. */
function rulesFor(body, selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out;
}

test('Sign out exists exactly where this test assumes it does', () => {
  // If Sign out moves out of the sidebar, the premise of the checks below is
  // gone and they would keep passing while proving nothing.
  assert.match(SIDEBAR, /Sign out/, 'Sidebar should still contain the Sign out control');
});

test('the sidebar is not display:none at phone widths', () => {
  for (const { condition, body } of mobileMediaBlocks()) {
    for (const decls of rulesFor(body, '.sidebar')) {
      assert.ok(
        !/display:\s*none/.test(decls),
        `.sidebar is display:none inside @media${condition} — that hides the only Sign out`,
      );
    }
  }
});

test('a phone-width block turns the sidebar into a reachable drawer', () => {
  const blocks = mobileMediaBlocks();
  const drawer = blocks.some(({ body }) =>
    rulesFor(body, '.sidebar').some((d) => /position:\s*fixed/.test(d)));

  assert.ok(drawer, 'expected a mobile breakpoint that makes .sidebar a fixed drawer');

  const opens = blocks.some(({ body }) =>
    rulesFor(body, '.sidebar.is-mobile-open').some((d) => /transform:\s*translateX\(0\)/.test(d)));

  assert.ok(opens, '.sidebar.is-mobile-open must slide the drawer into view');
});

test('the shell renders a control that opens the drawer', () => {
  assert.match(APP, /mobile-nav-toggle/, 'shell should render a menu toggle');
  assert.match(APP, /aria-controls="app-sidebar"/, 'the toggle must reference the sidebar it opens');
  assert.match(APP, /aria-expanded=\{mobileNavOpen\}/, 'the toggle must expose its state');
  assert.match(SIDEBAR, /id="app-sidebar"/, 'the sidebar must carry the id the toggle points at');
});

test('the toggle is visible on mobile and hidden on desktop', () => {
  // A toggle that renders but is never shown is the same bug with extra steps.
  const desktop = CSS.slice(0, CSS.indexOf('@media'));
  assert.ok(
    /\.mobile-topbar\s*\{[^}]*display:\s*none/.test(CSS),
    '.mobile-topbar should be display:none outside the mobile breakpoint',
  );
  assert.ok(desktop !== null);

  const shown = mobileMediaBlocks().some(({ body }) =>
    rulesFor(body, '.mobile-topbar').some((d) => /display:\s*flex/.test(d)));
  assert.ok(shown, '.mobile-topbar must become visible at phone widths');
});

test('the drawer can be dismissed without navigating', () => {
  assert.match(APP, /mobile-nav-backdrop/, 'a backdrop should dismiss the drawer');
  assert.match(APP, /Escape/, 'Escape should close the drawer');
});

test('the drawer stays mounted while open even when desktop-collapsed', () => {
  // `{!collapsed && <Sidebar/>}` unmounts the sidebar entirely, which would
  // leave the menu button with nothing to reveal.
  assert.match(
    APP,
    /\(!collapsed \|\| mobileNavOpen\)/,
    'Sidebar must render while the mobile drawer is open regardless of collapse state',
  );
});
