// v11 SC-03 — run the authenticated browser matrix.
//
// A wrapper rather than an inline env assignment in package.json, because
// `E2E_AUTH=1 playwright test` is not portable to the shell npm uses on
// Windows, and a script that silently runs the WRONG projects would report a
// green public suite as if the signed-in journey had been covered.

import { spawn } from 'node:child_process';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'E2E_SEED_SECRET'];
const missing = REQUIRED.filter((name) => !String(process.env[name] || '').trim());

if (missing.length) {
  // Exit non-zero: BLOCKED is a failure state, not a skip.
  console.error('\nAUTHENTICATED E2E BLOCKED — the signed-in journey was NOT verified.\n');
  console.error(`Missing environment: ${missing.join(', ')}\n`);
  console.error('See docs/RUNBOOK_AUTH_E2E.md. Record `e2e_authenticated` as `skipped`');
  console.error('in docs/launch/launch-state.json; the launch gate will hold NO-GO.\n');
  process.exit(1);
}

const projects = ['authenticated', 'authenticated-mobile', 'authenticated-keyboard']
  .flatMap((p) => ['--project', p]);

const child = spawn('npx', ['playwright', 'test', ...projects], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_AUTH: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
