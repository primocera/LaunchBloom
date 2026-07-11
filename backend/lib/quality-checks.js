// ---------------------------------------------------------------------------
// Prompt 27: quality checks for generated outputs. Pure functions, each
// returning { score 0-100, passed, issues: [], suggestions: [] }. The checks
// mirror the spec's question lists; scoring is proportional to checks passed
// with passed = score >= 70.
// ---------------------------------------------------------------------------

const GENERIC_PHRASES = /unlock|unleash|skyrocket|next level|game.?chang|10x|revolutionar|take .* to the next/i;

function result(checks) {
  const failed = checks.filter((c) => !c.ok);
  const score = Math.round(((checks.length - failed.length) / checks.length) * 100);
  return {
    score,
    passed: score >= 70,
    issues: failed.map((c) => c.issue),
    suggestions: failed.map((c) => c.fix),
  };
}

const has = (s, min = 10) => typeof s === 'string' && s.trim().length >= min;
const list = (a, min = 1) => Array.isArray(a) && a.length >= min;

/** Offer quality per the spec's six questions. */
function scoreOfferQuality(offer = {}) {
  return result([
    {
      ok: has(offer.target_customer, 15) && !/everyone|anybody|all people/i.test(offer.target_customer || ''),
      issue: 'The audience is not specific.',
      fix: 'Name who this is for precisely: role, situation, and the problem they bring.',
    },
    {
      ok: has(offer.promise, 15),
      issue: 'The problem/promise is not clear.',
      fix: 'State the one problem this offer solves and the outcome, in one sentence.',
    },
    {
      ok: has(offer.promise) && !/guarantee|10x|overnight|effortless/i.test(offer.promise || ''),
      issue: 'The promised result may not be believable.',
      fix: 'Promise a concrete, modest outcome the delivery format can actually produce.',
    },
    {
      ok: has(offer.delivery_format, 5),
      issue: 'The delivery format is missing or vague.',
      fix: 'Say exactly how it is delivered: calls, videos, templates, days of access.',
    },
    {
      ok: has(offer.price_suggestion, 2),
      issue: 'The price range is missing.',
      fix: 'Give a realistic price range for this format and audience.',
    },
    {
      ok: list(offer.objections, 2) && list(offer.objection_answers, 2),
      issue: 'Objections are not addressed.',
      fix: 'List the 2-3 doubts a buyer will have and answer each one.',
    },
  ]);
}

/** Landing page quality per the spec's six questions. */
function scoreLandingPageQuality(lp = {}) {
  return result([
    {
      ok: has(lp.headline, 10) && !GENERIC_PHRASES.test(lp.headline || ''),
      issue: 'The headline is not clear.',
      fix: 'Lead with the outcome for a named audience, without hype words.',
    },
    {
      ok: has(lp.subheadline, 15),
      issue: 'The offer is not understandable above the fold.',
      fix: 'The subheadline should say what it is, who it is for, and what they get.',
    },
    {
      ok: list(lp.benefits, 3),
      issue: 'Benefits are not concrete.',
      fix: 'List at least three specific benefits tied to the offer.',
    },
    {
      ok: has(lp.primary_cta, 3),
      issue: 'The CTA is not clear.',
      fix: 'One short action phrase, repeated at the end of the page.',
    },
    {
      ok: list(lp.faq, 3),
      issue: 'FAQs are missing.',
      fix: 'Add at least three FAQs covering price, time and fit.',
    },
    {
      ok: list(lp.faq, 1) && lp.faq.some((f) => /price|cost|time|refund|work for me|beginner/i.test(`${f.question}`)),
      issue: 'Objections are not answered.',
      fix: 'Make FAQs answer real buying objections (price, time, "will this work for me").',
    },
  ]);
}

/** Content plan quality per the spec's four questions. */
function scoreContentPlanQuality(plan = {}, offer = {}) {
  const items = Array.isArray(plan.items) ? plan.items : [];
  const offerWords = `${offer.offer_name || ''} ${offer.promise || ''}`.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  const tiedToOffer = items.filter((i) =>
    offerWords.some((w) => `${i.topic} ${i.hook} ${i.cta} ${i.goal}`.toLowerCase().includes(w))
  );
  const kinds = ['educat', 'proof|result|story', 'objection|myth|doubt', 'offer|sale|launch'];
  const mixHit = kinds.filter((k) => items.some((i) => new RegExp(k, 'i').test(`${i.goal} ${i.content_type}`)));
  return result([
    {
      ok: items.length > 0 && tiedToOffer.length >= Math.min(3, items.length / 3),
      issue: 'Posts do not clearly support the offer.',
      fix: 'Tie hooks and CTAs back to the offer by name or promise.',
    },
    {
      ok: mixHit.length >= 3,
      issue: 'Missing mix of education, proof, objection handling and sales.',
      fix: 'Balance the plan across education, proof, objections and direct offer posts.',
    },
    {
      ok: items.length > 0 && items.every((i) => has(i.cta, 3)),
      issue: 'CTAs are not clear on every post.',
      fix: 'Every post needs one specific next step.',
    },
    {
      ok: items.length <= 31,
      issue: 'The plan may be unrealistic for a solo founder.',
      fix: 'Keep it to one post per day at most.',
    },
  ]);
}

/** Email sequence quality per the spec's four questions. */
function scoreEmailSequenceQuality(seq = {}, offer = {}) {
  const items = Array.isArray(seq.items) ? seq.items : [];
  const sorted = [...items].sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
  const firstSell = sorted.findIndex((i) => /offer|sale|buy|price|reveal/i.test(`${i.email_type} ${i.main_angle}`));
  return result([
    {
      ok: firstSell === -1 || firstSell >= 2,
      issue: 'The sequence sells before building trust.',
      fix: 'Spend the first two emails on story and the problem before introducing the offer.',
    },
    {
      ok: items.some((i) => /offer|reveal|introduc/i.test(`${i.email_type} ${i.main_angle}`)),
      issue: 'The offer is never introduced clearly.',
      fix: 'One email should plainly present the offer: what, for whom, price, CTA.',
    },
    {
      ok: items.length > 0 && items.every((i) => has(i.cta, 3)),
      issue: 'CTAs are missing on some emails.',
      fix: 'Every email ends with exactly one clear action.',
    },
    {
      ok: !items.some((i) => /act now|last chance|only \d+ left|expires tonight|don.t miss/i.test(`${i.subject_line} ${i.preheader}`)),
      issue: 'Subject lines lean on spammy urgency.',
      fix: 'Replace fake urgency with specificity; honest deadlines only if real.',
    },
  ]);
}

module.exports = {
  scoreOfferQuality,
  scoreLandingPageQuality,
  scoreContentPlanQuality,
  scoreEmailSequenceQuality,
};
