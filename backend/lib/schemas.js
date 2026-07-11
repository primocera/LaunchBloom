// ---------------------------------------------------------------------------
// JSON schemas for structured AI outputs. These shapes mirror the Supabase
// jsonb columns (positioning_outputs, offers, launch_kits.*) so a generation
// result can be stored without transformation.
// ---------------------------------------------------------------------------

const positioningSchema = {
  type: 'object',
  properties: {
    possible_niches: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          niche: { type: 'string' },
          why_it_fits: { type: 'string' },
          demand_signal: { type: 'string' },
        },
        required: ['niche', 'why_it_fits', 'demand_signal'],
        additionalProperties: false,
      },
    },
    recommended_niche: {
      type: 'object',
      properties: {
        niche: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['niche', 'reason'],
      additionalProperties: false,
    },
    ideal_customer: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        main_pain: { type: 'string' },
        desired_outcome: { type: 'string' },
        where_they_hang_out: { type: 'string' },
      },
      required: ['description', 'main_pain', 'desired_outcome', 'where_they_hang_out'],
      additionalProperties: false,
    },
    positioning_statement: { type: 'string' },
    desired_transformation: { type: 'string' },
    tagline_options: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    bio_options: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
    elevator_pitch: { type: 'string' },
    content_pillars: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          pillar: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['pillar', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'possible_niches', 'recommended_niche', 'ideal_customer', 'positioning_statement',
    'desired_transformation', 'tagline_options', 'bio_options', 'elevator_pitch', 'content_pillars',
  ],
  additionalProperties: false,
};

const offerItemSchema = {
  type: 'object',
  properties: {
    offer_name: { type: 'string' },
    offer_type: { type: 'string', description: 'e.g. service, coaching, course, digital product, membership' },
    promise: { type: 'string' },
    target_customer: { type: 'string' },
    what_is_included: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
    delivery_format: { type: 'string' },
    price_suggestion: { type: 'string' },
    bonuses: { type: 'array', maxItems: 4, items: { type: 'string' } },
    objections: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
    objection_answers: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
    cta: { type: 'string' },
    why_it_fits: { type: 'string' },
  },
  required: [
    'offer_name', 'offer_type', 'promise', 'target_customer', 'what_is_included',
    'delivery_format', 'price_suggestion', 'bonuses', 'objections', 'objection_answers',
    'cta', 'why_it_fits',
  ],
  additionalProperties: false,
};

const offersSchema = {
  type: 'object',
  properties: {
    offers: { type: 'array', minItems: 3, maxItems: 3, items: offerItemSchema },
  },
  required: ['offers'],
  additionalProperties: false,
};

// ── Launch kit sections ─────────────────────────────────────────────────────

const landingPageSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subheadline: { type: 'string' },
    problem_section: { type: 'string' },
    transformation_section: { type: 'string' },
    offer_stack: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
    bonuses: { type: 'array', maxItems: 4, items: { type: 'string' } },
    testimonial_placeholder_note: { type: 'string' },
    faq: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
    primary_cta: { type: 'string' },
    secondary_cta: { type: 'string' },
  },
  required: [
    'headline', 'subheadline', 'problem_section', 'transformation_section',
    'offer_stack', 'bonuses', 'testimonial_placeholder_note', 'faq', 'primary_cta', 'secondary_cta',
  ],
  additionalProperties: false,
};

const contentPlanSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 30,
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          day_number: { type: 'integer' },
          platform: { type: 'string' },
          content_type: { type: 'string' },
          topic: { type: 'string' },
          hook: { type: 'string' },
          caption_angle: { type: 'string' },
          cta: { type: 'string' },
          goal: { type: 'string' },
        },
        required: ['day_number', 'platform', 'content_type', 'topic', 'hook', 'caption_angle', 'cta', 'goal'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const emailSequenceSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          sequence_order: { type: 'integer' },
          email_type: { type: 'string' },
          subject_line: { type: 'string' },
          preheader: { type: 'string' },
          main_angle: { type: 'string' },
          body_outline: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
          cta: { type: 'string' },
        },
        required: ['sequence_order', 'email_type', 'subject_line', 'preheader', 'main_angle', 'body_outline', 'cta'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const adsKitSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          ad_type: { type: 'string' },
          hook: { type: 'string' },
          primary_text: { type: 'string' },
          headline: { type: 'string' },
          visual_direction: { type: 'string' },
          cta: { type: 'string' },
        },
        required: ['ad_type', 'hook', 'primary_text', 'headline', 'visual_direction', 'cta'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const seoKitSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 5,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          page_type: { type: 'string' },
          title: { type: 'string' },
          meta_description: { type: 'string' },
          content_angle: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['keyword', 'page_type', 'title', 'meta_description', 'content_angle', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const weeklyPlanSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 5,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          task_type: { type: 'string' },
          task_title: { type: 'string' },
          task_description: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['task_type', 'task_title', 'task_description', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const launchSummarySchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    launch_checklist: { type: 'array', minItems: 5, maxItems: 12, items: { type: 'string' } },
  },
  required: ['title', 'summary', 'launch_checklist'],
  additionalProperties: false,
};

// Section name → schema, used by generate-launch-kit and regenerate-section.
const SECTION_SCHEMAS = {
  landing_page: landingPageSchema,
  content_plan: contentPlanSchema,
  email_sequence: emailSequenceSchema,
  ads_kit: adsKitSchema,
  seo_kit: seoKitSchema,
  weekly_plan: weeklyPlanSchema,
};

module.exports = {
  positioningSchema,
  offersSchema,
  landingPageSchema,
  contentPlanSchema,
  emailSequenceSchema,
  adsKitSchema,
  seoKitSchema,
  weeklyPlanSchema,
  launchSummarySchema,
  SECTION_SCHEMAS,
};
