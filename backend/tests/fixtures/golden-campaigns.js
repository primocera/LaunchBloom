// ---------------------------------------------------------------------------
// v10 SC-03 — the golden campaign corpus.
//
// Versioned, synthetic campaigns used to hold output quality to a measurable
// standard. Two jobs, equally important:
//
//   1. Known-bad fixtures prove the deterministic gate CATCHES a defect.
//   2. Known-clean fixtures prove it does not INVENT one. A checker that flags
//      healthy campaigns is worse than no checker — people learn to ignore it.
//
// Every fixture is hand-written. Nothing here comes from a live model, so this
// corpus costs nothing to run and is fully deterministic in CI. It evaluates
// the GATE, not the model; measuring generation quality itself needs the
// credential-gated live harness described in docs/GOLDEN_EVAL_V10.md.
//
// Bump CORPUS_VERSION whenever a fixture's expectations change, so a shifting
// baseline can never be mistaken for an improvement.
// ---------------------------------------------------------------------------

const CORPUS_VERSION = 'v10.1';

// Claims no fixture may contain. These are the inventions the product promises
// never to make; if one appears in a fixture, the fixture itself is the bug.
const PROHIBITED_INVENTIONS = [
  /guaranteed (?:results|income)/i,
  /will rank #?1/i,
  /\bclinically proven\b/i,
  /passive income guaranteed/i,
  /\b10x your\b/i,
  /risk[- ]free forever/i,
];

