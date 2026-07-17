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

// Sections per Prompt 18's Landing Page Studio: hero headline/subheadline,
// primary CTA, problem, solution, benefits, what's included, who it's for,
// who it's not for, how it works, pricing section, FAQ, final CTA.
const landingPageSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subheadline: { type: 'string' },
    primary_cta: { type: 'string' },
    problem_section: { type: 'string' },
    solution_section: { type: 'string' },
    benefits: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    whats_included: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
    who_its_for: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
    who_its_not_for: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
    how_it_works: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    pricing_section: { type: 'string' },
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
    final_cta_section: { type: 'string' },
    testimonial_placeholder_note: { type: 'string' },
  },
  required: [
    'headline', 'subheadline', 'primary_cta', 'problem_section', 'solution_section',
    'benefits', 'whats_included', 'who_its_for', 'who_its_not_for', 'how_it_works',
    'pricing_section', 'faq', 'final_cta_section', 'testimonial_placeholder_note',
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

// Ad types map to Prompt 21's studio sections: hooks, static concepts,
// video concepts, UGC brief.
const adsKitSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 4,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          ad_type: { type: 'string', enum: ['hook', 'static', 'video', 'ugc'] },
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

// ═══════════════════════════════════════════════════════════════════════════
// Upgrade Prompt 6: dedicated schemas for the new marketing studios. These are
// used by the /api/ai/generate-* asset routes (routes/assets.js), not by the
// launch-kit generator, so they are exported separately (NOT in SECTION_SCHEMAS)
// and mirror the 004_marketing_assets tables 1:1.
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_TYPES = ['home', 'product', 'collection', 'cart', 'about', 'faq', 'thank_you', 'contact', 'landing'];

// Website Studio → website_pages
const websiteKitSchema = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      minItems: 4,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          page_type: { type: 'string', enum: PAGE_TYPES },
          page_goal: { type: 'string' },
          seo_title: { type: 'string' },
          meta_description: { type: 'string', description: 'Preferably under 160 characters.' },
          h1: { type: 'string' },
          hero_headline: { type: 'string' },
          hero_subheadline: { type: 'string' },
          // P8: three hero directions to choose from before committing to one.
          hero_directions: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                approach: { type: 'string', enum: ['direct_response', 'brand_led', 'problem_aware'] },
                headline: { type: 'string' },
                subheadline: { type: 'string' },
              },
              required: ['approach', 'headline', 'subheadline'],
              additionalProperties: false,
            },
          },
          primary_cta: { type: 'string' },
          secondary_cta: { type: 'string', description: 'Only when a second action is genuinely useful, else empty string.' },
          sections: {
            type: 'array',
            minItems: 2,
            maxItems: 10,
            items: {
              type: 'object',
              properties: {
                section_name: { type: 'string' },
                headline: { type: 'string' },
                body: { type: 'string' },
                bullets: { type: 'array', maxItems: 8, items: { type: 'string' } },
                cta: { type: 'string' },
              },
              required: ['section_name', 'headline', 'body', 'bullets', 'cta'],
              additionalProperties: false,
            },
          },
          trust_elements: { type: 'array', maxItems: 8, items: { type: 'string' } },
          faq: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: { question: { type: 'string' }, answer: { type: 'string' } },
              required: ['question', 'answer'],
              additionalProperties: false,
            },
          },
          design_notes: { type: 'string' },
        },
        required: [
          'page_type', 'page_goal', 'seo_title', 'meta_description', 'h1', 'hero_headline',
          'hero_subheadline', 'hero_directions', 'primary_cta', 'secondary_cta', 'sections',
          'trust_elements', 'faq', 'design_notes',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['pages'],
  additionalProperties: false,
};

