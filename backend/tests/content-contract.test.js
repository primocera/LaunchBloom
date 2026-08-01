// v7 LB-00/LB-01 — automated content contract. Scans the frontend SOURCE for
// the canonical promise, the five Create paths, the trial disclosure and the
// banned-claim vocabulary so customer-facing copy cannot drift without a
// failing test. Pure fs + string checks, no network, no build required.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SRC = path.join(__dirname, '..', '..', 'app-src');

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

const SOURCES = walk(APP_SRC, ['.jsx', '.js', '.html', '.css']);
const read = (p) => fs.readFileSync(p, 'utf8');

// ── Banned claims and retired vocabulary (product contract) ─────────────────

const BANNED = [
  [/launch kit/i, 'retired "launch kit" vocabulary (say campaign package / full launch campaign)'],
  [/production[- ]ready/i, 'production-ready claim'],
  [/send[- ]ready/i, 'send-ready claim'],
  [/ready to paste/i, 'ready-to-paste claim'],
  [/fully compliant/i, 'compliance certification claim'],
  [/will rank/i, 'ranking guarantee'],
  [/will publish/i, 'publishing claim'],
  [/no card needed/i, 'hidden payment-method requirement'],
  [/guaranteed (results|income|revenue|traffic)/i, 'outcome guarantee'],
  [/inbox placement/i, 'deliverability claim'],
];

test('no frontend source contains banned claims or retired vocabulary', () => {
  const hits = [];
  for (const file of SOURCES) {
    const text = read(file);
    for (const [re, why] of BANNED) {
      const m = text.match(re);
      if (m) hits.push(`${path.relative(APP_SRC, file)}: "${m[0]}" (${why})`);
    }
  }
  assert.deepEqual(hits, [], `banned copy found:\n${hits.join('\n')}`);
});

// ── v9 SC-08: ICP legibility + two honest use-case paths, one product ───────

test('landing names the ICP and offers two use-case paths into one workflow', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  // Category + who it's for, without hype words.
  assert.match(landing, /campaign-control workspace/i, 'landing must state the category');
  assert.match(landing, /freelance marketers/i);
  assert.match(landing, /boutique agencies/i);
  // Two paths under one product.
  assert.match(landing, /Launch my own campaign/);
  assert.match(landing, /Build campaigns for clients/);
  // The paths must reuse the same contract, not fork the product.
  assert.match(landing, /Brand Profile\s*→\s*Campaign Brief\s*→\s*Create\s*→\s*Review\s*→\s*Export/);
  // Hype/vague-AI vocabulary the prompt forbids must not appear.
  assert.ok(!/all-in-one|effortless|10x|one-click/i.test(landing), 'no hype vocabulary');
});

test('landing embeds no hardcoded prices — commercial values come from the catalog', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  assert.ok(!/[$€£]\s?\d/.test(landing), 'no currency+digit literals in landing content');
});

test('onboarding path analytics carry only the path, never a company/client name', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const m = landing.match(/trackEvent\('onboarding_path_selected'\s*,\s*\{([^}]*)\}/);
  assert.ok(m, 'onboarding_path_selected must be tracked');
  assert.ok(!/name|company|client_name|email/i.test(m[1]), 'no identifying fields in path analytics');
});

// ── The canonical promise ───────────────────────────────────────────────────

const PROMISE = 'Turn one offer into a launch-ready campaign';

test('landing hero, final CTA and metadata all carry the canonical promise', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const html = read(path.join(APP_SRC, 'index.html'));
  assert.ok(landing.includes(`<h1>${PROMISE}.</h1>`), 'hero h1 must state the promise');
  assert.ok(html.includes(`<title>Scalvya — ${PROMISE}</title>`), 'title must state the promise');
  assert.ok(html.includes(`og:title" content="Scalvya — ${PROMISE}"`), 'og:title must match the visible hero');
});

// ── Exactly five canonical Create paths, consistent across surfaces ─────────

const FIVE_PATHS = ['/app/website', '/app/email-studio', '/app/social', '/app/creative', '/app/seo'];
const FIVE_TITLES = ['Website', 'Email', 'Social', 'Ads & Creative', 'SEO Ideas'];

