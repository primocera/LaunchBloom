// ---------------------------------------------------------------------------
// LB-V17-03 — storage inventory contract. Client-confidential campaign drafts
// must go through the bounded, TTL'd, user/workspace-scoped draft registry
// (app-src/lib/local-drafts.js), never a raw indefinite localStorage.setItem.
//
// This test scans the real frontend source and fails if:
//   - any localStorage.setItem writes a key that is not an explicitly allowed
//     harmless preference key (so a new confidential draft can't be added raw);
//   - a known draft key (lb-draft*, campaign_form_draft) is written raw instead
//     of via the registry;
//   - the transient SEO→Website handoff is put in localStorage rather than
//     sessionStorage.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_SRC = path.join(__dirname, '..', '..', 'app-src');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function read(p) { return fs.readFileSync(p, 'utf8'); }

// localStorage.setItem('key' — first string-literal argument.
const SET_ITEM = /localStorage\.setItem\(\s*['"]([^'"]+)['"]/g;

// Harmless, non-confidential preference/identifier keys allowed to be written
// directly. NONE of these carry client campaign content.
const ALLOWED_RAW_KEYS = new Set([
  'of-pending-plan',
  'of-pending-interval',
  'of-use-case',
  'active_workspace_id',
]);

const files = walk(APP_SRC);

test('LB-V17-03: no client-confidential draft is written via raw localStorage.setItem', () => {
  const offenders = [];
  for (const f of files) {
    if (f.endsWith(path.join('lib', 'local-drafts.js'))) continue; // the registry itself
    const src = read(f);
    let m;
    SET_ITEM.lastIndex = 0;
    while ((m = SET_ITEM.exec(src)) !== null) {
      const key = m[1];
      if (!ALLOWED_RAW_KEYS.has(key)) {
        offenders.push(`${path.relative(APP_SRC, f)} → localStorage.setItem('${key}')`);
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    `raw localStorage writes of non-preference keys must go through the draft registry:\n${offenders.join('\n')}`,
  );
});

test('LB-V17-03: the draft registry declares the studio and campaign draft keys', () => {
  const registry = read(path.join(APP_SRC, 'lib', 'local-drafts.js'));
  assert.match(registry, /'lb-draft-'/, 'studio generator draft prefix must be declared');
  assert.match(registry, /'campaign_form_draft'/, 'campaign form draft key must be declared');
  assert.match(registry, /clearAllDrafts/, 'a device-wide purge must exist');
  assert.match(registry, /expiresAt/, 'drafts must carry an expiry (TTL)');
});

test('LB-V17-03: generator and Campaigns use the registry, not raw draft writes', () => {
  const generator = read(path.join(APP_SRC, 'routes', 'studios', 'generator.jsx'));
  const campaigns = read(path.join(APP_SRC, 'routes', 'Campaigns.jsx'));
  for (const [name, src] of [['generator', generator], ['Campaigns', campaigns]]) {
    assert.match(src, /from '.*lib\/local-drafts'/, `${name} must import the draft registry`);
    assert.ok(!/localStorage\.setItem\(\s*['"](lb-draft|campaign_form_draft)/.test(src),
      `${name} must not write drafts through raw localStorage`);
  }
});

test('LB-V17-03: logout purges local drafts', () => {
  const auth = read(path.join(APP_SRC, 'lib', 'auth.jsx'));
  assert.match(auth, /clearAllDrafts\(\)/, 'logout must clear device drafts');
});

test('LB-V17-03: the transient SEO→Website handoff uses sessionStorage, not localStorage', () => {
  const seo = read(path.join(APP_SRC, 'routes', 'studios', 'SeoStudio.jsx'));
  const website = read(path.join(APP_SRC, 'routes', 'studios', 'WebsiteStudio.jsx'));
  assert.match(seo, /sessionStorage\.setItem\(\s*['"]of-website-brief/, 'SEO handoff must use sessionStorage');
  assert.ok(!/localStorage\.setItem\(\s*['"]of-website-brief/.test(seo), 'SEO handoff must not use localStorage');
  assert.match(website, /sessionStorage\.getItem\(\s*['"]of-website-brief/, 'Website studio must read the handoff from sessionStorage');
});
