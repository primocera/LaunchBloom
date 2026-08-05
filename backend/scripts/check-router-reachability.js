#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v15 SC-05 — fail if the app introduces any RSC/SSR/server-router indicator.
//
//   node backend/scripts/check-router-reachability.js
//
// Scans the shipped frontend source and build/config (app-src, api, the Vite
// config and package.json) for the indicators in backend/lib/router-reachability.js.
// Exit 0 = pure client SPA, so GHSA-qwww-vcr4-c8h2 stays UNREACHABLE. Exit 1 =
// an indicator appeared: the accepted "no-RSC" risk no longer holds and must be
// re-assessed. Read-only.
// ---------------------------------------------------------------------------

'use strict';

const fs = require('fs');
const path = require('path');
const { rscIndicators } = require('../lib/router-reachability');

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['app-src', 'api'];
const SCAN_FILES = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'package.json'];
const EXT = /\.(jsx?|mjs|cjs|tsx?)$/i;

function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(full, acc);
    } else if (EXT.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function collect() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const f of SCAN_FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  return files.map((p) => ({ path: path.relative(ROOT, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') }));
}

function main() {
  const findings = rscIndicators(collect());
  if (findings.length) {
    console.error('\nRouter reachability: RSC/SSR INDICATOR FOUND — the accepted "no-RSC" risk no longer holds.\n');
    for (const f of findings) console.error(`  - ${f.path}: ${f.why} [${f.id}]`);
    console.error('\nGHSA-qwww-vcr4-c8h2 may now be REACHABLE. Re-assess the router blocker in');
    console.error('docs/launch/launch-state.json before shipping. See docs/ADR / RUNBOOK.\n');
    process.exit(1);
  }
  console.log('Router reachability: pure client SPA — no RSC/SSR/server-router indicators. Advisory stays unreachable.');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { collect };
