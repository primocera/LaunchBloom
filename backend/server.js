require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
// v13 SC-P0-04: launch configuration is validated automatically at startup, so
// a paid production deploy with placeholder legal/billing config is visible
// BEFORE it can serve checkout. In production this needs no flag; an unsafe
// bypass (UNSAFE_SKIP_LAUNCH_CONFIG_CHECK) refuses to start there.
require('./lib/launch-config').startupLaunchConfigCheck();
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { BRAND } = require('./lib/brand');
const { requestLogger, logError } = require('./lib/logger');
const { isEntitlementUnavailable, planUnavailableBody } = require('./lib/subscription-state');

const app = express();
app.set('trust proxy', 1);
app.use(requestLogger);
const PORT = process.env.PORT || 3002;

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Local E2E fires hundreds of requests from one IP — don't throttle tests.
const isTestEnv = process.env.NODE_ENV === 'test';

// General API rate limit — 100 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 100000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Tighter limit for payment creation endpoints
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 100000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please slow down.' },
});

// AI generation costs real money per call — key by the VERIFIED user (playbook
// v6, Prompt 9: IP alone is a weak cost boundary — one user behind rotating
// IPs, or a whole office behind one NAT). It runs after requireAuth, so the key
// is req.userId. (It used to key on the first 64 chars of the sb_access JWT,
// which is the header + issuer — identical for every user, so all signed-in
// users shared one bucket.) MemoryStore is per-instance on serverless; the
// durable cost boundary remains the plan gate.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 100000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? `u:${req.userId}` : `ip:${req.ip}`),
  message: { error: 'AI generation limit reached, please try again later.' },
});

// A limiter mounted in front of several routers would otherwise run — and
// count — once per router the request passes through (one Library request was
// ~8 hits against apiLimiter, a studio generation 2 against aiLimiter). Count
// each request once per limiter.
function countOnce(limiter, flag) {
  return (req, res, next) => {
    if (req[flag]) return next();
    req[flag] = true;
    return limiter(req, res, next);
  };
}
const apiLimit = countOnce(apiLimiter, '_apiLimitCounted');
const aiLimit = countOnce(aiLimiter, '_aiLimitCounted');
const { requireAuth } = require('./lib/auth');

// ---------------------------------------------------------------------------
// Restrictive CORS
// ---------------------------------------------------------------------------
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3002', 'http://127.0.0.1:3002'];

