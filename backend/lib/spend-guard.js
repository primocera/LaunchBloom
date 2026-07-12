// ---------------------------------------------------------------------------
// Global daily spend guard. A hard cap on how many real AI generations the
// whole app may run per day, independent of per-user plan limits and of
// Anthropic's own billing controls. Protects against abuse or a runaway loop
// draining the credit balance.
//
// State lives in the same Supabase Storage bucket as credits (durable across
// serverless cold starts). Counting is best-effort — parallel calls may
// under-count slightly, which is fine for a safety ceiling.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

const BUCKET = 'offerflow-data';
const KEY = 'daily-usage.json';

// ~1 AI call ≈ $0.01 on Haiku, so 300/day ≈ ~$3/day worst case (~40 kits).
const MAX_AI_CALLS_PER_DAY = Number(process.env.MAX_AI_CALLS_PER_DAY || 300);

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

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

/**
 * Reserve one AI call against today's global budget. Throws a 503 when the
 * daily cap is reached; otherwise records the call and returns { used, limit }.
 * Only meaningful in live mode — callers skip it when there's no API key.
 */
async function reserveAiCall() {
  const all = await readUsage();
  const day = today();
  const used = all[day] || 0;

  if (used >= MAX_AI_CALLS_PER_DAY) {
    throw Object.assign(
      new Error("The app has hit today's AI usage limit. Please try again tomorrow."),
      { status: 503, code: 'DAILY_CAP' }
    );
  }

  // Keep only today's bucket so the file never grows unbounded.
  await writeUsage({ [day]: used + 1 });
  return { used: used + 1, limit: MAX_AI_CALLS_PER_DAY };
}

module.exports = { reserveAiCall, MAX_AI_CALLS_PER_DAY };
