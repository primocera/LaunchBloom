#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v15 SC-04 — validate a completed live-money rehearsal record (READ-ONLY).
//
//   npm run rehearsal:validate -- docs/evidence/2026-08-05-rehearsal.json
//   npm run rehearsal:validate -- <file> --candidate <sha>
//
// Checks the record against backend/lib/rehearsal.js: all eight rows present,
// no reused/stale evidence, no PII, and every live_required row satisfied by a
// LIVE (not test-mode) run. Prints completeness for the public_paid track. It
// runs nothing live and mutates nothing — the owner performs the rehearsal.
// ---------------------------------------------------------------------------

'use strict';

const fs = require('fs');
const path = require('path');
const { validateRehearsalRecord, liveRehearsalCompleteness } = require('../lib/rehearsal');

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const candIdx = args.indexOf('--candidate');
  const candidateSha = candIdx !== -1 ? args[candIdx + 1] : undefined;

  if (!file) {
    console.error('usage: node backend/scripts/validate-rehearsal.js <record.json> [--candidate <sha>]');
    process.exit(2);
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    console.error(`cannot read/parse ${file}: ${err.code || err.message}`);
    process.exit(2);
  }

  const problems = validateRehearsalRecord(record, { candidateSha });
  const completeness = liveRehearsalCompleteness(record);

  if (problems.length) {
    console.error('\nRehearsal record: INVALID\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nRehearsal record: schema OK\n');
  console.log(`  live rehearsal complete (public_paid): ${completeness.complete ? 'YES' : 'NO'}`);
  if (!completeness.complete) {
    console.log(`  outstanding rows: ${completeness.outstanding.join(', ')}`);
    console.log('  → public_paid keeps the live-money accepted risk visible (CONDITIONAL GO, never clean GO).');
  }
  console.log('');
  // A schema-valid but incomplete record still exits non-zero, so a partial
  // rehearsal cannot be scripted into a green live-evidence gate.
  process.exit(completeness.complete ? 0 : 1);
}

if (require.main === module) main();