// Exact-origin allowlist only (playbook v6, Prompt 9). The old `.vercel.app`
// suffix trust let ANY Vercel-hosted site make credentialed requests. Preview
// deployments must now be listed explicitly in ALLOWED_PREVIEW_ORIGINS.
const previewOrigins = (process.env.ALLOWED_PREVIEW_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server, curl
      if (allowedOrigins.includes(origin) || previewOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// Stripe webhook MUST be mounted before express.json() — raw body needed
// for signature verification.
// ---------------------------------------------------------------------------
const webhookRouter = require('./routes/webhooks');
app.use('/api/webhooks', webhookRouter);

// Routers that bring their own body parsers
const authRouter = require('./routes/auth');
app.use(authRouter);

const workspacesRouter = require('./routes/workspaces');
app.use(workspacesRouter);

// Fail-closed launch config (v6 Prompt 1): in real production (live Stripe
// key) missing legal/origin/secret config hard-disables generation + checkout.
const { requireLaunchReady } = require('./lib/launch-config');

const aiRouter = require('./routes/ai');
// requireAuth before aiLimit so the AI limit is keyed by the verified user;
// requireAuth is idempotent, so planGate's own auth check reuses the result.
app.use('/api/ai', apiLimit, requireAuth, aiLimit, requireLaunchReady('generation'), aiRouter);

// Marketing-asset studios (website/email/campaign/social/creative) — same
// base path and limiters as the core AI routes.
const assetsRouter = require('./routes/assets');
app.use('/api/ai', apiLimit, requireAuth, aiLimit, requireLaunchReady('generation'), assetsRouter);

// ---------------------------------------------------------------------------
// Body parsing for all remaining routes
// ---------------------------------------------------------------------------
// The campaigns/evidence (16kb) and library (32kb) routers declare larger
// limits for briefs and asset text, but this global parser runs first and its
// 10kb cap used to win - a long brief autosave got 413. Apply each router's
// declared limit here; their own router-level parsers then no-op.
const jsonDefault = express.json({ limit: '10kb' });
const jsonBrief = express.json({ limit: '16kb' });
const jsonAsset = express.json({ limit: '32kb' });
app.use((req, res, next) => {
  const p = req.path;
  if (/^\/api\/(assets|usage)(\/|$)/.test(p)) return jsonAsset(req, res, next);
  if (/^\/api\/(campaigns|playbooks|templates|evidence)(\/|$)/.test(p)) return jsonBrief(req, res, next);
  return jsonDefault(req, res, next);
});

// Public commercial catalog (v5 Prompt 1) — read-only, no auth.
const plansRouter = require('./routes/plans');
app.use(apiLimit, plansRouter);

const paymentRouter = require('./routes/payments');
const customerRouter = require('./routes/customers');

app.use('/api/payments', apiLimit, paymentLimiter, requireLaunchReady('checkout'), paymentRouter);
app.use('/api/customers', apiLimit, customerRouter);

const accountRouter = require('./routes/account');
app.use(apiLimit, accountRouter);

// v10 SC-06: one-click unsubscribe. Public by necessity — the link is clicked
// from a mail client with no session. Mounted before the restrictive CORS
// allowlist for the same reason the other public endpoints are.
const emailPreferencesRouter = require('./routes/email-preferences');
app.use(apiLimit, emailPreferencesRouter);

const eventsRouter = require('./routes/events');
app.use(apiLimit, eventsRouter);

// Admin support view (Prompt 16) — read-only, ADMIN_EMAILS allowlist.
const adminRouter = require('./routes/admin');
app.use(apiLimit, adminRouter);

// Campaign Studio (Prompt 12) — brings its own JSON parser.
const campaignsRouter = require('./routes/campaigns');
app.use(apiLimit, campaignsRouter);

// Evidence locker (v8 LB-S04) — brings its own JSON parser.
const evidenceRouter = require('./routes/evidence');
app.use(apiLimit, evidenceRouter);

// Asset Library (Prompt 13) — brings its own JSON parser.
const libraryRouter = require('./routes/library');
app.use(apiLimit, libraryRouter);

// Capped-beta feedback (v11 SC-07) — bounded categories only; optional free
// text stays in beta_feedback and never reaches analytics.
const feedbackRouter = require('./routes/feedback');
app.use(apiLimit, feedbackRouter);

// v11 SC-03 — seed/reset for the authenticated browser matrix. Mounted ONLY
// when explicitly enabled, and the router itself refuses to answer in
// production or without a sufficiently long secret. Nothing about it is
// reachable in a normal deployment.
if (process.env.E2E_SEED_ENABLED === '1') {
  const e2eSeedRouter = require('./routes/e2e-seed');
  const problem = e2eSeedRouter.seedingAllowed();
  if (problem) {
    console.warn(`[e2e-seed] NOT mounted: ${problem}`);
  } else {
    app.use(apiLimit, e2eSeedRouter);
    console.warn('[e2e-seed] mounted — this must never happen in production');
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
// v24 SV-24-01: the deployed commit as a short hex prefix (resolved once, never
// per request), so production parity can be verified against the RC SHA.
const { resolveVersion, rootPackageVersion } = require('./lib/version');
const APP_VERSION = resolveVersion(process.env, rootPackageVersion());

app.get('/health', (_req, res) => {
  // Public health check must not expose model / AI-mode / config details (Prompt 10).
  res.json({
    status: 'ok',
    app: BRAND.name,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Optional static frontend (v5 Prompt 16): SERVE_APP=1 serves the committed
// app/ build with the same SPA fallback Vercel's rewrites provide. Used by
// the local Playwright E2E suite and prod-like local runs — not on Vercel.
// ---------------------------------------------------------------------------
if (process.env.SERVE_APP === '1') {
  const path = require('path');
  const appDir = path.join(__dirname, '..', 'app');
  // Vite base is /app/ — assets live under /app/assets/ (see vercel.json).
  // redirect:false so a route like /app/assets (the Library) is NOT 301'd to
  // /app/assets/ and swallowed by the static asset dir; it falls through to the
  // SPA index below, matching how Vercel serves the client route.
  app.use('/app', express.static(appDir, { redirect: false }));
  app.get(/^\/(app(?!\/assets\/)(\/.*)?|legal(\/.*)?)?$/, (_req, res) => {
    res.sendFile(path.join(appDir, 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// 404 + global error handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, _next) => {
  // v13 SC-P0-01: entitlement could not be VERIFIED (Supabase/provider down).
  // Every plan-reading route (auth/me, login, account billing, planGate,
  // workspace creation) reaches here by throwing rather than silently falling
  // back to 'free'. Answer with a stable, retryable 503 and no access change —
  // the UI keeps whatever access it is already showing.
  if (isEntitlementUnavailable(err)) {
    logError('plan_unavailable', { req_id: req.id, path: req.path, message: err.message });
    return res.status(503).json({ ...planUnavailableBody(), req_id: req.id });
  }
  logError('unhandled_error', { req_id: req.id, path: req.path, message: err.message, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    req_id: req.id,
  });
});

// ---------------------------------------------------------------------------
// Start. On Vercel the app is imported by a serverless function and must not
// bind a port; Railway/local runs listen directly.
// ---------------------------------------------------------------------------
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`${BRAND.name} backend running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`AI mode: ${process.env.ANTHROPIC_API_KEY ? 'live (Anthropic)' : 'MOCK (no ANTHROPIC_API_KEY)'}`);
  });
}

module.exports = app;
