require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3002;

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// General API rate limit — 100 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Tighter limit for payment creation endpoints
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please slow down.' },
});

// AI generation costs real money per call — cap per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
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

// ---------------------------------------------------------------------------
// Body parsing for all remaining routes
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' }));

const paymentRouter = require('./routes/payments');
const customerRouter = require('./routes/customers');

app.use('/api/payments', apiLimiter, paymentLimiter, paymentRouter);
app.use('/api/customers', apiLimiter, customerRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'offerflow',
    ai: process.env.ANTHROPIC_API_KEY ? 'live' : 'mock',
    model: process.env.ANTHROPIC_API_KEY ? (process.env.ANTHROPIC_MODEL || 'claude-opus-4-8') : null,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 404 + global error handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start. On Vercel the app is imported by a serverless function and must not
// bind a port; Railway/local runs listen directly.
// ---------------------------------------------------------------------------
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`OfferFlow backend running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`AI mode: ${process.env.ANTHROPIC_API_KEY ? 'live (Anthropic)' : 'MOCK (no ANTHROPIC_API_KEY)'}`);
  });
}

module.exports = app;
