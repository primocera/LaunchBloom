// ---------------------------------------------------------------------------
// Structured logging with request IDs + redaction (audit Prompt 16).
// One JSON line per event so Vercel/Railway log search works. Never log
// secrets, tokens, passwords, prompt text or generated content.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const REDACT_KEYS = /pass|token|secret|key|authorization|cookie|email_body|prompt|content/i;

function redact(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'object' && v !== null) out[k] = redact(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

function log(level, msg, meta = {}) {
  const line = { ts: new Date().toISOString(), level, msg, ...redact(meta) };
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

/** Express middleware: attach a request id + log completion of API requests. */
function requestLogger(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      req_id: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}

module.exports = {
  requestLogger,
  logInfo: (msg, meta) => log('info', msg, meta),
  logError: (msg, meta) => log('error', msg, meta),
};
