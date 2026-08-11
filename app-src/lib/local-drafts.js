// ---------------------------------------------------------------------------
// LB-V17-03 — one versioned, bounded, user/workspace-scoped registry for every
// browser DRAFT (recoverable form state). Before this, studio and campaign
// drafts were written to localStorage with full client-confidential content, no
// TTL, no owner binding and no purge — so a shared browser profile could hold
// another client's offer, claims, names and notes indefinitely.
//
// Contract enforced here:
//   - Only keys declared in DRAFT_REGISTRY may be written as drafts. The
//     storage-inventory contract test fails on any undeclared `lb-`/draft key.
//   - Every draft is wrapped in a versioned envelope with createdAt/expiresAt
//     and a scope tag (user + workspace). A draft is restored ONLY when the
//     version, scope and TTL all still match — never across logout, account or
//     workspace switch, or an incompatible schema version.
//   - A per-draft byte cap and safe-parse guard: corrupt/oversize/expired
//     entries purge silently and restore nothing.
//   - NEVER store auth tokens or financial truth here. This is device-only
//     recovery, not a secure store — copy must say so and must not call it
//     encrypted.
// ---------------------------------------------------------------------------

export const DRAFT_SCHEMA_VERSION = 1;
export const MAX_DRAFT_BYTES = 64 * 1024; // 64KB — generous for a form, bounded.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

// Every allowed draft key. `prefix: true` means the declared name is a stem and
// real keys append a suffix (e.g. `lb-draft-website_pages`).
export const DRAFT_REGISTRY = {
  'lb-draft-': {
    prefix: true,
    scope: 'user+workspace',
    ttlMs: DEFAULT_TTL_MS,
    sensitivity: 'client-confidential',
    purpose: 'Studio generator form recovery across auth/paywall/checkout redirects.',
  },
  'campaign_form_draft': {
    prefix: false,
    scope: 'user',
    ttlMs: DEFAULT_TTL_MS,
    sensitivity: 'client-confidential',
    purpose: 'New-campaign form recovery across auth/paywall detours.',
  },
};

/** The registry entry governing `key`, or null if `key` is not a declared draft. */
export function policyFor(key) {
  if (Object.prototype.hasOwnProperty.call(DRAFT_REGISTRY, key)) return DRAFT_REGISTRY[key];
  for (const [name, policy] of Object.entries(DRAFT_REGISTRY)) {
    if (policy.prefix && key.startsWith(name)) return policy;
  }
  return null;
}

/** True if `key` is (or belongs under) a declared draft key. */
export function isRegisteredDraftKey(key) {
  return policyFor(key) !== null;
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

// A stable, non-PII-leaking scope tag. We keep the raw values (a workspace UUID
// and the user's own email) only inside the envelope for an exact-match check;
// they are the user's own identifiers, never another party's.
function scopeTag(policy, { userId, workspaceId }) {
  if (policy.scope === 'user+workspace') return `${userId || ''}::${workspaceId || ''}`;
  return `${userId || ''}`;
}

/**
 * Persist `data` under `key` for the current owner. No-op (returns false) if the
 * key is undeclared or the serialized envelope exceeds the byte cap — we never
 * silently drop the cap.
 */
export function saveDraft(key, data, owner = {}) {
  const policy = policyFor(key);
  const ls = store();
  if (!policy || !ls) return false;
  const now = Date.now();
  const envelope = {
    v: DRAFT_SCHEMA_VERSION,
    createdAt: now,
    expiresAt: now + policy.ttlMs,
    scope: scopeTag(policy, owner),
    data,
  };
  let serialized;
  try { serialized = JSON.stringify(envelope); } catch { return false; }
  if (serialized.length > MAX_DRAFT_BYTES) return false;
  try { ls.setItem(key, serialized); return true; } catch { return false; }
}

/**
 * Restore a draft for the current owner, or null. Returns null AND purges the
 * entry when it is corrupt, wrong-version, expired, oversize or belongs to a
 * different user/workspace — restoration never crosses those boundaries.
 */
export function loadDraft(key, owner = {}) {
  const policy = policyFor(key);
  const ls = store();
  if (!policy || !ls) return null;
  let raw;
  try { raw = ls.getItem(key); } catch { return null; }
  if (!raw) return null;
  if (raw.length > MAX_DRAFT_BYTES) { safeRemove(ls, key); return null; }
  let env;
  try { env = JSON.parse(raw); } catch { safeRemove(ls, key); return null; }
  if (!env || typeof env !== 'object') { safeRemove(ls, key); return null; }
  if (env.v !== DRAFT_SCHEMA_VERSION) { safeRemove(ls, key); return null; }
  if (typeof env.expiresAt !== 'number' || env.expiresAt <= Date.now()) { safeRemove(ls, key); return null; }
  if (env.scope !== scopeTag(policy, owner)) { safeRemove(ls, key); return null; }
  return env.data ?? null;
}

/** Remove one draft (e.g. after a successful generate/submit). */
export function clearDraft(key) {
  const ls = store();
  if (ls) safeRemove(ls, key);
}

/** Every draft key currently present in localStorage (declared ones only). */
function draftKeysPresent(ls) {
  const keys = [];
  for (let i = 0; i < ls.length; i += 1) {
    const k = ls.key(i);
    if (k && isRegisteredDraftKey(k)) keys.push(k);
  }
  return keys;
}

/**
 * Purge ALL registered drafts on this device. Called on logout, account
 * deletion success and the explicit "Clear local drafts" control. Returns the
 * count removed (for a neutral "N drafts cleared" notice — never their content).
 */
export function clearAllDrafts() {
  const ls = store();
  if (!ls) return 0;
  const keys = draftKeysPresent(ls);
  for (const k of keys) safeRemove(ls, k);
  return keys.length;
}

/** How many registered drafts are currently stored (for the Account control). */
export function draftCount() {
  const ls = store();
  if (!ls) return 0;
  return draftKeysPresent(ls).length;
}

/** Drop expired/incompatible drafts opportunistically (call on app load). */
export function purgeExpiredDrafts() {
  const ls = store();
  if (!ls) return 0;
  let removed = 0;
  for (const k of draftKeysPresent(ls)) {
    let env;
    try { env = JSON.parse(ls.getItem(k) || 'null'); } catch { env = null; }
    const stale = !env || env.v !== DRAFT_SCHEMA_VERSION
      || typeof env.expiresAt !== 'number' || env.expiresAt <= Date.now();
    if (stale) { safeRemove(ls, k); removed += 1; }
  }
  return removed;
}

function safeRemove(ls, key) {
  try { ls.removeItem(key); } catch { /* ignore */ }
}
