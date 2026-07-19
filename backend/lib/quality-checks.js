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

// ═══════════════════════════════════════════════════════════════════════════
// Upgrade Prompt 19: non-blocking quality warnings for the new marketing
// studios. Each returns a flat array of human-readable warning strings so the
// route can attach them as `quality_warnings` without ever failing generation.
// ═══════════════════════════════════════════════════════════════════════════

const GUARANTEE = /guarantee|money.?back|testimonial|\d+\s*(?:star|reviews?)|proven to|clinically/i;
const FAKE_SCARCITY = /only \d+ left|act now|expires (?:tonight|today)|last chance|ends in \d|selling fast/i;
const UNREALISTIC = /guarantee|overnight|get rich|passive income|instant results|100%|effortless/i;
const blob = (o) => JSON.stringify(o || {}).toLowerCase();

// ── v6 Prompt 21: per-claim provenance + unresolved-fact placeholders ───────

// Claims that must be backed by user-supplied proof: numbers/percentages tied
// to results, review/customer counts, superlative results, certifications.
const RISKY_CLAIM = /\b\d+(?:[.,]\d+)?\s*%|\b\d[\d,]*\+?\s*(?:customers|clients|reviews|users|sales|sold)\b|award.?winning|certified|clinically|best.?selling|#1\b|\bproven\b/gi;

/**
 * Risky claims found in the generated pages that do not appear in the proof
 * the user actually supplied. Deterministic — the label is what the reviewer
 * must verify or delete.
 */
function claimProvenanceWarnings(pages = [], proofText = '') {
  const proof = String(proofText || '').toLowerCase();
  const w = [];
  pages.forEach((p, i) => {
    const label = p.page_type || `page ${i + 1}`;
    const found = blob(p).match(RISKY_CLAIM) || [];
    for (const claim of new Set(found.map((c) => c.trim().toLowerCase()))) {
      if (!proof.includes(claim)) {
        w.push(`${label}: claim "${claim}" is not in your supplied proof — verify the source or remove it before publishing.`);
      }
    }
  });
  return w;
}

/** Count `[bracketed placeholder]` unresolved facts left in a page. */
function unresolvedPlaceholderCount(page = {}) {
  return (JSON.stringify(page).match(/\[[A-Za-z][^\]\n]{2,80}\]/g) || []).length;
}

/** Website pages: H1, CTA, meta description length, ≥3 benefits, no invented proof. */
function checkWebsitePages(pages = [], { proof = '' } = {}) {
  const w = [];
  pages.forEach((p, i) => {
    const label = p.page_type || `page ${i + 1}`;
    if (!has(p.h1, 1)) w.push(`${label}: missing H1.`);
    if (!has(p.page_goal, 3)) w.push(`${label}: no clear conversion goal.`);
    if (!has(p.primary_cta, 1)) w.push(`${label}: missing primary CTA.`);
    if (!has(p.seo_title, 1)) w.push(`${label}: missing SEO title.`);
    else if (p.seo_title.length > 60) w.push(`${label}: SEO title is over 60 characters.`);
    if (!has(p.meta_description, 1)) w.push(`${label}: missing meta description.`);
    else if (p.meta_description.length < 50) w.push(`${label}: meta description is under 50 characters.`);
    else if (p.meta_description.length > 160) w.push(`${label}: meta description is over 160 characters.`);
    const bullets = (p.sections || []).reduce((n, s) => n + ((s.bullets || []).length), 0);
    if (bullets < 3) w.push(`${label}: fewer than 3 benefit bullets.`);
    if (GUARANTEE.test(blob(p))) w.push(`${label}: may contain invented testimonials or guarantees — verify before publishing.`);
    const placeholders = unresolvedPlaceholderCount(p);
    if (placeholders > 0) w.push(`${label}: ${placeholders} unresolved fact placeholder(s) in brackets — fill in the real details before publishing.`);
  });
  w.push(...claimProvenanceWarnings(pages, proof));
  return w;
}