test('Create shows exactly the five canonical destinations', () => {
  const create = read(path.join(APP_SRC, 'routes', 'Create.jsx'));
  const routes = [...create.matchAll(/to: '(\/app\/[a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes, FIVE_PATHS, 'Create cards must be the five canonical studios, in order');
  for (const t of FIVE_TITLES) {
    assert.ok(create.includes(`title: '${t.replace(/'/g, "\\'")}'`) || create.includes(`title: '${t}'`), `Create must offer "${t}"`);
  }
});

test('sidebar Create section lists the same five studios and no sixth', () => {
  const sidebar = read(path.join(APP_SRC, 'components', 'Sidebar.jsx'));
  const nav = sidebar.match(/const STUDIO_NAV = \[([\s\S]*?)\];/);
  assert.ok(nav, 'STUDIO_NAV must exist');
  const routes = [...nav[1].matchAll(/to: '(\/app\/[a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes, FIVE_PATHS, 'sidebar studios must match the five canonical destinations');
});

// ── Trial disclosure from the canonical catalog ─────────────────────────────

test('trial disclosure is honest and lives in the canonical catalog', () => {
  const { publicCatalog } = require('../lib/plan-catalog');
  const cat = publicCatalog();
  assert.equal(cat.trial.days, 3);
  assert.equal(cat.trial.ai_actions_total, 20);
  assert.equal(cat.trial.launch_kits_total, 1);
  assert.match(cat.trial.disclosure, /Payment method required/);
  assert.match(cat.trial.disclosure, /cancel/i);
});

// ── One shared status vocabulary (LB-11) ────────────────────────────────────

test('studio pills and Library share one customer-facing status vocabulary', async () => {
  const { STATUS_LABEL, STATUS_VALUES, statusLabelFor } = await import(
    pathToFileURL(path.join(APP_SRC, 'lib', 'status-labels.js')).href
  );
  assert.deepEqual(STATUS_VALUES, ['draft', 'edited', 'ready', 'published']);
  assert.equal(STATUS_LABEL.draft, 'Draft');
  assert.equal(STATUS_LABEL.edited, 'Needs review');
  assert.equal(STATUS_LABEL.ready, 'Ready to export');
  assert.equal(STATUS_LABEL.published, 'Published');
  assert.equal(statusLabelFor(undefined), 'Draft');

  // Neither surface may redeclare its own divergent label map.
  const generator = read(path.join(APP_SRC, 'routes', 'studios', 'generator.jsx'));
  const library = read(path.join(APP_SRC, 'routes', 'AssetLibrary.jsx'));
  assert.ok(generator.includes("from '../../lib/status-labels'"), 'generator must use the shared labels');
  assert.ok(library.includes("from '../lib/status-labels'"), 'Library must use the shared labels');
  assert.ok(!/Needs review/.test(generator), 'generator must not hard-code status labels');
});

// ── Prior-trial users get pay-today copy, never a promised second trial ─────

test('paywall and checkout banner switch copy for prior-trial users', () => {
  const paywall = read(path.join(APP_SRC, 'components', 'TrialPaywall.jsx'));
  assert.match(paywall, /trial_eligible/, 'paywall must consult server trial eligibility');
  assert.match(paywall, /charged today|charged .* today/i, 'pay-today branch must state the immediate charge');
  assert.match(paywall, /No second trial/, 'pay-today branch must rule out a second trial');

  const app = read(path.join(APP_SRC, 'App.jsx'));
  assert.match(app, /status === 'trialing'/, 'success banner must only claim a trial when actually trialing');
  assert.match(app, /Your subscription is active/, 'non-trial checkout success needs its own copy');
});

// ── Brief approval is a human decision, not an AI-strategy purchase ─────────

test('a complete manual brief can be approved without generating strategy', () => {
  // v9 SC-01: the brief approval UI moved from the Campaigns.jsx monolith into
  // the per-campaign workspace Brief section. The guarantees are unchanged.
  const brief = read(path.join(APP_SRC, 'routes', 'campaign', 'CampaignWorkspace.jsx'));
  // Approval must not be conditioned on a generated strategy existing.
  assert.ok(!/strategy[\s\S]{0,60}disabled[\s\S]{0,60}approve/i.test(brief), 'approve must not require strategy');
  assert.match(brief, /Generate strategy \(optional\) · 1 AI action/, 'strategy is optional and cost-disclosed');
  assert.match(brief, /Reopen this brief\? New generations will pause/, 'reopen must explain downstream implications');
  assert.match(brief, /keep the snapshot they were created from/, 'reopen must state snapshot semantics');
});

// ── Brand Profile states the minimum baseline and snapshot semantics ────────

test('Brand Profile shows the minimum baseline and snapshot behavior', () => {
  const brand = read(path.join(APP_SRC, 'routes', 'BrandProfile.jsx'));
  assert.match(brand, /minimumViableProfile/, 'must reuse the shared baseline helper');
  assert.match(brand, /Before your first generation, add/, 'missing baseline must be actionable, not a score');
  assert.match(brand, /assets you.{0,8}ve already saved keep the context/i, 'snapshot semantics must be stated');
});

// ── Studio-level guarantees (LB-02, LB-06..LB-10) ───────────────────────────

test('hero defines launch-ready and signup routes to first activation', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  assert.match(landing, /Launch-ready\s+means structured, connected and ready for your review/, 'launch-ready must be defined near the hero');
  const signup = read(path.join(APP_SRC, 'routes', 'Signup.jsx'));
  assert.match(signup, /navigate\('\/app\/brand\?welcome=1'\)/, 'fresh signups must land in Brand Profile first run');
});

// ── v12 SC-V12-06: agency-first conversion, without fabricated proof ─────────

test('the hero leads with the primary ICP and the expensive consistency problem', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const sub = landing.match(/<p className="lp-sub">([\s\S]*?)<\/p>/);
  assert.ok(sub, 'the hero supporting paragraph must exist');
  const copy = sub[1].replace(/\s+/g, ' ');

  const agencyAt = copy.search(/freelance marketers and boutique\s*agencies/i);
  const soloAt = copy.search(/solo founders/i);
  assert.ok(agencyAt >= 0, 'the primary ICP (freelance marketers and boutique agencies) must appear');
  assert.ok(soloAt >= 0, 'solo founders must stay visible as the secondary ICP');
  assert.ok(agencyAt < soloAt, 'the primary ICP must lead; solo founders come after');

  // The expensive problem the primary ICP pays to solve: consistency across channels.
  assert.match(copy, /consistent across/i, 'the hero must name the cross-channel consistency problem');
  assert.match(copy, /positioning, claims and CTA/i, 'the problem must be concrete, not generic');
  // Responsibility stays with the human; launch-ready never implies published.
  assert.match(copy, /publishing stays in your hands/i, 'the hero must keep publishing as the user\'s responsibility');
});

test('the landing page invents no proof — no logos, counts, testimonials, time-saved, urgency', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const banned = [
    [/trusted by/i, 'a "trusted by" social-proof claim'],
    [/\btestimonials?\b/i, 'a testimonial'],
    [/\b\d[\d,]*\+?\s*(customers|users|marketers|agencies|founders|brands|teams)\b/i, 'a fabricated usage count'],
    [/thousands of (customers|users|marketers|agencies|founders|brands)/i, 'a vague usage count'],
    [/save[sd]?\s+(you\s+)?\d+\s*(hours|hrs|minutes|mins)/i, 'a time-saved claim'],
    [/\b\d+x\s+(faster|more)/i, 'a multiplier performance claim'],
    [/rated\s*\d(\.\d)?|\d(\.\d)?\s*\/\s*5/i, 'a rating claim'],
    [/limited time|only\s+\d+\s+(spots|seats)\s+left|act now|ends (soon|tonight)/i, 'a false-urgency claim'],
  ];
  for (const [re, what] of banned) {
    assert.ok(!re.test(landing), `landing must not include ${what}`);
  }
  // The one on-page example must stay labelled as synthetic, not a real result.
  assert.match(landing, /example data|synthetic|not a customer result/i,
    'the product preview must be labelled as an example, not a real customer outcome');
});

test('Email studio discloses cost and says Scalvya does not send', () => {
  const email = read(path.join(APP_SRC, 'routes', 'studios', 'EmailFlowStudio.jsx'));
  assert.match(email, /Generate emails · 1 AI action/);
  assert.match(email, /does not send emails/);
});

test('Social calendar plans and never claims to post or schedule', () => {
  const social = read(path.join(APP_SRC, 'routes', 'studios', 'SocialStudio.jsx'));
  assert.match(social, /does not post or schedule to any platform/);
  assert.ok(!/Set a date to schedule/.test(social), 'calendar must not call planning "scheduling"');
  assert.match(social, /never posts or schedules/);
});

test('Creative studio frames outputs as briefs, not media or launched ads', () => {
  const creative = read(path.join(APP_SRC, 'routes', 'studios', 'CreativeStudio.jsx'));
  assert.match(creative, /not rendered media, approved ads or launched campaigns/);
});

test('shared export note says review remains with the user and costs nothing', () => {
  const generator = read(path.join(APP_SRC, 'routes', 'studios', 'generator.jsx'));
  assert.match(generator, /Review facts, links, claims/);
  assert.match(generator, /does not use AI actions/);
});

// ── v10 SC-01: one recommended path ────────────────────────────────────────
// The guided flow used to be a SECOND way to create work, with its own
// positioning → offers → package generation steps. It is folded into the
// campaign-creation contract; /app/flow is now a read-only archive. The old
// per-button AI-cost disclosures are therefore gone by design — what must hold
// now is that the page generates nothing and loses nothing.

test('the legacy guided flow generates nothing and offers no AI actions', () => {
  const flow = read(path.join(APP_SRC, 'routes', 'Flow.jsx'));
  assert.doesNotMatch(flow, /1 AI action/, 'an archive must not offer a generation');
  assert.doesNotMatch(flow, /api\.generate/, 'no generation call may remain on this route');
  assert.match(flow, /Full launch campaigns now start in Campaigns/);
});

test('the legacy guided flow keeps earlier work readable (no data stranded)', () => {
  const flow = read(path.join(APP_SRC, 'routes', 'Flow.jsx'));
  // /app/kits/:id is linked from nowhere else — losing this index would make
  // earlier launch kits unreachable in practice even though the rows survive.
  assert.match(flow, /\/app\/kits\/\$\{k\.id\}/);
  assert.match(flow, /nothing was deleted/i);
});

test('Create resolves a campaign before offering the five creation paths', () => {
  const create = read(path.join(APP_SRC, 'routes', 'Create.jsx'));
  // Without a campaign the user is asked which campaign the work belongs to,
  // rather than being shown a second navigation list of studios.
  assert.match(create, /Choose the campaign this work belongs to/);
  assert.match(create, /Complete brief/);
});

test('Home and the campaign Overview send the user to the same destination', () => {
  const nextActions = read(path.join(APP_SRC, 'lib', 'next-actions.js'));
  const campaignAction = read(path.join(APP_SRC, 'lib', 'campaign-next-action.js'));
  // Both must carry campaign context into Create; a bare /app/create from Home
  // would ask which campaign the user meant immediately after Home named one.
  assert.match(campaignAction, /\/app\/create\?campaign=/);
  assert.match(nextActions, /\/app\/create\?campaign=/);
  assert.doesNotMatch(nextActions, /to: '\/app\/create'/, 'no context-free Create destination may remain');
});

// ── v10 SC-05: ICP focus and first-screen honesty ──────────────────────────

test('the hero leads with the client-work ICP without excluding solo founders', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const paths = landing.slice(landing.indexOf('const ICP_PATHS'), landing.indexOf('const PROOF_STEPS'));
  // Order signals focus. Both paths must remain present and identically served.
  assert.ok(paths.indexOf("key: 'client'") < paths.indexOf("key: 'own'"), 'client work should lead');
  assert.ok(paths.includes('Solo founders and small brands'), 'the second ICP must not be dropped');
  assert.match(landing, /never changes what you can do or what you pay/,
    'choosing a path must not imply different entitlements');
});

test('the above-fold proof strip claims capability, never outcomes', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const strip = landing.slice(landing.indexOf('const PROOF_STEPS'), landing.indexOf('const VALUE_LIST'));
  // Illustrative labels only: no counts, percentages, ratings or time savings.
  assert.doesNotMatch(strip, /\d+\s*%|\d[\d,]*\+|\bhours saved\b|\bfaster\b|\btrusted by\b|\bcustomers\b/i,
    'the proof strip must not carry a metric or social-proof claim');
  assert.match(strip, /One approved brief/);
  assert.match(strip, /Client-ready handoff/);
});

test('every hero CTA states what happens next', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  assert.match(landing, /Create an account free/, 'the primary CTA must say the account is free');
  assert.match(landing, /a payment method is required for the trial/,
    'the trial disclosure must stay explicit about the payment method');
  assert.doesNotMatch(landing, /no card needed|free forever|cancel anytime, no questions/i);
});
