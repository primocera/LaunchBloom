// ---------------------------------------------------------------------------
// v5 Prompt 12 — SEO provider adapter interface.
//
// Scalvya generates SEO content *ideas*, not researched keyword data. Until
// a real keyword/SERP data provider is integrated, everything is "Not
// researched": we never fabricate search volume, difficulty, CPC or rankings.
//
// This module defines the adapter contract so a future vendor (e.g. a keyword
// API) can be dropped in without coupling the UI or routes to one vendor:
//
//   provider.name                       -> string
//   provider.researched                 -> boolean
//   await provider.lookup(keywords[])    -> [{ keyword, metrics|null, source, retrieved_at }]
//
// Metrics MUST always carry a `source` and `retrieved_at`; a provider that
// cannot supply both must return metrics: null.
// ---------------------------------------------------------------------------

/** The default provider: honest, no data. Returns null metrics for everything. */
const notResearchedProvider = {
  name: 'not_researched',
  researched: false,
  async lookup(keywords = []) {
    return (keywords || []).map((keyword) => ({
      keyword,
      metrics: null, // never fabricated
      source: null,
      retrieved_at: null,
    }));
  },
};

/**
 * Resolve the active provider from env. No vendor is wired yet, so this always
 * returns the not-researched provider — but the seam exists for the future.
 */
function getSeoProvider() {
  // e.g. if (process.env.SEO_PROVIDER === 'acme' && process.env.ACME_API_KEY) return acmeProvider;
  return notResearchedProvider;
}

/** Steps a user can take to turn an idea into a researched keyword. */
function researchChecklist() {
  return [
    'Search the primary keyword in Google and read the top 10 results — match the dominant intent.',
    'Check Google autocomplete and "People also ask" for real related phrases.',
    'Use a keyword tool (e.g. Search Console, a keyword API) for volume and difficulty — record the source and date.',
    'Confirm you can create genuinely better/differentiated content than what ranks now.',
    'Check the target page does not compete with an existing page for the same keyword (cannibalization).',
  ];
}

/**
 * Validate that no SEO item claims a numeric metric without a source and
 * retrieval date. Returns an array of human-readable violations (empty = ok).
 * Used to reject fabricated metrics before anything is surfaced as "researched".
 */
const METRIC_WORDS = /(search volume|monthly searches|keyword difficulty|difficulty score|\bKD\b|\bCPC\b|cost per click|competition score|\bMSV\b)/i;

function rejectFabricatedMetrics(items = []) {
  const violations = [];
  (items || []).forEach((it, i) => {
    const label = `idea ${i + 1}`;
    const blob = `${it.keyword || ''} ${it.content_angle || ''} ${it.title || ''} ${it.meta_description || ''}`;
    // A metric term next to a number, without a source+retrieved_at, is fabricated.
    if (METRIC_WORDS.test(blob) && /\d/.test(blob)) {
      const hasSource = it.metrics && it.metrics.source && it.metrics.retrieved_at;
      if (!hasSource) violations.push(`${label}: states an SEO metric without a source and retrieval date.`);
    }
    if (/\bwill rank\b|guaranteed to rank|can actually rank/i.test(blob)) {
      violations.push(`${label}: promises rankings — SEO ideas cannot guarantee ranking.`);
    }
  });
  return violations;
}

/**
 * Detect keyword cannibalization: two ideas targeting the same primary keyword
 * (or the same keyword + page type). Returns groups of colliding ideas.
 */
function findKeywordCannibalization(items = []) {
  const byKey = new Map();
  (items || []).forEach((it) => {
    const key = String(it.keyword || '').trim().toLowerCase();
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(it);
  });
  const collisions = [];
  for (const [keyword, group] of byKey.entries()) {
    if (group.length > 1) collisions.push({ keyword, count: group.length });
  }
  return collisions;
}

module.exports = {
  notResearchedProvider,
  getSeoProvider,
  researchChecklist,
  rejectFabricatedMetrics,
  findKeywordCannibalization,
};
