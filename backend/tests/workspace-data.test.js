// ---------------------------------------------------------------------------
// v10 SC-08 — account export and deletion must cover EVERY workspace-scoped
// table.
//
// This list drifted for thirty migrations: ten tables added between 008 and
// 035 were never registered, so export silently omitted them and deletion left
// them in the database — including `campaigns` and `brand_profiles`, which
// hold the user's own words.
//
// The failure was invisible because both operations are best-effort by design:
// a missing table is skipped rather than raising. So nothing failed. The
// deletion receipt reported success while the data survived.
//
// This test derives the truth from the migrations themselves, so the next
// table added is caught the moment it is not registered.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { WORKSPACE_TABLES } = require('../lib/workspace-data');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

/** Every table the migrations give a workspace_id column. */
function workspaceScopedTables() {
  const found = new Set();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      if (/workspace_id/i.test(m[2])) found.add(m[1]);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi)) {
      if (/add\s+column\s+(?:if\s+not\s+exists\s+)?workspace_id/i.test(m[2])) found.add(m[1]);
    }
  }
  return found;
}

test('every workspace-scoped table is covered by export and deletion', () => {
  const scoped = workspaceScopedTables();
  const covered = new Set(WORKSPACE_TABLES);
  const missing = [...scoped].filter((t) => !covered.has(t)).sort();

  assert.deepEqual(
    missing, [],
    `these tables hold workspace data but are neither exported nor deleted:\n  ${missing.join('\n  ')}\n` +
    'Add them to WORKSPACE_TABLES in backend/lib/workspace-data.js. Deletion order is children first.'
  );
});

test('no table is listed that has no workspace_id', () => {
  // A table without workspace_id would be filtered to nothing on delete —
  // harmless, but it means the list is describing something that is not true.
  const scoped = workspaceScopedTables();
  const stale = WORKSPACE_TABLES.filter((t) => !scoped.has(t));
  assert.deepEqual(stale, [], `listed but not workspace-scoped: ${stale.join(', ')}`);
});

test('the list has no duplicates', () => {
  // A duplicate would delete twice — harmless — but signals a bad merge.
  assert.equal(WORKSPACE_TABLES.length, new Set(WORKSPACE_TABLES).size);
});

test('children are deleted before the rows they reference', () => {
  const order = Object.fromEntries(WORKSPACE_TABLES.map((t, i) => [t, i]));
  // A foreign key would block the parent delete and leave an orphan behind.
  const mustPrecede = [
    ['asset_evidence_links', 'evidence'],
    ['campaign_deliverables', 'campaigns'],
    ['consistency_findings', 'campaigns'],
    ['asset_brief_reviews', 'campaigns'],
    ['asset_versions', 'website_pages'],
    ['website_pages', 'campaigns'],
    ['email_assets', 'campaigns'],
    ['social_assets', 'campaigns'],
    ['creative_assets', 'campaigns'],
    ['seo_assets', 'campaigns'],
  ];
  for (const [child, parent] of mustPrecede) {
    assert.ok(order[child] != null, `${child} is not in the list`);
    assert.ok(order[parent] != null, `${parent} is not in the list`);
    assert.ok(order[child] < order[parent], `${child} must be deleted before ${parent}`);
  }
});

test('the tables holding the user’s own words are covered', () => {
  // Named explicitly: these are the ones whose omission was the actual defect,
  // and a future refactor that drops them should fail loudly rather than
  // reduce a generic count.
  for (const t of ['campaigns', 'brand_profiles', 'evidence', 'asset_versions', 'workspace_templates']) {
    assert.ok(WORKSPACE_TABLES.includes(t), `${t} must be exported and deleted`);
  }
});
