require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
// v5 Prompt 15: loud deploy-time warning while legal placeholders remain.
{
  const { legalPlaceholders } = require('./lib/brand');
  const missing = legalPlaceholders();
  if (missing.length && process.env.NODE_ENV === 'production') {
    console.error(`[legal] PRODUCTION LEGAL CONFIG INCOMPLETE — checkout is blocked until these env vars are set: ${missing.join(', ')}`);
  }
}
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { BRAND } = require('./lib/brand');
const { requestLogger, logError } = require('./lib/logger');

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

// AI generation costs real money per call — cap per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 100000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI generation limit reached, please try again later.' },
});

// ---------------------------------------------------------------------------
// Restrictive CORS
// ---------------------------------------------------------------------------
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3002', 'http://127.0.0.1:3002'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server, curl
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Any Vercel deployment of this app (production + preview URLs) is us.
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* malformed */ }
      if (host.endsWith('.vercel.app')) return callback(null, true);
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

const aiRouter = require('./routes/ai');
app.use('/api/ai', apiLimiter, aiLimiter, aiRouter);

// Marketing-asset studios (website/email/campaign/social/creative) — same
// base path and limiters as the core AI routes.
const assetsRouter = require('./routes/assets');
app.use('/api/ai', apiLimiter, aiLimiter, assetsRouter);

// ---------------------------------------------------------------------------
// Body parsing for all remaining routes
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' }));

// Public commercial catalog (v5 Prompt 1) — read-only, no auth.
const plansRouter = require('./routes/plans');
app.use(apiLimiter, plansRouter);

const paymentRouter = require('./routes/payments');
const customerRouter = require('./routes/customers');

app.use('/api/payments', apiLimiter, paymentLimiter, paymentRouter);
app.use('/api/customers', apiLimiter, customerRouter);

const accountRouter = require('./routes/account');
app.use(apiLimiter, accountRouter);

const eventsRouter = require('./routes/events');
app.use(apiLimiter, eventsRouter);

// Admin support view (Prompt 16) — read-only, ADMIN_EMAILS allowlist.
const adminRouter = require('./routes/admin');
app.use(apiLimiter, adminRouter);

// Campaign Studio (Prompt 12) — brings its own JSON parser.
const campaignsRouter = require('./routes/campaigns');
app.use(apiLimiter, campaignsRouter);

// Asset Library (Prompt 13) — brings its own JSON parser.
const libraryRouter = require('./routes/library');
app.use(apiLimiter, libraryRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  // Public health check must not expose model / AI-mode / config details (Prompt 10).
  res.json({
    status: 'ok',
    app: BRAND.name,
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
  app.use('/app', express.static(appDir));
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
