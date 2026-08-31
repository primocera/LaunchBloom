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

// The secret arrives via an env/CI-secret, and a value set through the shell or
// the GitHub secret UI routinely carries a trailing newline or stray whitespace
// (`echo "…" | gh secret set` appends one). Node refuses to put a control char
// in a header value — `Invalid character in header content ["x-e2e-seed-secret"]`
// is thrown before the request is even sent, so every seed dies pre-flight and
// no HTTP status is ever returned. missingEnv() already trims for its presence
// check; the header value must be normalised the same way. The seed route trims
// the expected secret identically, so both sides agree on the canonical value.
const seedSecret = () => String(process.env.E2E_SEED_SECRET || '').trim();

/**
 * Seed one scenario and return its credentials and ids. Talks to the
 * environment-gated seeding route; the browser then signs in normally.
 */
async function seed(request, runId, scenario) {
  const res = await request.post('/api/e2e/seed', {
    headers: { 'x-e2e-seed-secret': seedSecret() },
    data: { run_id: runId, scenario },
  });
  if (!res.ok()) {
    throw new Error(`seeding "${scenario}" failed (${res.status()}): ${await res.text()}`);
  }
  return res.json();
}

async function cleanup(request, runId) {
  await request.delete(`/api/e2e/seed/${runId}`, {
    headers: { 'x-e2e-seed-secret': seedSecret() },
  }).catch(() => {});
}

const test = base.extend({
  // Playwright's built-in `request` fixture is a SEPARATE context with no
  // cookies, so an authenticated test that reached for `request` was silently
  // unauthenticated — a request to your OWN resource 401'd. Bind it to the
  // page's context so it carries the session the workspace fixture establishes.
  // Seeding (x-e2e-seed-secret header) works either way.
  request: async ({ page }, use) => {
    await use(page.request);
  },

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
    // Wait for the REAL post-login redirect. The old /\/app(\/|$)/ also matched
    // "/app/login" itself, so it returned instantly on the login page and every
    // test proceeded unauthenticated — the signed-in home is any /app route that
    // is NOT the login page.
    await page.waitForURL((url) => {
      const p = new URL(url).pathname;
      return p.startsWith('/app') && !p.startsWith('/app/login');
    }, { timeout: 15_000 });
    // And confirm the session is durably usable for full navigations before the
    // test body starts, so a slow cookie commit can't bounce the first goto.
    await expect
      .poll(async () => (await page.request.get('/api/auth/me')).status(), { timeout: 10_000 })
      .toBe(200);

    await use(data);
    await cleanup(request, runId);
  },
});

// A test must fail on a global error boundary, a console error, a failed
// request or an unexpected redirect — otherwise a broken screen can still
// satisfy a visibility assertion and report green.
test.beforeEach(async ({ page }) => {
  const problems = [];
  // A genuinely broken screen surfaces as an uncaught exception — the real
  // "the app fell over" signal (this listener was missing before).
  page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The browser auto-emits "Failed to load resource: <status>" for every
    // non-2xx fetch. That mirrors network status, not an app fault: a
    // logged-out /api/auth/me legitimately 401s on the login page, and the
    // billing/provider specs inject 4xx/5xx on purpose. A real app fault
    // still comes through as an uncaught error or an explicit console.error.
    if (/Failed to load resource/i.test(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    // A request the SPA aborts when it navigates after a successful action is
    // normal; only a genuine transport failure (refused, DNS, reset) counts.
    const err = req.failure()?.errorText || '';
    if (/ERR_ABORTED/i.test(err)) return;
    problems.push(`request failed: ${req.method()} ${req.url()} (${err})`);
  });
  page.__problems = problems;
});

test.afterEach(async ({ page }) => {
  const boundary = await page.locator('[data-error-boundary], .error-boundary').count().catch(() => 0);
  expect(boundary, 'the app rendered a global error boundary').toBe(0);
  const problems = page.__problems || [];
  expect(problems, `page reported errors:\n${problems.join('\n')}`).toEqual([]);
});

// page.goto resolves on the 'load' event — before React paints its first
// frame — so reading page text immediately after a navigation races an empty
// shell and can sample "". Wait for the app's main region to render real
// content, then return the full body text for the assertions to inspect.
async function mainText(page, expected) {
  // page.goto resolves on 'load' — before the SPA's fetches resolve and React
  // paints the settled state — so sampling body text immediately races an empty
  // shell (the sidebar alone already has text). Wait for the expected content to
  // actually appear (Playwright auto-retries this), then snapshot the full body
  // so a caller can also assert on what must NOT be present.
  if (expected) await expect(page.locator('body')).toContainText(expected, { timeout: 10_000 });
  return page.locator('body').innerText();
}

module.exports = { test, expect, missingEnv, BLOCKED_MESSAGE, seed, cleanup, newRunId, mainText };