/** Emails: subject ≤70 chars, preheader ≠ subject, CTA + body present, honest urgency. */
function checkEmails(items = [], { hasDeadline = false, timezone = null } = {}) {
  const w = [];
  // v6 Prompt 22: a real deadline without a timezone is operationally ambiguous.
  if (hasDeadline && !timezone) {
    w.push('The campaign has an end date but no timezone — set one so send times and the deadline are unambiguous.');
  }
  items.forEach((e, i) => {
    const label = `email ${e.email_order || i + 1}`;
    if (!has(e.subject_line, 1)) w.push(`${label}: missing subject line.`);
    else if (e.subject_line.length > 70) w.push(`${label}: subject line is over 70 characters.`);
    if (!has(e.preheader, 1)) w.push(`${label}: missing preheader.`);
    else if (e.subject_line && e.preheader.trim().toLowerCase() === e.subject_line.trim().toLowerCase()) {
      w.push(`${label}: preheader is identical to the subject line.`);
    }
    if (!has(e.cta, 2)) w.push(`${label}: missing CTA.`);
    if (!has(e.body_copy, 1)) w.push(`${label}: body copy is empty.`);
    if (!hasDeadline && FAKE_SCARCITY.test(`${e.subject_line} ${e.preheader} ${e.body_copy}`)) {
      w.push(`${label}: uses urgency without a real deadline.`);
    }
  });
  return w;
}

// ── v6 Prompt 23: distinct angles + realistic publishing density ────────────

const tokens = (s) => new Set(String(s || '').toLowerCase().split(/\W+/).filter((t) => t.length > 3));

/** Pairs of items whose hooks are near-duplicates (token overlap ≥ 60%). */
function repeatedHookWarnings(items = []) {
  const w = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = tokens(items[i].hook);
      const b = tokens(items[j].hook);
      if (a.size < 3 || b.size < 3) continue;
      const shared = [...a].filter((t) => b.has(t)).length;
      if (shared / Math.min(a.size, b.size) >= 0.6) {
        w.push(`items ${i + 1} and ${j + 1} share nearly the same hook — give each a distinct angle, not a rephrase.`);
      }
    }
  }
  return w;
}

/** Social: hook, CTA, non-generic caption, visual direction. */
function checkSocial(items = []) {
  const w = [];
  items.forEach((s, i) => {
    const label = `caption ${i + 1}`;
    if (!has(s.hook, 3)) w.push(`${label}: missing hook.`);
    if (!has(s.cta, 2)) w.push(`${label}: missing CTA.`);
    if (!has(s.caption, 15) || GENERIC_PHRASES.test(s.caption || '')) w.push(`${label}: caption looks generic.`);
    if (!has(s.visual_direction, 5)) w.push(`${label}: missing visual direction.`);
  });
  w.push(...repeatedHookWarnings(items));
  // Role/pillar mix: a campaign set that is all one pillar is not a system.
  const pillars = new Set(items.map((s) => s.pillar).filter(Boolean));
  if (items.length >= 5 && pillars.size === 1) {
    w.push(`all ${items.length} items serve the "${[...pillars][0]}" pillar — balance the set across education, proof, objections, community and sales.`);
  }
  if (items.length > 21) {
    w.push(`${items.length} items is more than one post per day for three weeks — an unrealistic publishing density for a solo founder. Plan the strongest ones first.`);
  }
  return w;
}

// Search-ad platform character limits (Google-style): headline ≤30, description ≤90.
const SEARCH_HEADLINE_MAX = 30;
const SEARCH_DESC_MAX = 90;

/** Search-ad character-limit warnings for one creative. */
function searchAdCharWarnings(c = {}, label = 'search ad') {
  const w = [];
  const sa = c.search_ad || {};
  (sa.headlines || []).forEach((h, i) => {
    if (typeof h === 'string' && h.length > SEARCH_HEADLINE_MAX) w.push(`${label}: headline ${i + 1} is ${h.length} chars (max ${SEARCH_HEADLINE_MAX}).`);
  });
  (sa.descriptions || []).forEach((d, i) => {
    if (typeof d === 'string' && d.length > SEARCH_DESC_MAX) w.push(`${label}: description ${i + 1} is ${d.length} chars (max ${SEARCH_DESC_MAX}).`);
  });
  return w;
}

/** High-risk claims in a creative that need proof/acknowledgement before "ready". */
function creativeComplianceFlags(c = {}) {
  const flags = Array.isArray(c.compliance_flags) ? [...c.compliance_flags] : [];
  const text = `${c.hook || ''} ${c.headline || ''} ${c.primary_text || ''}`;
  if (GUARANTEE.test(text)) flags.push('Mentions a guarantee, testimonial or review — needs real proof.');
  if (FAKE_SCARCITY.test(text)) flags.push('Uses urgency/scarcity — must reflect a real deadline or stock level.');
  if (UNREALISTIC.test(text)) flags.push('Contains a strong/unrealistic claim — verify before running.');
  return [...new Set(flags)];
}

