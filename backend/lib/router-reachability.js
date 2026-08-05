// ---------------------------------------------------------------------------
// v15 SC-05 — mechanical proof that the React Router RSC advisory stays
// UNREACHABLE.
//
// GHSA-qwww-vcr4-c8h2 affects ONLY applications using React Router's unstable
// RSC / server APIs. This app is a pure client SPA (declarative <BrowserRouter>,
// all imports from 'react-router-dom'), so the vulnerable path does not exist —
// an ACCEPTED, not closed, risk. The prose said so; this makes it enforceable:
// a deterministic guard that fails the moment any RSC/SSR/server-router
// indicator appears in source or configuration, so the "no-RSC" claim can never
// silently stop being true.
//
// Pure: the caller supplies file contents; this decides what they mean. Comments
// are stripped first, so the guard reacts to real code and config — never to a
// doc or a comment that merely NAMES an indicator (this very file included).
// ---------------------------------------------------------------------------

'use strict';

// Forbidden indicators, each a class of "this app now ships RSC/SSR/server
// routing". Matched against comment-stripped source/config text.
const INDICATORS = Object.freeze([
  { id: 'react-router-server-import', re: /from\s+['"]react-router(?:-dom)?\/server(?:\.[a-z]+)?['"]/i,
    why: 'imports the React Router server/RSC entry' },
  { id: 'react-router-dom-server-import', re: /require\(\s*['"]react-router(?:-dom)?\/server[^'"]*['"]\s*\)/i,
    why: 'requires the React Router server/RSC entry' },
  { id: 'static-handler', re: /\b(?:unstable_)?createStaticHandler\b/,
    why: 'uses createStaticHandler (server data router)' },
  { id: 'static-router', re: /\b(?:unstable_)?createStaticRouter\b|\bStaticRouterProvider\b|\bStaticRouter\b/,
    why: 'mounts a StaticRouter (server rendering)' },
  { id: 'server-router', re: /\bServerRouter\b|\bRouterServer\b/,
    why: 'uses a server Router component' },
  { id: 'react-dom-server-stream', re: /\brenderToPipeableStream\b|\brenderToReadableStream\b/,
    why: 'streams server-rendered React (SSR)' },
  { id: 'react-server-condition', re: /['"]react-server['"]/,
    why: 'declares a react-server module condition (RSC)' },
  { id: 'rsc-vite-plugin', re: /@vitejs\/plugin-rsc|vite-plugin-rsc|@hiogawa\/vite-rsc|plugin-react-server/i,
    why: 'configures an RSC Vite plugin' },
  { id: 'server-entry', re: /\bentry\.server\b/i,
    why: 'references a server entry point' },
]);

// Files whose mere EXISTENCE (by name) means a server/RSC entry was added.
const FORBIDDEN_FILENAMES = /(^|[\\/])entry\.server\.[jt]sx?$/i;

/** Strip // line comments and block comments so the scan reacts to code, not prose. */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // line comments (keep http:// intact)
}

/**
 * Scan the supplied files for RSC/SSR/server-router indicators.
 * files: [{ path, text }]. Returns [{ path, id, why }] — [] when the app is a
 * pure client SPA. A forbidden filename is reported even with empty contents.
 */
function rscIndicators(files = []) {
  const findings = [];
  for (const f of files) {
    if (!f || typeof f.path !== 'string') continue;
    if (FORBIDDEN_FILENAMES.test(f.path)) {
      findings.push({ path: f.path, id: 'server-entry-file', why: 'a server entry file exists' });
    }
    if (typeof f.text !== 'string') continue;
    const code = stripComments(f.text);
    for (const ind of INDICATORS) {
      if (ind.re.test(code)) findings.push({ path: f.path, id: ind.id, why: ind.why });
    }
  }
  return findings;
}

/** True when no RSC/SSR/server-router indicator is present. */
function isPureClientSpa(files = []) {
  return rscIndicators(files).length === 0;
}

module.exports = { INDICATORS, FORBIDDEN_FILENAMES, stripComments, rscIndicators, isPureClientSpa };
