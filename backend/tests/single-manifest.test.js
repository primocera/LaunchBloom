// ---------------------------------------------------------------------------
// v24 SV-24-01 (D) — one dependency manifest.
//
// The root package.json + package-lock.json are the only dependency source for
// dev, CI and Vercel. A stale nested backend/package-lock.json (still named
// "offerflow-backend", pinning express ^4.18.2 and friends) used to sit beside
// the patched root tree: nothing installed from it in CI or production, but a
// local `cd backend && npm ci` could resurrect a separate, vulnerable
// dependency tree that Node would resolve BEFORE the root one. It was removed;
// these assertions keep a second dependency source from coming back.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOCKFILE_RE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/;

function trackedFiles() {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

test('the only tracked lockfile is the root package-lock.json', (t) => {
  const files = trackedFiles();
  if (!files) { t.skip('git unavailable'); return; }
  const locks = files.filter((f) => LOCKFILE_RE.test(f));
  assert.deepEqual(locks, ['package-lock.json'], `unexpected dependency lockfile(s): ${locks.join(', ')}`);
});

test('backend/package-lock.json does not exist', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'backend', 'package-lock.json')), false);
});

test('backend/package.json declares no dependencies of its own', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides']) {
    assert.ok(!pkg[key] || Object.keys(pkg[key]).length === 0, `backend/package.json has ${key}; all dependencies live in the root manifest`);
  }
});

test('the root lockfile belongs to the root manifest', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
});
