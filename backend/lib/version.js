// ---------------------------------------------------------------------------
// v24 SV-24-01 (B) — the verifiable deployed version for the public /health.
//
// A release is only exact-SHA verifiable if production can say which commit it
// runs. On Vercel, VERCEL_GIT_COMMIT_SHA carries the deployed commit; we expose
// only a short hex prefix of it — never the env value verbatim, a deployment
// id, a URL, a path or any configuration.
//
// Resolved ONCE at module load (see server.js), never per request, and never by
// spawning git. Anything that is not a plain hex commit SHA falls back to a
// deterministic local marker, so a malformed value is never echoed back.
// ---------------------------------------------------------------------------

const SHORT_SHA_LENGTH = 12;
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/;
const PKG_VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * The public version string. Pure: `env` and `pkgVersion` are injected so the
 * production, local and invalid-SHA paths are deterministic in tests.
 *   production (valid VERCEL_GIT_COMMIT_SHA) → first 12 hex chars, lower-case
 *   anything else                            → "<package version>-dev" or "dev"
 */
function resolveVersion(env = process.env, pkgVersion = null) {
  const raw = typeof env.VERCEL_GIT_COMMIT_SHA === 'string' ? env.VERCEL_GIT_COMMIT_SHA.trim().toLowerCase() : '';
  if (COMMIT_SHA_RE.test(raw)) return raw.slice(0, SHORT_SHA_LENGTH);
  return typeof pkgVersion === 'string' && PKG_VERSION_RE.test(pkgVersion) ? `${pkgVersion}-dev` : 'dev';
}

function rootPackageVersion() {
  try { return require('../../package.json').version; } catch { return null; }
}

module.exports = { resolveVersion, rootPackageVersion, SHORT_SHA_LENGTH };
