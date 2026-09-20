#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v23 SV-23-02 — evaluate a production `npm audit --omit=dev --json` result as
// a fail-closed release gate, and emit a SHA-pinned, PII-free summary artifact.
//
//   node backend/scripts/check-audit.js <raw-audit.json> <candidate-sha>
//
// Exit codes (a release candidate may proceed only on 0):
//   0  pass        — 0 production advisories
//   1  failed      — one or more production advisories
//   2  unavailable — the audit did not produce a trustworthy result (registry
//                    unreachable, empty output, or unparseable / shape-less JSON)
//
// `unavailable` is deliberately NOT a pass: a missing or corrupt audit is the
// same launch-truth defect as a skipped one. The gate blocks either way, so a
// green release-candidate run can only mean the audit actually ran clean.
//
// It writes rc-evidence/audit-summary-<sha>.json with the UTC time, the exact
// severity counts and the computed verdict — the machine-readable artifact the
// launch record cites, instead of a hand-typed "audit 0" in prose.
// ---------------------------------------------------------------------------

'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

function fail(verdict, reason, summaryDir, sha) {
  writeSummary(summaryDir, sha, { verdict, reason, severity_counts: null, total: null });
  console.error(`::error::dependency audit ${verdict}: ${reason}`);
  process.exit(verdict === 'unavailable' ? 2 : 1);
}

function writeSummary(dir, sha, extra) {
  const summary = {
    schema: 'audit-summary-1',
    candidate_sha: sha || null,
    generated_at_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    scope: 'production (npm audit --omit=dev)',
    ...extra,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `audit-summary-${sha || 'unknown'}.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  } catch (err) {
    console.error(`::warning::could not write audit summary artifact: ${err.message}`);
  }
  return summary;
}

function main() {
  const rawPath = process.argv[2];
  const sha = process.argv[3];
  if (!rawPath) {
    console.error('usage: node backend/scripts/check-audit.js <raw-audit.json> <candidate-sha>');
    process.exit(2);
  }
  const summaryDir = path.dirname(rawPath);

  let text;
  try {
    text = fs.readFileSync(rawPath, 'utf8');
  } catch (err) {
    return fail('unavailable', `cannot read audit output (${err.code || err.message})`, summaryDir, sha);
  }
  if (!text.trim()) {
    return fail('unavailable', 'audit produced no output (registry unreachable?)', summaryDir, sha);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return fail('unavailable', `audit output is not valid JSON (${err.message})`, summaryDir, sha);
  }
  // npm surfaces a registry/transport failure as an { error } object with no
  // vulnerability metadata — that is unavailable, not clean.
  if (data && data.error) {
    const code = (data.error && (data.error.code || data.error.summary)) || 'unknown';
    return fail('unavailable', `npm audit reported an error (${code})`, summaryDir, sha);
  }
  const vulns = data && data.metadata && data.metadata.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') {
    return fail('unavailable', 'audit JSON has no metadata.vulnerabilities (unexpected shape)', summaryDir, sha);
  }

  const counts = {};
  for (const s of SEVERITIES) counts[s] = Number(vulns[s] || 0);
  const total = Number(
    vulns.total != null
      ? vulns.total
      : SEVERITIES.reduce((n, s) => n + counts[s], 0),
  );

  if (total > 0) {
    const summary = writeSummary(summaryDir, sha, { verdict: 'failed', reason: `${total} production advisor${total === 1 ? 'y' : 'ies'}`, severity_counts: counts, total });
    console.error(`::error::production dependency audit FAILED: ${JSON.stringify(summary.severity_counts)} (total ${total}). A release candidate cannot be green with open production advisories.`);
    process.exit(1);
  }

  const summary = writeSummary(summaryDir, sha, { verdict: 'pass', reason: '0 production advisories', severity_counts: counts, total: 0 });
  console.log(`production dependency audit PASS — 0 advisories. Artifact: audit-summary-${sha || 'unknown'}.json (${summary.generated_at_utc}).`);
  process.exit(0);
}

main();