const FIXTURES = [
  // ── Clean baselines: the false-positive guard ────────────────────────────
  {
    id: 'services_clean',
    sector: 'services',
    why: 'A complete, consistent services campaign must produce no findings.',
    campaign: {
      offer_summary: 'Six-week bookkeeping setup for new limited companies',
      audience: 'First-year UK limited company directors',
      key_message: 'Get your books compliant before your first year end',
      cta: 'Book a setup call',
      proof: 'Three named client references, supplied by the owner',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Bookkeeping setup for new companies', seo_title: 'Bookkeeping setup for new limited companies',
        meta_description: 'A six-week setup so your books are compliant before your first year end.',
        cta: 'Book a setup call',
      }],
      email_assets: [{
        id: 'e1', subject_line: 'Your first year end is closer than you think',
        preheader: 'A six-week setup to get compliant', headline: 'Compliant books before year end',
        body_copy: 'Most first-year directors leave bookkeeping until the deadline. A six-week setup avoids that.',
        cta: 'Book a setup call',
      }],
      social_assets: [{
        id: 's1', hook: 'Your first year end is closer than you think',
        caption: 'Six weeks is enough to get a new company compliant.', cta: 'Book a setup call',
      }],
    },
    expect: [],
  },
  {
    id: 'ecommerce_clean',
    sector: 'ecommerce',
    why: 'A promo campaign whose discount matches the brief everywhere is clean.',
    campaign: {
      offer_summary: 'Winter candle bundle',
      audience: 'Existing customers who bought in the last year',
      key_message: 'Three scents, one bundle price',
      cta: 'Shop the bundle',
      promo_terms: '20% off with code WINTER20',
      proof: 'Owner-supplied repeat-purchase records',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Winter candle bundle', seo_title: 'Winter candle bundle — 20% off',
        meta_description: 'Three winter scents in one bundle, 20% off with code WINTER20.', cta: 'Shop the bundle',
      }],
      email_assets: [{
        id: 'e1', subject_line: 'Your winter bundle is here', preheader: '20% off with code WINTER20',
        headline: 'Three scents, one bundle price', body_copy: 'Take 20% off the winter bundle with code WINTER20.',
        cta: 'Shop the bundle',
      }],
    },
    expect: [],
  },
  {
    id: 'events_clean',
    sector: 'events',
    why: 'Dates inside the campaign window must not be flagged.',
    campaign: {
      offer_summary: 'One-day ceramics workshop',
      audience: 'Beginners who have never thrown clay',
      key_message: 'Leave with two pieces you made yourself',
      cta: 'Reserve a seat',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      proof: 'Studio photos from previous workshops',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Beginner ceramics workshop', seo_title: 'One-day beginner ceramics workshop',
        meta_description: 'A one-day workshop on 2026-09-12. Leave with two finished pieces.', cta: 'Reserve a seat',
      }],
    },
    expect: [],
  },
  {
    id: 'no_dates_clean',
    sector: 'services',
    why: 'A campaign with no dates is legitimate — absence of dates is not a defect.',
    campaign: {
      offer_summary: 'Ongoing SEO retainer',
      audience: 'Independent hotels',
      key_message: 'Steady organic growth, reviewed monthly',
      cta: 'Request a proposal',
      proof: 'Owner-supplied case notes',
    },
    assets: {
      social_assets: [{
        id: 's1', hook: 'Organic growth is a habit, not a campaign',
        caption: 'A monthly review beats a one-off audit.', cta: 'Request a proposal',
      }],
    },
    expect: [],
  },

  // ── Known-bad: each isolates one defect ─────────────────────────────────
  {
    id: 'regulated_claims_unsupported',
    sector: 'regulated',
    why: 'Proof-shaped placeholders with no proof in the brief are an unsupported claim.',
    campaign: {
      offer_summary: 'Posture coaching programme',
      audience: 'Desk workers with recurring back pain',
      key_message: 'Move better in eight weeks',
      cta: 'Start the programme',
      // No proof field — that is the point.
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Posture coaching', seo_title: 'Posture coaching programme',
        meta_description: 'Backed by [client results] from our first cohort.', cta: 'Start the programme',
      }],
    },
    expect: ['unsupported_claim_reference'],
  },
  {
    id: 'missing_proof_marker',
    sector: 'services',
    why: 'A testimonial placeholder must be caught before it ships as real proof.',
    campaign: {
      offer_summary: 'Brand photography day',
      audience: 'Solo consultants refreshing their website',
      key_message: 'A full library of images in one day',
      cta: 'Check availability',
    },
    assets: {
      email_assets: [{
        id: 'e1', subject_line: 'A full image library in one day',
        preheader: 'One shoot, a year of content', headline: 'One day, a year of images',
        body_copy: 'Here is what people say: [testimonial]', cta: 'Check availability',
      }],
    },
    expect: ['unsupported_claim_reference'],
  },
  {
    id: 'unresolved_placeholder_left',
    sector: 'ecommerce',
    why: 'A bracketed placeholder would ship to customers verbatim.',
    campaign: {
      offer_summary: 'Refillable cleaning starter kit',
      audience: 'Households cutting single-use plastic',
      key_message: 'Buy the bottle once',
      cta: 'Order the kit',
      proof: 'Owner-supplied refill weight data',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Refillable starter kit', seo_title: 'Refillable cleaning starter kit',
        meta_description: 'Buy the bottle once and refill it [FREQUENCY].', cta: 'Order the kit',
      }],
    },
    expect: ['unresolved_placeholder'],
  },
  {
    id: 'promo_term_drift',
    sector: 'ecommerce',
    why: 'A discount that differs from the brief is a promise the owner may not honour.',
    campaign: {
      offer_summary: 'Spring plant sale',
      audience: 'Previous customers',
      key_message: 'Refresh your windowsill',
      cta: 'Shop the sale',
      promo_terms: '15% off with code SPRING15',
      proof: 'Owner-supplied sales history',
    },
    assets: {
      email_assets: [{
        id: 'e1', subject_line: 'Spring sale is live', preheader: 'Refresh your windowsill',
        headline: 'Spring plant sale', body_copy: 'Take 30% off everything this week.', cta: 'Shop the sale',
      }],
    },
    expect: ['promotion_term_mismatch'],
  },
  {
    id: 'conflicting_destinations',
    sector: 'services',
    why: 'Two destination URLs split the campaign and the reporting behind it.',
    campaign: {
      offer_summary: 'Tax return filing service',
      audience: 'Sole traders filing late',
      key_message: 'Filed before the deadline',
      cta: 'Start your return',
      proof: 'Owner-supplied filing records',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'File your return', seo_title: 'Tax return filing service',
        meta_description: 'Start at https://example.com/start today.', cta: 'Start your return',
      }],
      email_assets: [{
        id: 'e1', subject_line: 'File before the deadline', preheader: 'Start your return',
        headline: 'Filed on time', body_copy: 'Begin at https://example.com/returns instead.',
        cta: 'Start your return',
      }],
    },
    expect: ['conflicting_cta_url'],
  },
  {
    id: 'missing_cta',
    sector: 'services',
    why: 'An asset with no CTA cannot drive the campaign action.',
    campaign: {
      offer_summary: 'Garden design consultation',
      audience: 'New homeowners with an unplanned garden',
      key_message: 'A plan before you plant',
      cta: 'Book a consultation',
      proof: 'Owner-supplied before/after photographs',
    },
    assets: {
      social_assets: [{ id: 's1', hook: 'A plan before you plant', caption: 'Design first, dig second.', cta: '' }],
    },
    expect: ['missing_primary_cta'],
  },
  {
    id: 'date_outside_window',
    sector: 'events',
    why: 'A date outside the campaign window advertises an offer that is not running.',
    campaign: {
      offer_summary: 'Summer supper club',
      audience: 'Local diners',
      key_message: 'Six seats, one long table',
      cta: 'Claim a seat',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      proof: 'Owner-supplied past menus',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Summer supper club', seo_title: 'Summer supper club',
        meta_description: 'Join us on 2026-08-15 for six seats at one long table.', cta: 'Claim a seat',
      }],
    },
    expect: ['date_or_timezone_mismatch'],
  },
  {
    id: 'multi_audience_drift',
    sector: 'multi_audience',
    why: 'An asset generated for a different audience than the brief now targets.',
    campaign: {
      offer_summary: 'Group strength classes',
      audience: 'Over-fifties returning to exercise',
      key_message: 'Strength at any age',
      cta: 'Try a class',
      proof: 'Owner-supplied attendance records',
    },
    assets: {
      social_assets: [{
        id: 's1', hook: 'Strength at any age', caption: 'Small groups, steady progress.', cta: 'Try a class',
        // The snapshot carries every material field, matching the brief except
        // the audience — so this fixture isolates audience drift. A PARTIAL
        // snapshot would additionally (and correctly) read as a brief change,
        // because an unset material field differs from a populated one.
        brief_snapshot: {
          audience: 'University athletes',
          offer_summary: 'Group strength classes',
          key_message: 'Strength at any age',
        },
      }],
    },
    expect: ['audience_mismatch'],
  },
  {
    id: 'stale_after_brief_change',
    sector: 'services',
    why: 'The brief changed after generation; the asset may no longer match it.',
    campaign: {
      offer_summary: 'Twelve-week running plan',
      audience: 'First-time half-marathon runners',
      key_message: 'Finish without walking',
      cta: 'Get the plan',
      proof: 'Owner-supplied finisher times',
    },
    assets: {
      email_assets: [{
        id: 'e1', subject_line: 'Your twelve-week plan', preheader: 'Finish without walking',
        headline: 'Twelve weeks to the line', body_copy: 'A plan built around three runs a week.',
        cta: 'Get the plan',
        brief_snapshot: { offer_summary: 'Eight-week running plan', key_message: 'Finish without walking' },
      }],
    },
    expect: ['brief_snapshot_mismatch'],
  },
  {
    id: 'compounded_defects',
    sector: 'regulated',
    why: 'Real campaigns fail in combination — every defect must still be reported separately.',
    campaign: {
      offer_summary: 'Sleep coaching for new parents',
      audience: 'Parents of children under one',
      key_message: 'A gentler night routine',
      cta: 'Book a session',
      promo_terms: '10% off with code SLEEP10',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    },
    assets: {
      website_pages: [{
        id: 'w1', title: 'Sleep coaching', seo_title: 'Sleep coaching for new parents',
        meta_description: 'Backed by [parent results]. Offer ends 2026-07-04. Save 25%.', cta: '',
      }],
    },
    // One asset, four independent defects: no CTA, wrong discount, a date past
    // the window, and proof-shaped copy with no proof in the brief.
    expect: [
      'date_or_timezone_mismatch',
      'missing_primary_cta',
      'promotion_term_mismatch',
      'unsupported_claim_reference',
    ],
  },
];

module.exports = { CORPUS_VERSION, FIXTURES, PROHIBITED_INVENTIONS };
