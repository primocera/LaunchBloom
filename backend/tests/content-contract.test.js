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

// ── The canonical promise ───────────────────────────────────────────────────

const PROMISE = 'Turn one offer into a launch-ready campaign';

test('landing hero, final CTA and metadata all carry the canonical promise', () => {
  const landing = read(path.join(APP_SRC, 'routes', 'Landing.jsx'));
  const html = read(path.join(APP_SRC, 'index.html'));
  assert.ok(landing.includes(`<h1>${PROMISE}.</h1>`), 'hero h1 must state the promise');
  assert.ok(html.includes(`<title>LaunchBloom — ${PROMISE}</title>`), 'title must state the promise');
  assert.ok(html.includes(`og:title" content="LaunchBloom — ${PROMISE}"`), 'og:title must match the visible hero');
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
  const campaigns = read(path.join(APP_SRC, 'routes', 'Campaigns.jsx'));
  // The approve button must not be conditioned on c.strategy existing.
  assert.ok(!/c\.strategy && \([\s\S]{0,200}approve\(c\)/.test(campaigns), 'approve must not require strategy');
  assert.match(campaigns, /Generate strategy \(optional\) · 1 AI action/, 'strategy is optional and cost-disclosed');
  assert.match(campaigns, /Reopen this brief\? New generations will pause/, 'reopen must explain downstream implications');
  assert.match(campaigns, /keep the snapshot they were created from/, 'reopen must state snapshot semantics');
});

// ── Brand Profile states the minimum baseline and snapshot semantics ────────

test('Brand Profile shows the minimum baseline and snapshot behavior', () => {
  const brand = read(path.join(APP_SRC, 'routes', 'BrandProfile.jsx'));
  assert.match(brand, /minimumViableProfile/, 'must reuse the shared baseline helper');
  assert.match(brand, /Before your first generation, add/, 'missing baseline must be actionable, not a score');
  assert.match(brand, /assets you.{0,8}ve already saved keep the context/i, 'snapshot semantics must be stated');
});

// ── Generation cost is disclosed before every guided-flow generation ────────

test('guided flow discloses the 1-AI-action cost on each generation button', () => {
  const flow = read(path.join(APP_SRC, 'routes', 'Flow.jsx'));
  assert.match(flow, /Generate my positioning · 1 AI action/);
  assert.match(flow, /Design my 3 offers · 1 AI action/);
  assert.match(flow, /Build campaign package · 1 AI action/);
});
