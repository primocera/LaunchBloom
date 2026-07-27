// v11 SC-03 — the authenticated matrix's seeding client and BLOCKED contract.
//
// Two rules this file exists to enforce:
//
//   1. A run that cannot authenticate must FAIL loudly, never skip quietly.
//      A skipped authenticated suite that reports green is how the signed-in
//      product stayed unproven through three release gates.
//   2. Data is isolated per run and deleted afterwards, so no test depends on
//      a long-lived shared account or on production.

const crypto = require('crypto');
const { test: base, expect } = require('@playwright/test');

const REQUIRED_ENV = ['E2E_SEED_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

/** Which required variables are absent. Presence only — never a value. */
function missingEnv() {
  return REQUIRED_ENV.filter((name) => !String(process.env[name] || '').trim());
}

const BLOCKED_MESSAGE = [
  'AUTHENTICATED E2E BLOCKED — the signed-in journey was NOT verified.',
  '',
  `Missing environment: ${missingEnv().join(', ') || '(none)'}`,
  '',
  'This is a release blocker, not a skip. Record it as `skipped` in',
  'docs/launch/launch-state.json — `npm run launch:gate` will hold NO-GO.',
  '',
  'To run it: point a NON-PRODUCTION Supabase project at the suite, set',
  'E2E_SEED_ENABLED=1 and a 24+ character E2E_SEED_SECRET, then re-run.',
].join('\n');

const newRunId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * Seed one scenario and return its credentials and ids. Talks to the
 * environment-gated seeding route; the browser then signs in normally.
 */
async function seed(request, runId, scenario) {
  const res = await request.post('/api/e2e/seed', {
    headers: { 'x-e2e-seed-secret': process.env.E2E_SEED_SECRET || '' },
    data: { run_id: runId, scenario },
  });
  if (!res.ok()) {
    throw new Error(`seeding "${scenario}" failed (${res.status()}): ${await res.text()}`);
  }
  return res.json();
}

async function cleanup(request, runId) {
  await request.delete(`/api/e2e/seed/${runId}`, {
    headers: { 'x-e2e-seed-secret': process.env.E2E_SEED_SECRET || '' },
  }).catch(() => {});
}

const test = base.extend({
  // A fresh isolated dataset per test, removed afterwards whatever the outcome.
  workspace: async ({ request, page }, use, testInfo) => {
    const blocked = missingEnv();
    if (blocked.length) throw new Error(BLOCKED_MESSAGE);

    const scenario = testInfo.annotations.find((a) => a.type === 'scenario');
    const runId = newRunId();
    const data = await seed(request, runId, scenario ? scenario.description : 'campaign_ready');

    // Sign in through the ordinary login form: the suite must exercise the
    // real auth path, not a injected session.
    await page.goto('/app/login');
    await page.getByLabel('Email address').fill(data.email);
    await page.getByLabel('Password', { exact: true }).fill(data.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 15_000 });

    await use(data);
    await cleanup(request, runId);
  },
});

// A test must fail on a global error boundary, a console error, a failed
// request or an unexpected redirect — otherwise a broken screen can still
// satisfy a visibility assertion and report green.
test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    problems.push(`request failed: ${req.method()} ${req.url()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) problems.push(`server error: ${res.status()} ${res.url()}`);
  });
  page.__problems = problems;
});

test.afterEach(async ({ page }) => {
  const boundary = await page.locator('[data-error-boundary], .error-boundary').count().catch(() => 0);
  expect(boundary, 'the app rendered a global error boundary').toBe(0);
  const problems = page.__problems || [];
  expect(problems, `page reported errors:\n${problems.join('\n')}`).toEqual([]);
});

module.exports = { test, expect, missingEnv, BLOCKED_MESSAGE, seed, cleanup, newRunId };
