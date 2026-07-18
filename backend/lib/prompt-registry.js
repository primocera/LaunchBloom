// ---------------------------------------------------------------------------
// Prompt registry (playbook v6, Prompt 12). Immutable, append-only entries:
// a version can never be edited once shipped — you add a new one and move
// CURRENT_PROMPT_VERSION forward. Every generation records the registry
// version (see lib/ai.js), so any asset can be traced to the exact prompt
// era that produced it and a previous version can be restored by changing
// one constant (or the AI_PROMPT_VERSION env var to a registered id).
// ---------------------------------------------------------------------------

const REGISTRY = Object.freeze({
  v1: Object.freeze({
    id: 'v1',
    created: '2026-05-01',
    model_policy: 'ANTHROPIC_MODEL env (default claude-haiku-4-5); structured json_schema output',
    schema_era: 'schemas.js pre-v6 (launch kit + five studio schemas)',
    change_note: 'Initial production prompts: BASE_SYSTEM guardrails, studio systems, quality checks.',
  }),
  v2: Object.freeze({
    id: 'v2',
    created: '2026-07-19',
    model_policy: 'ANTHROPIC_MODEL env (default claude-haiku-4-5); structured json_schema output',
    schema_era: 'schemas.js v6 (adds seoIdeasSchema; SEO Ideas generator parity)',
    change_note:
      'v6 playbook: SEO Ideas system prompt (no metrics, distinct keywords), review-ready vocabulary, ' +
      'fabricated-metric rejection before save.',
  }),
});

const CURRENT_PROMPT_VERSION = 'v2';

/** Resolve the active prompt version: env override must be a registered id. */
function activePromptVersion() {
  const env = process.env.AI_PROMPT_VERSION;
  if (env && REGISTRY[env]) return env;
  if (env && !REGISTRY[env]) {
    console.warn(`[prompt-registry] AI_PROMPT_VERSION="${env}" is not a registered version — using ${CURRENT_PROMPT_VERSION}`);
  }
  return CURRENT_PROMPT_VERSION;
}

function promptVersionInfo(id) {
  return REGISTRY[id] || null;
}

module.exports = { REGISTRY, CURRENT_PROMPT_VERSION, activePromptVersion, promptVersionInfo };
