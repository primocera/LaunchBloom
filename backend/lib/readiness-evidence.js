// ---------------------------------------------------------------------------
// LB-V17-05 — the sanitized production-readiness EVIDENCE record + validator.
//
// The production-readiness gate is an owner OBSERVATION: an authenticated
// GET /api/admin/readiness against the DEPLOYED candidate, observed ready=true
// with blockers=0. A good runbook is not the observation. This module is the
// single machine-readable schema for the record the owner captures, and it
// validates that record so a stale, wrong-candidate, wrong-environment,
// not-ready or PII-bearing record can never be mistaken for a clean pass.
//
// Pure: no I/O, no Stripe, no database, no HTTP. Claude Code prepares and
// validates the runbook and record; only the owner ever calls production.
// Mirrors backend/lib/rehearsal.js on purpose so the two owner gates read alike.
// ---------------------------------------------------------------------------

'use strict';

const SCHEMA = 'readiness-record-1';

// Only these deployment classes exist; public_paid requires 'production'. A
// record observed against preview/staging can never satisfy the production gate.
const DEPLOY_CLASSES = Object.freeze(['production', 'preview', 'staging', 'local']);

// Evidence must be opaque ids + timestamps + counts only. Same banned content
// classes as the rehearsal record: emails, card-like numbers, provider secrets,
// and bearer tokens (a readiness call is authenticated, so a pasted header is a
// realistic leak).
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
const SECRET_RE = /\b(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|rk_(live|test)_[A-Za-z0-9]+)\b/;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/i;
// Full response bodies are not evidence — a record must carry counts, not the
// endpoint payload. Reject anything that smells like a pasted JSON body.
const BODY_RE = /"(checks|signals|outbox|reservations)"\s*:/i;

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // a readiness observation older than 14d is stale.

function isPlainObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

/** A fresh not_run readiness record skeleton for a candidate — owner fills it. */
function emptyRecord(candidateSha) {
  return {
    schema: SCHEMA,
    candidate_sha: candidateSha || null,
    deploy_class: 'production',
    deploy_ref: null,          // opaque deploy id / domain class, NOT a secret URL with creds
    observed_at_utc: null,
    http_status: null,         // expected 200
    ready: null,               // expected true
    blocker_count: null,       // expected 0
    blocker_categories: [],    // stable slugs only, never messages
    operator: null,            // initials / attestation handle, not an email
    attestation: null,         // e.g. "I observed this against the deployed candidate"
  };
}

/**
 * Validate a readiness evidence record. Returns a list of problems ([] = the
 * record can be believed as a clean production-readiness observation). Rejects:
 * wrong schema, candidate mismatch, non-production class (when production is
 * required), stale/missing timestamp, http_status != 200, ready != true,
 * blockers > 0, missing operator attestation, and any PII/secret/full-body
 * content.
 *
 * @param opts.candidateSha   pin the record to this candidate.
 * @param opts.requireProduction  when true, deploy_class must be 'production'.
 * @param opts.now            injectable clock (ms) for deterministic tests.
 */
function validateReadinessRecord(record, { candidateSha, requireProduction = true, now = Date.now() } = {}) {
  const problems = [];
  if (!isPlainObject(record)) return ['readiness record is not an object'];
  if (record.schema !== SCHEMA) problems.push(`unknown record schema: ${JSON.stringify(record.schema)}`);

  if (candidateSha && record.candidate_sha !== candidateSha) {
    problems.push(`record candidate ${record.candidate_sha} does not match the pinned candidate ${candidateSha}`);
  }

  if (!DEPLOY_CLASSES.includes(record.deploy_class)) {
    problems.push(`unknown deploy_class: ${JSON.stringify(record.deploy_class)}`);
  } else if (requireProduction && record.deploy_class !== 'production') {
    problems.push(`deploy_class ${record.deploy_class} cannot satisfy the production-readiness gate`);
  }

  // Timestamp present, parseable and not stale.
  const t = Date.parse(record.observed_at_utc);
  if (!record.observed_at_utc || Number.isNaN(t)) {
    problems.push('observed_at_utc is missing or unparseable');
  } else if (now - t > STALE_AFTER_MS) {
    problems.push('observed_at_utc is stale (older than the readiness freshness window)');
  } else if (t - now > 60 * 60 * 1000) {
    problems.push('observed_at_utc is in the future');
  }

  if (record.http_status !== 200) problems.push(`http_status ${JSON.stringify(record.http_status)} is not 200`);
  if (record.ready !== true) problems.push('ready is not true');

  if (record.blocker_count !== 0) {
    problems.push(`blocker_count ${JSON.stringify(record.blocker_count)} is not 0`);
  }
  if (!Array.isArray(record.blocker_categories)) {
    problems.push('blocker_categories must be an array of slugs');
  } else if (record.blocker_categories.length > 0) {
    problems.push('blocker_categories is non-empty — outstanding blockers cannot be a clean pass');
  }

  if (!record.operator || typeof record.operator !== 'string') problems.push('operator attestation handle is missing');
  if (!record.attestation || typeof record.attestation !== 'string') problems.push('attestation statement is missing');

  // Redaction: no emails, card data, secrets, bearer tokens or full bodies.
  for (const [field, v] of Object.entries(record)) {
    if (typeof v !== 'string') continue;
    if (EMAIL_RE.test(v)) problems.push(`${field} contains an email — evidence must be opaque`);
    if (CARD_RE.test(v)) problems.push(`${field} contains card-like digits`);
    if (SECRET_RE.test(v)) problems.push(`${field} contains a provider secret`);
    if (BEARER_RE.test(v)) problems.push(`${field} contains a bearer token`);
    if (BODY_RE.test(v)) problems.push(`${field} looks like a pasted response body — record counts, not payloads`);
  }

  return problems;
}

module.exports = {
  SCHEMA,
  DEPLOY_CLASSES,
  STALE_AFTER_MS,
  emptyRecord,
  validateReadinessRecord,
};
