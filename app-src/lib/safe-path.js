// ---------------------------------------------------------------------------
// v13 SC-P0-06: one place that decides whether a value may be used as an
// in-app navigation target.
//
// React Router's open-redirect advisories (GHSA-jjmj-jmhj-qwj2 /
// GHSA-wrjc-x8rr-h8h6) come from `to` / `href` values that LOOK relative but
// are read by the browser as another origin: `//evil.com`, `\\evil.com`,
// `/\evil.com`, `https://evil.com`, `javascript:`. The router upgrade fixes
// the library; this module makes the application refuse such values at the
// sink, so any future untrusted `redirect` / `next` / `returnTo` input has a
// single validated entry point instead of a per-call-site judgement call.
//
// Rule: only same-origin application paths. A safe path starts with a single
// "/", is not followed by "/" or a backslash, contains no backslash anywhere,
// and carries no scheme, credentials or control characters. Anything else
// falls back.
// ---------------------------------------------------------------------------

export const DEFAULT_SAFE_PATH = '/app';

function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * True when `value` is a same-origin application path that can be handed to
 * navigate()/<Link to>/href without risking an off-site navigation.
 */
export function isSafeInternalPath(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;
  if (hasControlChars(value)) return false;  // NUL/tab/newline/space smuggling
  if (!value.startsWith('/')) return false;     // relative, absolute URL, or scheme
  if (value.startsWith('//')) return false;     // protocol-relative -> other origin
  if (value.includes('\\')) return false;       // backslash -> treated as "/" by browsers
  return true;
}

/**
 * Coerce an untrusted navigation target to something safe. Returns the value
 * itself when it is a safe internal path, otherwise `fallback`.
 */
export function safeInternalPath(value, fallback = DEFAULT_SAFE_PATH) {
  return isSafeInternalPath(value) ? value : fallback;
}
