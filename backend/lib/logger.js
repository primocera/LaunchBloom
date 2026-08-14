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
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

// v18 X02: a distributed TRACE id correlates one logical operation across the
// edge, this API and background jobs — unlike `req.id`, which identifies a
// single request (a span). We honour an inbound trace id so an upstream proxy
// or a client that already started a trace keeps the same id end-to-end:
//   • W3C `traceparent`: 00-<32-hex trace-id>-<16-hex span>-<flags>
//   • or an opaque `x-trace-id` header
// Anything malformed is ignored (never trusted as-is), and we mint a fresh id.
const TRACEPARENT_RE = /^\d{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;
const OPAQUE_TRACE_RE = /^[A-Za-z0-9._-]{8,128}$/;

function traceIdFrom(headers = {}) {
  const traceparent = headers['traceparent'];
  if (typeof traceparent === 'string') {
    const m = traceparent.trim().match(TRACEPARENT_RE);
    // All-zero trace-id is the W3C "invalid" sentinel — reject it.
    if (m && !/^0{32}$/.test(m[1])) return m[1].toLowerCase();
  }
  const opaque = headers['x-trace-id'];
  if (typeof opaque === 'string' && OPAQUE_TRACE_RE.test(opaque.trim())) return opaque.trim();
  return null;
}

/** Express middleware: attach request + trace ids and log API request completion. */
function requestLogger(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  // The trace id spans services; the request id is this hop. When no inbound
  // trace exists, the request starts the trace, so the two ids seed together.
  req.traceId = traceIdFrom(req.headers) || req.id;
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Trace-Id', req.traceId);
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      req_id: req.id,
      trace_id: req.traceId,
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
  traceIdFrom,
  logInfo: (msg, meta) => log('info', msg, meta),
  logError: (msg, meta) => log('error', msg, meta),
};
