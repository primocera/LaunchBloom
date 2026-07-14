// ---------------------------------------------------------------------------
// HttpOnly session cookies for Supabase Auth (audit Prompt 3).
//
// We do NOT keep tokens in localStorage. The Supabase access token (short
// lived) and refresh token (long lived) live in Secure, HttpOnly, SameSite
// cookies that JS cannot read. requireAuth (lib/auth.js) validates the access
// token per request and silently refreshes using the refresh token.
// ---------------------------------------------------------------------------

const ACCESS_COOKIE = 'sb_access';
const REFRESH_COOKIE = 'sb_refresh';

// Access token is short-lived (Supabase default ~1h) but we let the cookie
// itself live as long as the refresh token so an expired access token can be
// refreshed rather than forcing re-login.
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // seconds (30 days)

function isProd() {
  return process.env.NODE_ENV === 'production';
}

/** Minimal cookie-header parser (avoids a cookie-parser dependency). */
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function cookieAttrs(maxAgeSeconds) {
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProd()) attrs.push('Secure');
  return attrs.join('; ');
}

/** Append a Set-Cookie header without clobbering existing ones. */
function appendCookie(res, str) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', str);
  else res.setHeader('Set-Cookie', Array.isArray(prev) ? prev.concat(str) : [prev, str]);
}

/** Persist a Supabase session ({ access_token, refresh_token }) as cookies. */
function setSessionCookies(res, session) {
  if (!session || !session.access_token || !session.refresh_token) return;
  appendCookie(res, `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; ${cookieAttrs(REFRESH_MAX_AGE)}`);
  appendCookie(res, `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; ${cookieAttrs(REFRESH_MAX_AGE)}`);
}

/** Expire both session cookies (logout / revoked session). */
function clearSessionCookies(res) {
  const expired = isProd()
    ? 'Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  appendCookie(res, `${ACCESS_COOKIE}=; ${expired}`);
  appendCookie(res, `${REFRESH_COOKIE}=; ${expired}`);
}

function readAccessToken(req) {
  return readCookie(req, ACCESS_COOKIE);
}
function readRefreshToken(req) {
  return readCookie(req, REFRESH_COOKIE);
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  readCookie,
  setSessionCookies,
  clearSessionCookies,
  readAccessToken,
  readRefreshToken,
};
