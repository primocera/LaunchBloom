// v5 Prompts 16/17: local Playwright E2E. Deliberately NOT run in CI — the CI
// pipeline stays lean (install/lint/unit/build) so it never flakes. Run
// locally with:  npx playwright install chromium   then   npm run test:e2e
//
// The suite boots the real backend with SERVE_APP=1 (static app/ + SPA
// fallback, mirroring Vercel rewrites) and NO external credentials: AI runs
// in mock mode, Stripe/Supabase-dependent journeys are exercised only up to
// their public seams.
//
// v11 SC-03: an AUTHENTICATED matrix was added alongside it. It needs a real
// (non-production) Supabase project, so it is opt-in via E2E_AUTH=1 — but
// opting out is not the same as passing. A release must record the
// authenticated projects as `skipped`, which holds the launch gate at NO-GO.
// See e2e/authenticated/fixtures.js and docs/RUNBOOK_AUTH_E2E.md.

const { defineConfig, devices } = require('@playwright/test');

const PORT = 3109;
const AUTH = process.env.E2E_AUTH === '1';

// Credential-free by default: blanking these guarantees the public suite can
// never touch real Supabase/Stripe/Resend/Anthropic even when a local .env
// exists (dotenv never overrides an already-set variable).
const CREDENTIAL_FREE = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  RESEND_API_KEY: '',
  ANTHROPIC_API_KEY: '',
};

// The authenticated run forwards ONLY what signing in and seeding require.
// Stripe, Resend and Anthropic stay blank, so no test can spend money or send
// mail; entitlement states are asserted against the server's refusal.
const AUTH_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  RESEND_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  E2E_SEED_ENABLED: '1',
  E2E_SEED_SECRET: process.env.E2E_SEED_SECRET || '',
  // NODE_ENV stays 'test' below, so launchMode() is 'test' and the seed router
  // is permitted to mount. It refuses outright under a production mode.
};

const publicProjects = [
  { name: 'chromium', testIgnore: /authenticated\//, use: { ...devices['Desktop Chrome'] } },
  // Mobile viewport smoke (v5 Prompt 17 req 9) — chromium engine so only
  // one browser download is ever needed.
  {
    name: 'mobile',
    testIgnore: /authenticated\//,
    grep: /@mobile/,
    use: { ...devices['iPhone 12'], browserName: 'chromium' },
  },
];

// Desktop, phone and keyboard-only, because a campaign workspace that only
// works with a mouse on a large screen is not shippable.
const authenticatedProjects = [
  {
    name: 'authenticated',
    testDir: './e2e/authenticated',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'authenticated-mobile',
    testDir: './e2e/authenticated',
    use: { ...devices['iPhone 12'], browserName: 'chromium' },
  },
  {
    name: 'authenticated-keyboard',
    testDir: './e2e/authenticated',
    use: { ...devices['Desktop Chrome'], hasTouch: false },
    // Pointer input is disabled by the keyboard specs themselves; this project
    // exists so a keyboard failure is reported separately from a mouse pass.
    grep: /@keyboard/,
  },
];

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: AUTH ? [...publicProjects, ...authenticatedProjects] : publicProjects,
  webServer: {
    command: `node backend/server.js`,
    port: PORT,
    reuseExistingServer: true,
    env: {
      PORT: String(PORT),
      SERVE_APP: '1',
      SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-test-secret-not-production',
      NODE_ENV: 'test',
      // Vite emits crossorigin module scripts, so the browser sends Origin
      // even same-origin — allow the E2E origin explicitly.
      ALLOWED_ORIGINS: `http://127.0.0.1:${PORT},http://localhost:${PORT}`,
      ...(AUTH ? AUTH_ENV : CREDENTIAL_FREE),
    },
  },
});
