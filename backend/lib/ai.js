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
  // Prompt 28's rule, verbatim, applied to every generation:
  'Avoid guaranteed outcomes, medical claims, therapy claims, manipulative scarcity, shame-based marketing and unrealistic income promises. ' +
  'Plain text inside JSON string values - no markdown.';

// ---------------------------------------------------------------------------
// Mock mode: without an ANTHROPIC_API_KEY we synthesize valid JSON straight
// from the schema (same philosophy as CF's keylessChat — the app must be
// fully clickable end-to-end with zero API cost). Strings come from a
// field-name sample library so demo output reads like a real launch kit for
// an example business (a yoga teacher's online course), not placeholder junk.
// It is NOT AI: it ignores the user's actual answers. Real output needs a key.
// ---------------------------------------------------------------------------

// Realistic sample copy per field name. Arrays cycle so repeated items differ.
const MOCK_SAMPLES = {
  headline: ['Strong at home in 20 minutes a day', 'Your first month of calm, consistent movement'],
  subheadline: ['A 4-week beginner yoga course for busy professionals who want energy back without gym anxiety.'],
  hook: ['You don\'t need an hour. You need the right 20 minutes.', 'I couldn\'t touch my toes either. Day 30 photo inside.', 'The 5pm slump isn\'t about coffee - it\'s about your back.', 'Stop saving workout videos you never do.'],
  topic: ['Why flexibility is a skill, not a gift', 'The 20-minute morning routine my students actually keep', '3 stretches for desk workers', 'What week 1 really looks like', 'Student story: from stiff to steady'],
  caption_angle: ['Personal story leading into the daily routine', 'Myth-busting with a quick demo', 'Before/after of a real student week', 'Behind the scenes of building the course'],
  cta: ['Join the 4-week course', 'Get the free routine', 'Reply "START" and I\'ll send details', 'Save this for tomorrow morning'],
  goal: ['educate', 'build trust', 'handle objections', 'sell the offer'],
  subject_line: ['The stretch I do before every meeting', 'Why "no time" is the wrong problem', 'Your first week, planned for you', 'The doors are open', 'A student asked me this yesterday', 'What happens after week 4?', 'Last call for this round'],
  preheader: ['20 minutes, no equipment, no experience needed.', 'The routine that survives busy weeks.'],
  main_angle: ['Personal story that mirrors the reader\'s situation', 'Address the "no time" objection head-on', 'Introduce the offer with a clear promise', 'Answer the top three doubts', 'Social-proof angle with a student result', 'Paint week-by-week transformation', 'Honest final reminder without fake urgency'],
  email_type: ['welcome', 'story', 'problem', 'offer reveal', 'objections', 'proof', 'last call'],
  keyword: ['beginner yoga at home', 'yoga for desk workers', 'short morning yoga routine', '20 minute yoga for beginners', 'yoga course online beginner'],
  title: ['Beginner Yoga at Home: A Realistic 4-Week Plan', '20-Minute Morning Yoga for Busy People'],
  meta_description: ['A 4-week beginner yoga course built for busy schedules. 20 minutes a day, no equipment, real results you can keep.'],
  content_angle: ['Practical guide answering the exact search intent, ending with the course as next step'],
  task_title: ['Publish day-1 post with the routine hook', 'DM three engaged followers and start a conversation', 'Set up the landing page from your kit copy', 'Post one student story or your own before/after', 'Review the week: what got replies?'],
  task_description: ['Use the hook from your content plan and keep it under 30 seconds.', 'No pitch - ask about their situation first.', 'Paste the headline, benefits and FAQ from the Landing Page Studio.', 'Proof posts convert lurkers - keep it honest.', 'Fifteen minutes with the weekly review questions.'],
  task_type: ['content', 'sales', 'website', 'content', 'review'],
  offer_name: ['Calm & Strong: 4-Week Beginner Yoga', 'The Desk Reset: daily 20-minute practice', 'Private 1:1 Yoga Kickstart'],
  offer_type: ['online course', 'membership', 'coaching'],
  promise: ['Build a 20-minute daily practice you actually keep - energy up, back pain down, in four weeks.'],
  target_customer: ['Busy office professionals 30-45 who want to move again but feel gym-intimidated and time-poor.'],
  delivery_format: ['4 weekly modules of short videos + printable routine + private community', 'Weekly live class + recordings', '4 private video calls + custom plan'],
  price_suggestion: ['€49-79 one-time', '€19/month', '€250-350 for 4 weeks'],
  why_it_fits: ['Matches your teaching experience and fits creation into limited weekly hours.'],
  problem_section: ['You sit ten hours a day. Your back knows it, your energy knows it. You\'ve saved a dozen workout videos and done none of them - because an hour-long class doesn\'t fit a real schedule.'],
  solution_section: ['Calm & Strong is a 4-week course built around one honest constraint: 20 minutes a day. Short guided sessions, a printable routine, and a plan that survives busy weeks.'],
  transformation_section: ['In four weeks you go from "I should really move more" to a practice that\'s simply part of your morning - without soreness, gyms, or guilt.'],
  pricing_section: ['One payment of €59. Everything included: 4 modules, printable routines, community access. No subscription.'],
  final_cta_section: ['Your back will feel this week either way. Choose which way. Join Calm & Strong today.'],
  primary_cta: ['Join the course'],
  secondary_cta: ['See the week-1 routine'],
  positioning_statement: ['I help busy desk workers rebuild energy and mobility with 20-minute daily yoga - no gym, no experience needed.'],
  desired_transformation: ['From stiff, drained and inconsistent to a daily 20-minute practice that sticks.'],
  elevator_pitch: ['Most busy people don\'t need more motivation - they need a practice that fits. I teach a 20-minute daily yoga method for desk workers who want their energy back.'],
  niche: ['Yoga for busy desk professionals', 'Morning mobility for remote workers', 'Beginner yoga for over-35s'],
  reason: ['Large underserved audience, matches your experience, reachable on Instagram.'],
  demand_signal: ['High search volume for "yoga for beginners at home" and active desk-pain communities.'],
  why_it_fits_niche: ['Fits your skills and available time.'],
  description: ['A 35-year-old project manager who sits all day, used to be active, and wants a realistic way back in.'],
  main_pain: ['No time and no idea where to start - every program assumes an hour a day.'],
  desired_outcome: ['Consistent energy, less back pain, and feeling in control of their body again.'],
  where_they_hang_out: ['Instagram, LinkedIn, and productivity podcasts.'],
  pillar: ['Desk-body repair', 'Realistic routines', 'Student proof', 'Behind the course'],
  headline_ad: ['20 minutes. No gym. Four weeks.'],
  primary_text: ['You don\'t need another gym membership you won\'t use. You need 20 minutes and a plan that respects your calendar. That\'s the whole method.'],
  visual_direction: ['Phone-shot: you at a desk, standing up, one stretch, cut to mat - natural light, no production.'],
  question: ['Do I need experience or equipment?', 'What if I miss a few days?', 'How much time does it really take?', 'Is this live or self-paced?'],
  answer: ['None - week 1 assumes zero flexibility and uses only a mat.', 'The plan is built for real life; catch-up days are included.', '20 minutes a day, that\'s the entire promise.', 'Self-paced videos plus an optional weekly live class.'],
  summary: ['A complete launch plan for a 4-week beginner yoga course aimed at busy desk professionals.'],
  testimonial_placeholder_note: ['Add real student results here once you have them - never invent testimonials.'],
  benefits: ['More energy through the workday', 'Noticeably less back and neck stiffness', 'A routine that survives busy weeks', 'Confidence to move without a gym'],
  whats_included: ['4 weekly video modules (20 min/day)', 'Printable morning routine', 'Desk-break stretch cards', 'Private student community', 'Lifetime access'],
  what_is_included: ['4 weekly video modules', 'Printable routines', 'Community access', 'Lifetime updates'],
  who_its_for: ['Desk workers who sit 8+ hours', 'Complete beginners', 'People who quit gyms but want to move'],
  who_its_not_for: ['Advanced practitioners', 'Anyone wanting intense weight-loss training'],
  how_it_works: ['Join and get instant access to week 1', 'Follow one 20-minute session a day', 'Check off each day in the tracker', 'Finish week 4 with a routine that sticks'],
  bonuses: ['Desk-stretch cheat sheet', '5-minute "no time today" fallback routine'],
  objections: ['"I have no time"', '"I\'m not flexible enough"', '"I\'ve failed programs before"'],
  objection_answers: ['The whole course is built on 20 minutes - less than your commute.', 'Week 1 assumes you can\'t touch your toes. That\'s the point.', 'Daily check-ins and a fallback routine make missed days recoverable.'],
  launch_checklist: ['Finish the landing page from the studio copy', 'Schedule week 1 of the content plan', 'Load the 7 emails into your email tool', 'Pick 2 ad hooks to test', 'Publish and tell your existing audience'],
};

const FALLBACK_SAMPLES = [
  'Clear, specific and tied to your offer.',
  'Written for your exact audience, not everyone.',
  'One idea per line, ready to copy.',
];

let mockCounter = 0;

function sampleFor(key) {
  const k = key.toLowerCase();
  const pool =
    MOCK_SAMPLES[k] ||
    MOCK_SAMPLES[Object.keys(MOCK_SAMPLES).find((s) => k.includes(s) || s.includes(k)) || ''] ||
    FALLBACK_SAMPLES;
  return pool[mockCounter++ % pool.length];
}

function mockFromSchema(schema, key = 'value') {
  if (schema.enum) return schema.enum[mockCounter++ % schema.enum.length];
  switch (schema.type) {
    case 'string':
      return sampleFor(key);
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
      const props = Object.entries(schema.properties || {});
      // Q/A pairs must correspond — pin both to the same sample index.
      if (props.length === 2 && schema.properties.question && schema.properties.answer) {
        const i = mockCounter++ % MOCK_SAMPLES.question.length;
        return { question: MOCK_SAMPLES.question[i], answer: MOCK_SAMPLES.answer[i] };
      }
      const out = {};
      for (const [k, sub] of props) {
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
