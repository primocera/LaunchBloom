// ---------------------------------------------------------------------------
// Shared rate-limit store (audit S1). express-rate-limit's default MemoryStore
// keeps counters per serverless instance, so on Vercel a limit like "20 login
// attempts per 15 minutes" only held per warm instance. This store keeps the
// counter in Postgres (migration 043, rate_limit_hit()), shared by every
// instance.
//
// Keys are hashed before they leave the process: the table never holds an
// email address or an IP.
//
// Fallback: until migration 043 is applied (function missing), or when the
// database cannot be reached, the store counts in memory exactly like the
// default store did before. A rate limit must never take sign-in down, and the
// memory fallback is the behaviour production had until now.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { MemoryStore } = require('express-rate-limit');
const supabase = require('./supabase');

function isMissingFunction(error) {
  const code = error && error.code;
  const msg = String((error && error.message) || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg);
}

class PostgresStore {
  /** @param {string} name distinguishes limiters that share a client key */
  constructor(name) {
    this.name = name;
    this.memory = new MemoryStore();
    this.missing = false; // migration 043 not applied: stop asking
    this.warned = false;
    // express-rate-limit: counters are shared, not per instance.
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  hashed(key) {
    return crypto.createHash('sha256').update(`${this.name}\u0000${key}`).digest('hex');
  }

  warnOnce(message) {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[rate-limit] ${this.name}: ${message} - counting per instance`);
  }

  async increment(key) {
    if (!this.missing) {
      try {
        const { data, error } = await supabase.rpc('rate_limit_hit', {
          p_key: this.hashed(key),
          p_window_ms: this.windowMs,
        });
        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          if (row && row.hits != null) {
            return { totalHits: Number(row.hits), resetTime: row.reset_at ? new Date(row.reset_at) : undefined };
          }
        } else if (isMissingFunction(error)) {
          this.missing = true;
          this.warnOnce('rate_limit_hit missing (apply migration 043)');
        } else {
          this.warnOnce(`shared store unavailable (${error.message || error.code})`);
        }
      } catch (err) {
        this.warnOnce(`shared store unavailable (${err.message})`);
      }
    }
    return this.memory.increment(key);
  }

  // Only used for skipSuccessfulRequests / skipFailedRequests, which these
  // limiters do not set; the memory copy keeps the fallback consistent.
  async decrement(key) {
    return this.memory.decrement(key);
  }

  async resetKey(key) {
    await this.memory.resetKey(key);
    if (this.missing) return;
    try {
      await supabase.from('rate_limit_hits').delete().eq('key', this.hashed(key));
    } catch {
      /* best effort */
    }
  }
}

/**
 * The signed-in user a request claims to be, for rate-limit KEYING only: the
 * subject of the sb_access token, read without verifying it (requireAuth does
 * that later). An agency office shares one IP, so a per-IP general limit
 * throttled colleagues against each other during normal work. A forged subject
 * buys nothing: the request still fails auth, and the per-IP backstop in
 * server.js still counts it.
 */
function claimedUserId(req) {
  const pair = String((req.headers && req.headers.cookie) || '').split(';').map((c) => c.trim())
    .find((c) => c.startsWith('sb_access='));
  if (!pair) return null;
  try {
    const part = decodeURIComponent(pair.slice('sb_access='.length)).split('.')[1];
    if (!part) return null;
    const sub = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).sub;
    return typeof sub === 'string' && /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

module.exports = { PostgresStore, claimedUserId };
