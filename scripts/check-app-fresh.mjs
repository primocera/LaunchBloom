// Guards against the committed app/ bundle drifting from app-src/ source.
// Runs `vite build` (which rewrites app/) and fails if git sees any change,
// meaning someone edited app-src/ without rebuilding + committing app/.
import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

console.log('Rebuilding app/ from app-src/ ...');
execSync('npx vite build', { stdio: 'inherit' });

const diff = run('git status --porcelain -- app/');
if (diff) {
  console.error('\napp/ is STALE — the committed bundle does not match app-src/:');
  console.error(diff);
  console.error('\nRun `npm run build:app` and commit the regenerated app/ output.');
  process.exit(1);
}
console.log('app/ is up to date with app-src/.');
