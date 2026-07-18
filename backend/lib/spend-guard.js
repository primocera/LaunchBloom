// ---------------------------------------------------------------------------
// Global daily spend guard (playbook v6, Prompt 5). A hard cap on how many
// real AI generations the whole app may run per day, independent of per-user
// plan limits and of Anthropic's own billing controls.
//
// Counting is now an ATOMIC database ledger (ai_spend_ledger + the
// reserve_ai_spend / finalize_ai_spend / release_ai_spend SQL functions from
// migration 024): reserve one call before hitting the provider, finalize real
// token usage after success, release the reservation on failure. Concurrent
// serverless requests serialize on the day row, so increments can't be lost.
//
// If the migration hasn't been applied yet (RPC missing), we fall back to the
// legacy best-effort Storage-JSON counter so generation keeps working — with
// a loud warning, because the fallback is racy.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

const BUCKET = 'offerflow-data';
const KEY = 'daily-usage.json';

// ~1 AI call ≈ $0.01 on Haiku, so 300/day ≈ ~$3/day worst case (~40 kits).
const MAX_AI_CALLS_PER_DAY = Number(process.env.MAX_AI_CALLS_PER_DAY || 300);

// Warn-level thresholds for operators (60/80/100% of daily budget).
const ALERT_THRESHOLDS = [0.6, 0.8, 1];

// Emergency switch: pause all generation without taking editing/export offline.
function generationPaused() {
  return process.env.AI_GENERATION_PAUSED === '1';
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function capError() {
  return Object.assign(
    new Error("The app has hit today's AI usage limit. Please try again tomorrow."),
    { status: 503, code: 'DAILY_CAP' }
  );
}

function pausedError() {
  return Object.assign(
    new Error('Generation is temporarily paused while we protect service capacity. Editing and exporting still work.'),
    { status: 503, code: 'GENERATION_PAUSED' }
  );
}

// RPC missing => migration not applied (PostgREST PGRST202 / Postgres 42883).
function isMissingFunction(error) {
  const code = error && error.code;
  const msg = String((error && error.message) || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg);
}

let warnedFallback = false;
const alertedAt = new Map(); // day -> highest threshold already logged

function maybeAlert(day, used) {
  const ratio = used / MAX_AI_CALLS_PER_DAY;
  for (const t of ALERT_THRESHOLDS) {
    if (ratio >= t && (alertedAt.get(day) || 0) < t) {
      alertedAt.set(day, t);
      console.warn('[spend-guard]', JSON.stringify({
        event: 'daily_budget_threshold',
        day,
        used,
        limit: MAX_AI_CALLS_PER_DAY,
        threshold_pct: Math.round(t * 100),
      }));
    }
  }
}

// --- legacy Storage-JSON fallback (racy; only until migration 024 runs) -----

async function readUsage() {
  try {
    const { data } = await supabase.storage.from(BUCKET).download(KEY);
    if (!data) return {};
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  } catch (e) {
    return {};
  }
}

async function writeUsage(value) {
  await supabase.storage
    .from(BUCKET)
    .upload(KEY, Buffer.from(JSON.stringify(value), 'utf8'), {
      contentType: 'application/json',
      upsert: true,
    });
}

async function legacyReserve(day) {
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn('[spend-guard] ai_spend_ledger RPC missing — using legacy racy Storage counter. Apply migration 024.');
  }
  const all = await readUsage();
  const used = all[day] || 0;
  if (used >= MAX_AI_CALLS_PER_DAY) throw capError();
  await writeUsage({ [day]: used + 1 });
  return { used: used + 1, limit: MAX_AI_CALLS_PER_DAY, ledger: false };
}

// --- public API --------------------------------------------------------------

/**
 * Reserve one AI call against today's global budget. Throws 503 DAILY_CAP when
 * the cap is reached (atomically — the SQL function returns no row) and 503
 * GENERATION_PAUSED when the emergency switch is on.
 * Returns { used, limit, day, ledger } — pass `day` to finalize/release.
 */
async function reserveAiCall() {
  if (generationPaused()) throw pausedError();

  const day = today();
  const { data, error } = await supabase.rpc('reserve_ai_spend', {
    p_day: day,
    p_cap: MAX_AI_CALLS_PER_DAY,
  });

  if (error) {
    if (isMissingFunction(error)) return { ...(await legacyReserve(day)), day };
    // Fail closed on unknown DB errors: better to refuse one generation than
    // to run unmetered spend.
    console.error('[spend-guard] reserve failed:', error.message || error);
    throw Object.assign(new Error('Generation is temporarily unavailable. Please try again.'), {
      status: 503,
      code: 'SPEND_GUARD_UNAVAILABLE',
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.reserved_count == null) throw capError();

  maybeAlert(day, row.reserved_count);
  return { used: row.reserved_count, limit: MAX_AI_CALLS_PER_DAY, day, ledger: true };
}

/** Record real provider usage for a successful call reserved on `day`. */
async function finalizeAiCall(day, { inputTokens, outputTokens, estimatedCost } = {}) {
  try {
    const { error } = await supabase.rpc('finalize_ai_spend', {
      p_day: day || today(),
      p_input_tokens: inputTokens || 0,
      p_output_tokens: outputTokens || 0,
      p_cost: estimatedCost || 0,
    });
    if (error && !isMissingFunction(error)) {
      console.error('[spend-guard] finalize failed:', error.message || error);
    }
  } catch (e) {
    console.error('[spend-guard] finalize failed:', e.message);
  }
}

/** Give a failed call's reservation back to today's budget. */
async function releaseAiCall(day) {
  try {
    const { error } = await supabase.rpc('release_ai_spend', { p_day: day || today() });
    if (error && !isMissingFunction(error)) {
      console.error('[spend-guard] release failed:', error.message || error);
    }
  } catch (e) {
    console.error('[spend-guard] release failed:', e.message);
  }
}

module.exports = { reserveAiCall, finalizeAiCall, releaseAiCall, MAX_AI_CALLS_PER_DAY, generationPaused };
