// ---------------------------------------------------------------------------
// Prompt 28: safety guardrails for generated marketing copy. Scans AI output
// for the risky patterns the spec lists (income guarantees, medical claims,
// manipulative scarcity, shame-based marketing...) and returns
// { risk_level, flagged_phrases, explanation, safer_alternatives }.
// High risk shows a UI warning; the user is never blocked from editing.
// ---------------------------------------------------------------------------

// [category, pattern, safer alternative]
const RULES = [
  ['guaranteed income promise', /guarantee[ds]?\s+(?:\$|€|\d|income|revenue|profit|results)|make \$?\d[\d,]* (?:per|a) (?:day|week|month)|double your (?:income|revenue)/i,
    'Describe the process and a realistic outcome range instead of guaranteeing money.'],
  ['unrealistic growth claim', /overnight success|10x your|explode your (?:growth|sales)|go viral guaranteed|passive income while you sleep/i,
    'Use honest growth language: "build steadily", "first paying clients", "repeatable system".'],
  ['medical diagnosis/treatment claim', /cures?|heals?|treats?\s+(?:\w+\s+)?(?:disease|illness|condition|cancer|diabetes|adhd|anxiety disorder)/i,
    'Position as support for wellbeing, and tell readers to consult a healthcare professional.'],
  ['mental health therapy claim', /replaces? therapy|works like therapy|cure your (?:depression|anxiety|trauma)/i,
    'Say it complements professional help, never replaces it.'],
  ['weight loss guarantee', /lose \d+\s?(?:kg|lbs|pounds) in \d+|guaranteed weight loss|melt fat/i,
    'Talk about sustainable habits and realistic, individual results.'],
  ['supplement disease claim', /supplement[^.]{0,40}(?:prevents?|cures?|treats?)/i,
    'Avoid disease claims entirely; describe ingredients and intended use only.'],
  ['manipulative scarcity', /only \d+ (?:spots|copies) left(?!\s*\()|price goes up at midnight|closing forever|last chance ever/i,
    'Use real limits only, with the honest reason ("I onboard 3 clients a month because...").'],
  ['shame-based marketing', /still (?:broke|fat|failing|stuck)\?|what.s wrong with you|no excuses|stop being lazy/i,
    'Speak to the situation, not the person: "the system was missing", not "you failed".'],
];

/** Collect every string value nested inside a generated section. */
function stringsIn(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringsIn(v, acc));
  return acc;
}

/**
 * safetyCheck(anything) → { risk_level, flagged_phrases, explanation, safer_alternatives }
 */
function safetyCheck(output) {
  const texts = stringsIn(output);
  const flagged = [];
  const alternatives = new Set();
  const categories = new Set();

  for (const text of texts) {
    for (const [category, pattern, alt] of RULES) {
      const hit = text.match(pattern);
      if (hit) {
        flagged.push(hit[0]);
        alternatives.add(alt);
        categories.add(category);
      }
    }
  }

  const risk_level = categories.size === 0 ? 'low' : flagged.length > 2 || [...categories].some((c) => /medical|therapy|supplement|income/.test(c)) ? 'high' : 'medium';

  return {
    risk_level,
    flagged_phrases: [...new Set(flagged)].slice(0, 10),
    explanation: categories.size
      ? `Found ${flagged.length} risky phrase(s): ${[...categories].join(', ')}. This kind of language can mislead buyers and may violate ad platform policies.`
      : 'No risky claims detected.',
    safer_alternatives: [...alternatives],
  };
}

module.exports = { safetyCheck, RULES };
