// Guards against the committed app/ bundle drifting from app-src/ source.
// Rebuilds and compares line-ending-normalized content hashes of the build
// output against the COMMITTED tree (git HEAD), so:
//   - CRLF/LF checkout differences can never fail (or pass) the check spuriously
//   - running `npm run build:app` beforehand cannot mask a stale commit
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'app');

// Hashed assets get content-based names from Vite, so a same-content build is
// byte-identical; only text files need newline normalization.
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.map', '.webmanifest']);

function normalizedHash(buf, file) {
  let b = buf;
  if (TEXT_EXT.has(path.extname(file).toLowerCase())) {
    b = Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  }
  return createHash('sha256').update(b).digest('hex');
}

function rebuiltHashes(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) rebuiltHashes(full, base, out);
    else {
      const rel = path.relative(base, full).split(path.sep).join('/');
      out.set(rel, normalizedHash(readFileSync(full), rel));
    }
  }
  return out;
}

function committedHashes() {
  const files = execSync('git ls-tree -r --name-only HEAD -- app/', { cwd: ROOT })
    .toString().split('\n').map((s) => s.trim()).filter(Boolean);
  const out = new Map();
  for (const file of files) {
    const blob = execSync(`git show HEAD:"${file}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    out.set(file.replace(/^app\//, ''), normalizedHash(blob, file));
  }
  return out;
}

console.log('Rebuilding app/ from app-src/ ...');
execSync('npx vite build', { stdio: 'inherit', cwd: ROOT });

const committed = committedHashes();
const rebuilt = rebuiltHashes(APP_DIR);

const problems = [];
for (const [file, hash] of rebuilt) {
  if (!committed.has(file)) problems.push(`missing from commit: app/${file}`);
  else if (committed.get(file) !== hash) problems.push(`content differs from HEAD: app/${file}`);
}
for (const file of committed.keys()) {
  if (!rebuilt.has(file)) problems.push(`stale committed file: app/${file}`);
}

if (problems.length) {
  console.error('\napp/ is STALE — the committed bundle does not match app-src/:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nRun `npm run build:app` and commit the regenerated app/ output.');
  process.exit(1);
}
console.log('app/ is up to date with app-src/ (normalized hash match vs HEAD).');
