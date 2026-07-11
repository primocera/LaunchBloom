// ---------------------------------------------------------------------------
// Anthropic structured-output helper. Same call pattern as ConversionForge's
// writeCopy(): messages.create with output_config json_schema, so the model
// returns exactly the JSON we asked for — no parsing heuristics.
// ---------------------------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

// Shared guardrails for every OfferFlow generation. The playbook rules:
// guided business workflow, ethical marketing, no overpromising.
const BASE_SYSTEM =
  'You are the AI engine of OfferFlow AI, a guided business workflow that takes solopreneurs, ' +
  'creators, freelancers, coaches, consultants and small service providers from idea to offer to launch. ' +
  'You produce specific, practical, grounded output based on the exact user data provided - never generic filler. ' +
  'Use ethical marketing language. Never promise specific income, revenue, or guaranteed results. ' +
  'Never invent credentials, testimonials, or statistics about the user. ' +
  'Write in plain, confident, human language. No hype words like "unleash", "skyrocket", "10x". ' +
  'Plain text inside JSON string values - no markdown.';

// ---------------------------------------------------------------------------
// Mock mode: without an ANTHROPIC_API_KEY we synthesize valid JSON straight
// from the schema (same philosophy as CF's keylessChat — the app must be
// fully clickable end-to-end with zero API cost). Every string is prefixed
// with [MOCK] so nobody mistakes it for real output.
// ---------------------------------------------------------------------------

let mockCounter = 0;

function mockFromSchema(schema, key = 'value') {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'string':
      return `[MOCK] ${key.replace(/_/g, ' ')} ${++mockCounter}`;
    case 'integer':
    case 'number':
      return ++mockCounter;
    case 'boolean':
      return false;
    case 'array': {
      const n = schema.minItems || 3;
      return Array.from({ length: n }, (_, i) => {
        const item = mockFromSchema(schema.items || { type: 'string' }, key);
        // day_number / sequence_order style fields need to actually count up
        return typeof item === 'object' && item !== null ? fixCounters(item, i + 1) : item;
      });
    }
    case 'object': {
      const out = {};
      for (const [k, sub] of Object.entries(schema.properties || {})) {
        out[k] = mockFromSchema(sub, k);
      }
      return out;
    }
    default:
      return null;
  }
}

function fixCounters(obj, n) {
  for (const k of ['day_number', 'sequence_order']) {
    if (k in obj) obj[k] = n;
  }
  return obj;
}

/**
 * One structured generation call.
 * @param {object} opts { system, prompt, schema, maxTokens }
 * @returns parsed JSON matching `schema`
 */
async function generateJson({ system, prompt, schema, maxTokens = 8000 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] no ANTHROPIC_API_KEY — returning schema-generated mock data');
    return mockFromSchema(schema);
  }

  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: BASE_SYSTEM + (system ? '\n\n' + system : ''),
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema } },
  });

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The AI declined to generate this content.'), { status: 422 });
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw Object.assign(new Error('Empty AI response.'), { status: 502 });
  }
  return JSON.parse(textBlock.text);
}

module.exports = { generateJson, MODEL };
