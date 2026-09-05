// ---------------------------------------------------------------------------
// v15 SC-05 — the React Router RSC advisory stays mechanically unreachable.
//
// GHSA-qwww-vcr4-c8h2 affects only apps using React Router's RSC/server APIs.
// The accepted risk rests on this app shipping none. These tests prove the
// guard catches a deliberately introduced RSC/SSR/server-router indicator
// (positive fixtures), does not false-positive on the real pure-SPA imports or
// on a doc/comment that merely names an indicator (negative fixtures), and that
// release verification fails when the accepted risk passes its review date.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { rscIndicators, isPureClientSpa } = require('../lib/router-reachability');
const { reviewProblems } = require('../lib/launch-state');
const { loadState } = require('../scripts/launch-state');

// --- negative fixtures: the real pure client SPA and safe prose ------------

test('the real frontend source is a pure client SPA (no indicators)', () => {
  const { collect } = require('../scripts/check-router-reachability');
  const findings = rscIndicators(collect());
  assert.deepEqual(findings, [], `unexpected RSC/SSR indicators:\n${findings.map((f) => `${f.path}: ${f.why}`).join('\n')}`);
});

test('ordinary react-router-dom SPA code does not trip the guard', () => {
  const files = [
    { path: 'app-src/main.jsx', text: "import { BrowserRouter } from 'react-router-dom';\ncreateRoot(el).render(<BrowserRouter><App/></BrowserRouter>);" },
    { path: 'app-src/routes/x.jsx', text: "import { useNavigate, Link, Routes, Route } from 'react-router-dom';" },
  ];
  assert.ok(isPureClientSpa(files));
});

test('a comment or doc that merely NAMES an indicator does not trip the guard', () => {
  const files = [
    { path: 'app-src/note.js', text: "// we deliberately ship no createStaticHandler or renderToPipeableStream\nconst x = 1;" },
    { path: 'app-src/block.js', text: "/* forbidden: import from 'react-router/server' */\nexport const y = 2;" },
  ];
  assert.deepEqual(rscIndicators(files), []);
});

// --- positive fixtures: real indicators must be caught --------------------

const FORBIDDEN = [
  ['react-router-server-import', "import { createStaticHandler } from 'react-router/server';"],
  ['react-router-dom-server-import', "const s = require('react-router-dom/server.mjs');"],
  ['static-handler', 'const handler = createStaticHandler(routes);'],
  ['static-router', 'root.render(<StaticRouterProvider router={r} context={c} />);'],
  ['react-dom-server-stream', "import { renderToPipeableStream } from 'react-dom/server';"],
  ['react-server-condition', '"exports": { "react-server": "./server.js" }'],
  ['rsc-vite-plugin', "import rsc from '@vitejs/plugin-rsc';\nexport default { plugins: [rsc()] };"],
];

for (const [id, code] of FORBIDDEN) {
  test(`the guard catches a real "${id}" indicator`, () => {
    const findings = rscIndicators([{ path: 'app-src/bad.jsx', text: code }]);
    assert.ok(findings.length > 0, `did not catch ${id}`);
    assert.ok(!isPureClientSpa([{ path: 'app-src/bad.jsx', text: code }]));
  });
}

test('a server entry file is caught by its filename alone', () => {
  const findings = rscIndicators([{ path: 'app-src/entry.server.jsx', text: '' }]);
  assert.ok(findings.some((f) => f.id === 'server-entry-file'));
});

// --- accepted-risk review-date enforcement --------------------------------

test('the router advisory stays mechanically governed: reachability basis on record, and full SC-05 metadata whenever it is an accepted risk', () => {
  const state = loadState();
  const b = state.blockers.find((x) => x.id === 'P1-router-rsc-csrf-advisory');
  assert.ok(b, 'the router advisory blocker must stay on record even once closed');
  // The reachability basis is asserted regardless of open/accepted/closed, so
  // the "not reachable" justification can never be quietly dropped.
  assert.ok(
    b.reachability_evidence && /no.?rsc|not.?reachable|pure client spa/i.test(b.reachability_evidence),
    'reachability evidence must remain on the blocker',
  );
  // Status is an owner risk decision — accepted while unresolved, closed once the
  // owner confirms (npm audit 0 + guard green) it no longer applies. It is not
  // hard-coded here; the release gate proves the guard is still wired either way.
  assert.ok(['accepted', 'closed', 'open'].includes(b.status));
  if (b.status === 'accepted') {
    const acc = b.accepted_risk;
    assert.ok(acc.accepted_by && acc.accepted_at_utc && acc.rationale);
    assert.deepEqual(acc.tracks, ['public_paid']);
    assert.ok(acc.revisit_at && acc.review_by, 'an accepted advisory must carry a revisit trigger and a review_by date');
    assert.ok(Array.isArray(acc.resolution_paths) && acc.resolution_paths.length === 2, 'two documented resolution paths');
  }
});

// Review-date enforcement is a property of reviewProblems() itself, tested on a
// synthetic accepted risk so it holds independently of whether the real router
// advisory is currently accepted or has been closed by the owner.
test('an accepted risk past its review_by fails release verification', () => {
  const reviewBy = '2026-11-04';
  const state = { blockers: [{ id: 'P1-synthetic-advisory', status: 'accepted', accepted_risk: { review_by: reviewBy } }] };
  const dayAfter = new Date(Date.parse(reviewBy) + 24 * 3600 * 1000);
  const problems = reviewProblems(state, dayAfter);
  assert.ok(problems.some((p) => /P1-synthetic-advisory/.test(p) && /review_by/.test(p)), problems.join('\n'));
});

test('before the review date there is no review problem', () => {
  const reviewBy = '2026-11-04';
  const state = { blockers: [{ id: 'P1-synthetic-advisory', status: 'accepted', accepted_risk: { review_by: reviewBy } }] };
  const dayBefore = new Date(Date.parse(reviewBy) - 24 * 3600 * 1000);
  assert.deepEqual(reviewProblems(state, dayBefore), []);
});

test('a malformed review_by is itself a problem', () => {
  const state = { blockers: [{ id: 'X', status: 'accepted', accepted_risk: { review_by: 'someday' } }] };
  assert.ok(reviewProblems(state, Date.now()).some((p) => /unparseable review_by/.test(p)));
});
