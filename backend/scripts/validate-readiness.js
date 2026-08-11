#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LB-V17-05 — validate a production-readiness evidence record (READ-ONLY).
//
//   npm run readiness:validate -- docs/evidence/2026-08-11-readiness.json
//   npm run readiness:validate -- <file> --candidate <sha>
//
// Checks the record against backend/lib/readiness-evidence.js: exact candidate,
// production deploy class, fresh timestamp, http_status 200, ready=true,
// blockers=0, operator attestation and no PII/secret/full-body content. It runs
// NOTHING live and mutates nothing — the owner performs the authenticated
// GET /api/admin/readiness against the deployed candidate and pastes the counts.
// ---------------------------------------------------------------------------

'use strict';

const fs = require('fs');
const path = require('path');
const { validateReadinessRecord } = require('../lib/readiness-evidence');

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const candIdx = args.indexOf('--candidate');
  const candidateSha = candIdx !== -1 ? args[candIdx + 1] : undefined;

  if (!file) {
    console.error('usage: node backend/scripts/validate-readiness.js <record.json> [--candidate <sha>]');
    process.exit(2);
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    console.error(`cannot read/parse ${file}: ${err.code || err.message}`);
    process.exit(2);
  }

  const problems = validateReadinessRecord(record, { candidateSha });

  if (problems.length) {
    console.error('\nReadiness record: INVALID\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\n→ public_paid keeps the production-readiness observation OPEN until a clean record exists.\n');
    process.exit(1);
  }

  console.log('\nReadiness record: OK — production ready=true, blockers=0, observed against the pinned candidate.\n');
  process.exit(0);
}

if (require.main === module) main();
