// v5 Prompts 16/17: local Playwright E2E. Deliberately NOT run in CI — the CI
// pipeline stays lean (install/lint/unit/build) so it never flakes. Run
// locally with:  npx playwright install chromium   then   npm run test:e2e
//
// The suite boots the real backend with SERVE_APP=1 (static app/ + SPA
// fallback, mirroring Vercel rewrites) and NO external credentials: AI runs
// in mock mode, Stripe/Supabase-dependent journeys are exercised only up to
// their public seams.

const { defineConfig, devices } = require('@playwright/test');

const PORT = 3109;

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport smoke (v5 Prompt 17 req 9) — chromium engine so only
    // one browser download is ever needed.
    { name: 'mobile', use: { ...devices['iPhone 12'], browserName: 'chromium' }, grep: /@mobile/ },
  ],
  webServer: {
    command: `node backend/server.js`,
    port: PORT,
    reuseExistingServer: true,
    env: {
      PORT: String(PORT),
      SERVE_APP: '1',
      SESSION_SECRET: 'e2e-test-secret-not-production',
      NODE_ENV: 'test',
      // Vite emits crossorigin module scripts, so the browser sends Origin
      // even same-origin — allow the E2E origin explicitly.
      ALLOWED_ORIGINS: `http://127.0.0.1:${PORT},http://localhost:${PORT}`,
      // dotenv never overrides vars that are already set — blanking these
      // guarantees the suite can never touch real Supabase/Stripe/Resend/
      // Anthropic even when a local .env exists.
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      RESEND_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      // No ANTHROPIC_API_KEY → AI mock mode. No Stripe/Supabase/Resend keys →
      // lazy proxies; tests stay on public, credential-free surfaces.
    },
  },
});
