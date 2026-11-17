// ---------------------------------------------------------------------------
// Audit S2 (2026-11-15): the static app shell is served by Vercel, not by
// Express, so helmet never covered it. vercel.json carries the frame,
// nosniff and referrer headers on every path and a CSP on everything outside
// /api (the API keeps helmet's own policy).
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headersFor = (source) => {
  const block = (vercel.headers || []).find((h) => h.source === source);
  return Object.fromEntries((block ? block.headers : []).map((h) => [h.key, h.value]));
};

test('S2: every path is unframeable, nosniff and referrer-limited', () => {
  const all = headersFor('/(.*)');
  assert.equal(all['X-Frame-Options'], 'DENY');
  assert.equal(all['X-Content-Type-Options'], 'nosniff');
  assert.equal(all['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

test('S2: the app shell has a same-origin CSP that forbids framing', () => {
  const csp = headersFor('/((?!api/).*)')['Content-Security-Policy'] || '';
  for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(d), `CSP lacks ${d}`);
  }
  assert.ok(!/script-src[^;]*'unsafe-(inline|eval)'/.test(csp), 'no inline or eval script');
});

test('S2: the built app shell loads scripts only from its own origin', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, attrs, body] of scripts) {
    const src = (/src="([^"]+)"/.exec(attrs) || [])[1];
    assert.ok(src && src.startsWith('/'), `external or inline script would be blocked by the CSP: ${attrs}`);
    assert.equal(body.trim(), '', 'inline script would be blocked by the CSP');
  }
});
