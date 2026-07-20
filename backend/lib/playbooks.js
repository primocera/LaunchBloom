// ---------------------------------------------------------------------------
// v8 LB-S06: first-party channel playbooks. Versioned in code with stable IDs
// — proven workflow STRUCTURE (objective, deliverable plan, brief questions,
// output structures), never generated claims, benchmarks, countdowns or
// outcome promises. Applying one creates a new DRAFT campaign; required facts
// stay empty for the user to verify, and nothing is auto-approved.
// ---------------------------------------------------------------------------

const PLAYBOOKS = [
  {
    id: 'product_launch',
    version: 1,
    label: 'Product launch',
    description: 'Introduce a new product and drive first sales across your core channels.',
    suggested_objective: 'Launch a new product and drive first sales',
    channels: ['email', 'social', 'ads', 'landing'],
    deliverables: {
      landing_page: 'required',
      email_flow: 'required',
      social_set: 'required',
      creative_brief: 'optional',
      seo_ideas: 'optional',
    },
    brief_questions: [
      'What exactly is launching, and what makes it different from what you already sell?',
      'Who is the launch for — your existing audience, a new segment, or both?',
      'What is the launch offer (price, bundle, bonus) and when does it start and end?',
      'What real proof (reviews, results, press) can you use? Leave blank if none yet.',
    ],
  },
  {
    id: 'limited_promo',
    version: 1,
    label: 'Limited-time promotion',
    description: 'A promotion with real dates and terms — urgency comes from your calendar, never invented.',
    suggested_objective: 'Run a limited-time promotion',
    channels: ['email', 'social', 'ads'],
    deliverables: {
      landing_page: 'optional',
      email_flow: 'required',
      social_set: 'required',
      creative_brief: 'optional',
      seo_ideas: 'not_needed',
    },
    brief_questions: [
      'What are the exact promo terms (discount, code, conditions)?',
      'What are the real start and end dates?',
      'Which products are included and excluded?',
    ],
  },
  {
    id: 'waitlist_prelaunch',
    version: 1,
    label: 'Waitlist / prelaunch',
    description: 'Build a list before something exists to buy — value promise without inventing outcomes.',
    suggested_objective: 'Grow a waitlist before launch',
    channels: ['landing', 'social', 'email'],
    deliverables: {
      landing_page: 'required',
      email_flow: 'optional',
      social_set: 'required',
      creative_brief: 'not_needed',
      seo_ideas: 'optional',
    },
    brief_questions: [
      'What do subscribers get for joining the waitlist (early access, discount, content)?',
      'When do you realistically expect to launch? Leave dates empty if unknown.',
      'What can you honestly say about the product today?',
    ],
  },
  {
    id: 'evergreen_refresh',
    version: 1,
    label: 'Evergreen offer refresh',
    description: 'Refresh how your core offer is presented — consistency pass across existing channels.',
    suggested_objective: 'Refresh the core offer presentation across channels',
    channels: ['landing', 'email', 'social'],
    deliverables: {
      landing_page: 'required',
      email_flow: 'optional',
      social_set: 'optional',
      creative_brief: 'not_needed',
      seo_ideas: 'required',
    },
    brief_questions: [
      'What is the core offer and its one key message today?',
      'What changed since you last presented it (price, audience, proof)?',
      'Which existing assets should stay untouched?',
    ],
  },
];

function playbookById(id) {
  return PLAYBOOKS.find((p) => p.id === id) || null;
}

// ── workspace templates: sanitization ───────────────────────────────────────

// Brief fields a user template may carry — facts the OWNER chose to reuse.
// Approval state, statuses, strategy, evidence and dates never transfer.
const TEMPLATE_BRIEF_FIELDS = ['objective', 'audience', 'offer_summary', 'products', 'promo_terms',
  'key_message', 'proof', 'restrictions', 'markets', 'language', 'channels'];

/**
 * Build sanitized template data from a campaign + the user's include list.
 * Excluded or unknown fields are dropped; nothing else ever transfers.
 */
function sanitizeTemplateData(campaign, include, deliverablePlan) {
  const c = campaign || {};
  const chosen = Array.isArray(include) ? include.filter((f) => TEMPLATE_BRIEF_FIELDS.includes(f)) : [];
  const brief = {};
  for (const f of chosen) {
    if (f === 'channels') { if (Array.isArray(c.channels)) brief.channels = c.channels.slice(0, 8); }
    else if (typeof c[f] === 'string' && c[f]) brief[f] = c[f].slice(0, 4000);
  }
  return {
    brief,
    deliverables: (deliverablePlan || []).map((r) => ({
      deliverable_code: r.deliverable_code, requirement_state: r.requirement_state,
    })),
  };
}

module.exports = { PLAYBOOKS, playbookById, TEMPLATE_BRIEF_FIELDS, sanitizeTemplateData };