// Email Flow Studio → email_assets
const emailFlowSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          flow_type: {
            type: 'string',
            enum: ['welcome', 'abandon_cart', 'browse_abandon', 'post_purchase', 'review_request', 'winback', 'campaign', 'launch', 'last_chance'],
          },
          email_order: { type: 'integer' },
          objective: { type: 'string', description: 'This email\'s single purpose (from the provided blueprint).' },
          subject_line: { type: 'string', description: 'Under 50 characters where the language allows.' },
          preheader: { type: 'string', description: 'Under 90 characters; complements the subject, never repeats it.' },
          headline: { type: 'string' },
          body_copy: { type: 'string', description: 'Scannable: short paragraphs / bullets, one idea per block.' },
          cta: { type: 'string', description: 'One specific primary CTA.' },
          secondary_cta: { type: 'string', description: 'Optional secondary CTA; empty string if none.' },
          personalization_tokens: { type: 'array', items: { type: 'string' }, description: 'e.g. {{first_name}}, {{product_name}}.' },
          send_timing: { type: 'string' },
          segment: { type: 'string' },
          exclusions: { type: 'string', description: 'Who to exclude (e.g. already purchased); empty string if none.' },
          design_notes: { type: 'string' },
        },
        required: [
          'flow_type', 'email_order', 'objective', 'subject_line', 'preheader', 'headline',
          'body_copy', 'cta', 'secondary_cta', 'personalization_tokens', 'send_timing',
          'segment', 'exclusions', 'design_notes',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// Social Caption Studio → social_assets
const socialCaptionSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 10,
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['instagram', 'tiktok', 'linkedin', 'pinterest', 'facebook'] },
          content_type: { type: 'string', enum: ['caption', 'carousel', 'reel', 'story', 'short_video'] },
          hook: { type: 'string' },
          caption: { type: 'string' },
          cta: { type: 'string' },
          visual_direction: { type: 'string' },
          hashtags: { type: 'array', maxItems: 12, items: { type: 'string' } },
          goal: { type: 'string' },
        },
        required: ['platform', 'content_type', 'hook', 'caption', 'cta', 'visual_direction', 'hashtags', 'goal'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// Ads & Creative Studio → creative_assets
const creativeIdeasSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 8,
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['meta', 'tiktok', 'google', 'pinterest'] },
          creative_type: { type: 'string', enum: ['static', 'video', 'ugc', 'carousel', 'search_ad'] },
          hook: { type: 'string' },
          headline: { type: 'string' },
          primary_text: { type: 'string' },
          visual_direction: { type: 'string' },
          shot_list: { type: 'array', maxItems: 12, items: { type: 'string' } },
          text_overlays: { type: 'array', maxItems: 12, items: { type: 'string' } },
          cta: { type: 'string' },
          testing_angle: { type: 'string' },
        },
        required: [
          'platform', 'creative_type', 'hook', 'headline', 'primary_text',
          'visual_direction', 'shot_list', 'text_overlays', 'cta', 'testing_angle',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// Campaign Email Generator → email_assets (flow_type='campaign')
const campaignEmailSchema = {
  type: 'object',
  properties: {
    campaign_theme: { type: 'string' },
    campaign_goal: { type: 'string' },
    items: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          email_type: {
            type: 'string',
            enum: ['teaser', 'educational', 'product_focus', 'social_proof', 'offer', 'last_chance', 'reminder', 'newsletter'],
          },
          send_day: { type: 'string' },
          subject_line: { type: 'string' },
          preheader: { type: 'string' },
          body_copy: { type: 'string' },
          cta: { type: 'string' },
          design_notes: { type: 'string' },
        },
        required: ['email_type', 'send_day', 'subject_line', 'preheader', 'body_copy', 'cta', 'design_notes'],
        additionalProperties: false,
      },
    },
  },
  required: ['campaign_theme', 'campaign_goal', 'items'],
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
  // Upgrade Prompt 6 — dedicated studio schemas
  websiteKitSchema,
  emailFlowSchema,
  socialCaptionSchema,
  creativeIdeasSchema,
  campaignEmailSchema,
};