/**
 * Whether a creative may move to "ready"/"published". Blocked when it has
 * compliance flags without a recorded proof source (v6 Prompt 24: a checkbox
 * acknowledgement alone cannot legalize an unsupported claim — the user must
 * say where the proof lives). Returns { ok, reason }.
 */
function creativeReadyGate(row = {}) {
  const flags = creativeComplianceFlags(row);
  if (flags.length === 0) return { ok: true };
  const ack = row.compliance_ack || {};
  if (ack.acknowledged && typeof ack.proof_source === 'string' && ack.proof_source.trim().length >= 5) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: ack.acknowledged
      ? 'Attach the proof source (link or where the evidence lives) — acknowledgement alone cannot approve a high-risk claim.'
      : 'This creative has high-risk claims. Record the real proof source before marking it ready.',
  };
}

/** True when concepts are genuinely distinct (differ by angle/mechanism). */
function conceptsDistinct(items = []) {
  const angles = items.map((c) => String(c.angle || c.testing_angle || '').trim().toLowerCase()).filter(Boolean);
  if (angles.length < 2) return true;
  return new Set(angles).size === angles.length;
}

/** Ads: hook, visual direction, CTA, distinctness, timed video, search limits, compliance. */
function checkCreative(items = []) {
  const w = [];
  items.forEach((c, i) => {
    const label = `${c.creative_type || 'creative'} ${i + 1}`;
    if (!has(c.hook, 3)) w.push(`${label}: missing hook.`);
    if (!has(c.visual_direction, 5)) w.push(`${label}: missing visual direction.`);
    if (!has(c.cta, 2)) w.push(`${label}: missing CTA.`);
    if (UNREALISTIC.test(`${c.hook} ${c.headline} ${c.primary_text}`)) w.push(`${label}: may contain an unrealistic claim — verify before "ready".`);
    if ((c.creative_type === 'video' || c.creative_type === 'ugc')) {
      const tl = c.video_timeline || {};
      if (!list(tl.scenes, 1)) w.push(`${label}: video idea has no scene-by-scene timeline.`);
      if (!tl.duration_seconds) w.push(`${label}: video idea has no duration.`);
    }
    if (c.creative_type === 'search_ad') w.push(...searchAdCharWarnings(c, label));
    if (creativeComplianceFlags(c).length && !(c.compliance_ack && c.compliance_ack.acknowledged)) {
      w.push(`${label}: has compliance flags — record the proof source before marking ready.`);
    }
  });
  if (!conceptsDistinct(items)) w.push('Some concepts share the same angle — make each test a distinct mechanism, not a headline variant.');
  return w;
}

/** SEO: keyword, title, meta description present. */
function checkSeo(items = []) {
  const w = [];
  items.forEach((s, i) => {
    const label = `keyword ${i + 1}`;
    if (!has(s.keyword, 2)) w.push(`${label}: missing keyword.`);
    if (!has(s.seo_title || s.title, 3)) w.push(`${label}: missing title.`);
    if (!has(s.meta_description, 3)) w.push(`${label}: missing meta description.`);
  });
  return w;
}

/** Dispatcher used by the asset routes; always returns an array (never throws). */
function qualityWarnings(kind, result = {}, opts = {}) {
  try {
    switch (kind) {
      case 'website': return checkWebsitePages(result.pages || [], opts);
      case 'email': return checkEmails(result.items || [], opts);
      case 'social': return checkSocial(result.items || []);
      case 'creative': return checkCreative(result.items || []);
      case 'seo': return checkSeo(result.items || []);
      default: return [];
    }
  } catch {
    return [];
  }
}

module.exports = {
  scoreOfferQuality,
  scoreLandingPageQuality,
  scoreContentPlanQuality,
  scoreEmailSequenceQuality,
  checkWebsitePages,
  checkEmails,
  checkSocial,
  checkCreative,
  checkSeo,
  qualityWarnings,
  // Prompt 11 — creative-specific helpers
  searchAdCharWarnings,
  creativeComplianceFlags,
  creativeReadyGate,
  conceptsDistinct,
  // v6 Prompts 21/23 — provenance + distinctness helpers
  claimProvenanceWarnings,
  unresolvedPlaceholderCount,
  repeatedHookWarnings,
};
