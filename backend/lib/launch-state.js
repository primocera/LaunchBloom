// ---------------------------------------------------------------------------
// v11 SC-00 — the canonical launch state.
//
// One machine-checkable record of what is true about a release candidate, so
// two documents can never disagree about it again. Pure functions over a plain
// object: no I/O, no git, no database — the CLI (backend/scripts/launch-state.js)
// supplies observed reality and this module decides what it means.
//
// Two distinct questions, deliberately kept apart:
//
//   integrity — is the manifest itself trustworthy? (vocabulary, evidence
//               pinned to the candidate, declared verdict matches computed)
//   verdict   — given a trustworthy manifest, may we ship?
//
// CI runs the first (deterministic, secret-free, must stay green). The release
// gate runs both. A verdict is never "pass by default": every status outside
// the explicit passing set — including `unknown` — blocks.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 'launch-state-1';

// The full evidence vocabulary. These are NOT interchangeable: `configured`
// means an env var is present, `live_rehearsed` means a human performed the
// action against production, `observed` means it held over time. Collapsing
// them is how a release reads as verified on evidence nobody collected.
const STATUSES = Object.freeze([
  'not_run',
  'skipped',
  'failed',
  'passed_locally',
  'passed_ci',
  // v14 SC-04: a check whose command was actually run against the deployed
  // PRODUCTION environment. Stronger than passed_locally (a laptop run) and
  // distinct from `observed` (a live behaviour that held over time). Recording
  // a production run as passed_locally understates it; recording a laptop run
  // as observed_production overstates it — the two must stay separable.
  'observed_production',
  'configured',
  'live_rehearsed',
  'observed',
  'unknown',
]);

// A required automated check may only count as satisfied by an actual run — a
// local run, a CI run, or a run against the deployed production environment.
const CHECK_PASSING = Object.freeze(['passed_ci', 'passed_locally', 'observed_production']);
// Owner evidence describes the live system; local runs cannot satisfy it. A
// production observation of a check counts here too.
const EVIDENCE_PASSING = Object.freeze(['live_rehearsed', 'observed', 'observed_production']);

const SEVERITIES = Object.freeze(['P0', 'P1', 'P2']);
const BLOCKER_STATUSES = Object.freeze(['open', 'closed', 'accepted']);

// The closed vocabulary of verdicts. Anything outside this set is not a verdict
// this system knows how to defend, so the manifest may not declare it.
//
//   GO              every required condition for the track is actually met.
//   CONDITIONAL GO  no unaccepted blocker remains, but the launch proceeds over
//                   one or more required conditions that are only bypassed by a
//                   valid accepted_risk — never because they were satisfied.
//   NO-GO           at least one required condition is unmet without a valid
//                   scoped acceptance.
const VERDICTS = Object.freeze(['GO', 'CONDITIONAL GO', 'NO-GO']);

// A risk the owner has decided to ship with. This is NOT a way to make a red
// item green: the item keeps its real status everywhere it is displayed, and
// `accepted` is visibly different from `closed`. What it does is let a launch
// proceed on a stated, attributed decision instead of on a quietly edited fact.
//
// It costs something on purpose — a named person, a date and a rationale that
// survives in the record — because a risk nobody is willing to sign is one
// nobody has actually weighed.
const ACCEPTANCE_FIELDS = Object.freeze(['accepted_by', 'accepted_at_utc', 'rationale']);

function acceptanceProblems(kind, id, acc) {
  if (!isPlainObject(acc)) return [`${kind} ${id}: accepted_risk must be an object`];
  const missing = ACCEPTANCE_FIELDS.filter((f) => !acc[f]);
  const out = missing.map((f) => `${kind} ${id}: accepted risk has no ${f}`);
  if (acc.rationale && String(acc.rationale).trim().length < 40) {
    out.push(`${kind} ${id}: accepted risk needs a real rationale, not a placeholder`);
  }
  for (const track of list(acc.tracks)) {
    if (!VERDICT_TRACKS.includes(track)) out.push(`${kind} ${id}: accepted risk names unknown track ${track}`);
  }
  if (!list(acc.tracks).length) out.push(`${kind} ${id}: accepted risk must name the tracks it applies to`);
  return out;
}

/** True when this item's risk has been accepted for `track`. */
function acceptedFor(item, track) {
  const acc = item && item.accepted_risk;
  return isPlainObject(acc) && list(acc.tracks).includes(track);
}
const VERDICT_TRACKS = Object.freeze(['capped_beta', 'public_paid']);

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// --- stale-reference integrity (v14 SC-04) --------------------------------
//
// launch:verify used to validate only the STRUCTURED pins (observed_at_sha ==
// candidate). The free-form evidence/note/closure/verdict prose was invisible
// to it, so a manifest could pin candidate A while every human-readable line
// still named a superseded candidate B — and pass clean. These scanners make
// the prose first-class: any commit-like SHA or Vite bundle hash embedded in
// prose must reconcile with the structured facts, or it is stale.

// Keys whose VALUE is a structured commit pin, not prose. They are the SOURCE
// of sanctioned SHAs and are validated elsewhere (observed_at_sha ==
// candidate), so they are not re-scanned as prose.
const STRUCTURED_SHA_KEYS = Object.freeze(['sha', 'baseline_sha', 'head_at_generation', 'observed_at_sha', 'head_sha', 'run_id']);

// A commit-like token: 7-40 hex chars that contains at least one digit. The
// digit requirement means ordinary all-letter hex words ("defaced", "facade")
// are never mistaken for a SHA, while every short SHA we actually pin — which
// always contains a digit — is still caught.
const SHA_RE = /\b(?=[0-9a-f]{0,39}[0-9])[0-9a-f]{7,40}\b/g;
// A Vite build-hash token as emitted into app/ (index-<hash>).
const BUNDLE_RE = /\bindex-[A-Za-z0-9_-]{6,}\b/g;
// Words that make a "candidate <sha>" mention explicitly historical, so it is
// naming a superseded candidate as history rather than claiming the current one.
const HISTORICAL_QUALIFIERS = new Set(['prior', 'previous', 'old', 'older', 'baseline', 'earlier', 'former', 'superseded', 'original']);

function shaMatches(token, sanctioned) {
  return sanctioned.some((s) => s.startsWith(token) || token.startsWith(s));
}

// The set of Vite build-hash tokens the candidate legitimately ships (the
// build_hash plus each emitted file with its extension stripped).
function bundleHashesOf(candidate) {
  const bundle = isPlainObject(candidate && candidate.bundle) ? candidate.bundle : {};
  const out = [];
  if (typeof bundle.build_hash === 'string') out.push(bundle.build_hash);
  for (const f of list(bundle.files)) if (typeof f === 'string') out.push(f.replace(/\.[a-z0-9]+$/i, ''));
  return out;
}

// Prose that explicitly calls a SHA "the candidate" while a different SHA is
// pinned is the exact "structured candidate A + prose candidate B" drift. A
// historical qualifier ("prior candidate a11afda") is allowed — it names a
// superseded candidate as history, not the current one. Pushes messages via
// `sink`; `seen` dedupes across a whole document.
//
// v24 SV-24-01: while NO candidate is frozen (candidate.sha null — e.g. a new
// code SHA pending its owner RC), ANY unqualified "candidate <sha>" is a claim
// of a current candidate that does not exist, so it is flagged too.
function candidateMentionProblems(str, candidate, seen, sink) {
  const candidateSha = typeof candidate.sha === 'string' ? candidate.sha.toLowerCase() : null;
  // "candidate <sha>" and the labelled form "Candidate to freeze (code): `<sha>`".
  const mentions = [
    // (a `--candidate <sha>` CLI flag inside a documented command is not a claim)
    ...str.matchAll(/(\w+\s+)?(?<!--)candidate\s+([0-9a-f]{7,40})\b/gi),
    ...str.matchAll(/(\w+\s+)?\**candidate\b[^\n:|]{0,40}:\**\s*\**`?([0-9a-f]{7,40})\b/gi),
  ];
  for (const m of mentions) {
    const qualifier = (m[1] || '').trim().replace(/\*/g, '').toLowerCase();
    if (HISTORICAL_QUALIFIERS.has(qualifier)) continue;
    const tok = m[2].toLowerCase();
    if (seen.has(tok)) continue;
    if (!candidateSha) {
      seen.add(tok);
      sink(`names "candidate ${m[2]}" as current but no candidate is frozen (candidate.state ${candidate.state || 'unset'})`);
    } else if (!(candidateSha.startsWith(tok) || tok.startsWith(candidateSha))) {
      seen.add(tok);
      sink(`names "candidate ${m[2]}" but the pinned candidate is ${candidate.sha}`);
    }
  }
}

// A bundle hash in prose that is not the candidate's shipped bundle is stale.
function bundleMentionProblems(str, buildHashes, bundleLabel, seen, sink) {
  if (!buildHashes.length) return;
  for (const m of str.match(BUNDLE_RE) || []) {
    if (!buildHashes.some((h) => h === m || h.startsWith(m) || m.startsWith(h)) && !seen.has(m)) {
      seen.add(m);
      sink(`stale bundle hash "${m}" but the candidate bundle is "${bundleLabel}"`);
    }
  }
}

/** Visit every string value except the structured SHA pins. */
function walkStrings(node, key, visit) {
  if (typeof node === 'string') { if (!STRUCTURED_SHA_KEYS.includes(key)) visit(node); return; }
  if (Array.isArray(node)) { for (const v of node) walkStrings(v, key, visit); return; }
  if (isPlainObject(node)) { for (const k of Object.keys(node)) walkStrings(node[k], k, visit); }
}

// Every SHA that prose is allowed to mention: the candidate, the reviewed
// baseline, the recorded HEAD, each drift commit, and any SHA explicitly
// entered in `historical_shas` with a written label. Anything else is stale.
function sanctionedShas(state) {
  const candidate = isPlainObject(state.candidate) ? state.candidate : {};
  const out = [];
  const add = (s) => { if (typeof s === 'string' && s) out.push(s.toLowerCase()); };
  add(candidate.sha);
  add(candidate.baseline_sha);
  add(candidate.head_at_generation);
  for (const d of list(state.drift_from_baseline)) add(d && d.sha);
  for (const c of list(state.checks)) add(c && c.observed_at_sha);
  for (const h of list(state.historical_shas)) add(h && h.sha);
  // v24: a recorded release-candidate run's head_sha and its numeric run id
  // (an all-digit token the SHA pattern also matches) are structured facts.
  for (const r of list(state.rc_runs)) { add(r && r.head_sha); add(r && r.run_id && String(r.run_id)); }
  return out;
}

function staleReferenceProblems(state) {
  if (!isPlainObject(state)) return [];
  const problems = [];
  const sanctioned = sanctionedShas(state);
  const candidate = isPlainObject(state.candidate) ? state.candidate : {};
  const bundle = isPlainObject(candidate.bundle) ? candidate.bundle : {};
  const buildHashes = [];
  if (typeof bundle.build_hash === 'string') buildHashes.push(bundle.build_hash);
  for (const f of list(bundle.files)) if (typeof f === 'string') buildHashes.push(f.replace(/\.[a-z0-9]+$/i, ''));

  const candidateSha = typeof candidate.sha === 'string' ? candidate.sha.toLowerCase() : null;
  const seenSha = new Set();
  const seenBundle = new Set();
  const seenCandidate = new Set();
  walkStrings(state, null, (str) => {
    // The strongest signal: prose that explicitly calls a SHA "the candidate".
    // A legitimate commit SHA (e.g. a drift commit) is still wrong here if it is
    // named as the candidate while a different SHA is pinned. This is the exact
    // "structured candidate A + prose candidate B" drift SC-04 must reject. A
    // historical qualifier ("prior candidate a11afda") is explicitly allowed —
    // it names a superseded candidate as history, not as the current one.
    for (const m of str.matchAll(/(\w+\s+)?(?<!--)candidate\s+([0-9a-f]{7,40})\b/gi)) {
      const qualifier = (m[1] || '').trim().toLowerCase();
      if (HISTORICAL_QUALIFIERS.has(qualifier)) continue;
      const tok = m[2].toLowerCase();
      if (seenCandidate.has(tok)) continue;
      if (!candidateSha) {
        // v24: nothing is frozen, so an unqualified "candidate <sha>" is a claim
        // of a current candidate that does not exist.
        seenCandidate.add(tok);
        problems.push(`prose names "candidate ${m[2]}" as current but no candidate is frozen (candidate.state ${candidate.state || 'unset'})`);
      } else if (!(candidateSha.startsWith(tok) || tok.startsWith(candidateSha))) {
        seenCandidate.add(tok);
        problems.push(`prose names "candidate ${m[2]}" but the pinned candidate is ${candidate.sha}`);
      }
    }
    for (const m of str.match(SHA_RE) || []) {
      const tok = m.toLowerCase();
      if (!shaMatches(tok, sanctioned) && !seenSha.has(tok)) {
        seenSha.add(tok);
        problems.push(`stale/unsanctioned commit SHA "${m}" appears in prose but is not the candidate, baseline, a drift commit, or a labeled historical SHA`);
      }
    }
    if (buildHashes.length) {
      for (const m of str.match(BUNDLE_RE) || []) {
        if (!buildHashes.some((h) => h === m || h.startsWith(m) || m.startsWith(h)) && !seenBundle.has(m)) {
          seenBundle.add(m);
          problems.push(`stale bundle hash "${m}" appears in prose but the candidate bundle is "${bundle.build_hash || 'unset'}"`);
        }
      }
    }
  });
  return problems;
}

// --- active-document integrity (v15 SC-01) --------------------------------
//
// staleReferenceProblems scans the manifest's OWN prose. But a human can still
// read a contradictory current truth from a hand-authored handoff or a stale
// rendered view that disagrees with the manifest — exactly the OWNER_HANDOFF
// vs launch-state split SC-01 closes. activeDocumentProblems takes the manifest
// plus the text of each allowlisted ACTIVE document (state.active_documents)
// and fails when an active document contradicts the computed truth on: a
// non-historical candidate SHA, a track verdict, an accepted/closed blocker
// re-described as open/unaccepted, the candidate bundle hash, or the canonical
// live-money transition count. Pure: the CLI reads the files and passes text.

const NUMBER_WORDS = Object.freeze({
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen',
});

/** The one canonical live-money transition count everything must agree on. */
function canonicalTransitionCount(state) {
  const r = isPlainObject(state && state.live_money_rehearsal) ? state.live_money_rehearsal : {};
  return Number.isInteger(r.transition_count) ? r.transition_count : null;
}

const normVerdict = (s) => String(s).toUpperCase().replace(/[\s-]+/g, '');
const TRACK_LABEL_RE = Object.freeze({
  capped_beta: 'capped[ _-]?beta',
  public_paid: 'public[ _-]?paid',
});

// --- v24 SV-24-01: a stricter reading of the active documents ---------------
//
// v23 left CERTIFICATION_v23.md claiming an old candidate + CONDITIONAL GO and
// OWNER_CHECKLIST_v23.md carrying NOT RUN step headings under a DONE roll-up —
// and launch:verify only read LAUNCH_STATE.md, so neither was caught. The
// helpers below let the scan read hand-authored certificates and checklists.

// A markdown heading that STARTS with Historical / Superseded opens a section that is
// history, not current truth; it runs to the next heading of the same or a
// higher level. Only the remaining text is held to the current state, so old
// candidates and verdicts can be kept as clearly-labelled history.
const HISTORICAL_HEADING_RE = /^\W*(historical|superseded)\b/i;

function currentText(text) {
  const out = [];
  let skipLevel = 0;
  let inFence = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && HISTORICAL_HEADING_RE.test(h[2])) skipLevel = level;
    }
    if (!skipLevel) out.push(line);
  }
  return out.join('\n');
}

// One owner step may only have ONE status. Its heading ("## 4. … — status: X"),
// a bold status line in its body ("**DONE …"), its evidence-table row (result)
// and its roll-up row must agree: done (DONE/PASSED) vs not done (NOT RUN,
// BLOCKED, PENDING, SUPERSEDED, FAILED). A done step must also cite a redacted
// evidence reference — a docs/evidence/ path or a filled evidence-table ref.
const STEP_OPEN_RE = /\b(NOT RUN|BLOCKED|PENDING|SUPERSEDED|FAILED)\b/;
const STEP_DONE_RE = /\b(DONE|PASSED)\b/;

function stepStatusClass(s) {
  const t = String(s).toUpperCase();
  const open = STEP_OPEN_RE.test(t);
  const done = STEP_DONE_RE.test(t);
  if (open && done) return 'both';
  if (open) return 'open';
  if (done) return 'done';
  return null;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function stepStatusProblems(text) {
  const steps = new Map(); // step number -> { claims: [{source, cls, raw}], evidence: bool }
  const step = (n) => {
    if (!steps.has(n)) steps.set(n, { claims: [], evidence: false });
    return steps.get(n);
  };
  const lines = String(text).split(/\r?\n/);

  // Headings + body status lines + evidence paths inside each step section.
  let current = null;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const m = /^(\d+)\.\s+(.*)$/.exec(h[2]);
      current = m ? m[1] : null;
      if (current) {
        const st = /\bstatus:\s*(.+)$/i.exec(m[2]);
        if (st) step(current).claims.push({ source: 'heading', cls: stepStatusClass(st[1]), raw: st[1].trim() });
      }
      continue;
    }
    if (!current || line.trim().startsWith('|')) continue;
    const body = /^\s*(?:[-*]\s+)?\*\*(DONE|PASSED|NOT RUN|BLOCKED|PENDING|SUPERSEDED|FAILED)\b/i.exec(line);
    if (body) step(current).claims.push({ source: 'body', cls: stepStatusClass(body[1]), raw: body[1] });
    if (/docs\/evidence\/[\w.-]+/.test(line)) step(current).evidence = true;
  }

  // Tables: a roll-up (Step | Status) or an evidence table (… action … | result …).
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((c) => c.toLowerCase());
    const stepCol = header.findIndex((c) => c === 'step');
    const statusCol = header.findIndex((c) => c === 'status');
    const actionCol = header.findIndex((c) => /\baction\b/.test(c));
    const resultCol = header.findIndex((c) => /^result\b/.test(c));
    const refCol = header.findIndex((c) => /evidence ref/.test(c));
    const rollup = stepCol !== -1 && statusCol !== -1;
    const evidence = actionCol !== -1 && resultCol !== -1;
    if (!rollup && !evidence) continue;
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const numCell = rollup ? cells[stepCol] : cells[actionCol];
      const n = /^(\d+)\b/.exec(numCell || '');
      if (!n) continue;
      const cell = rollup ? cells[statusCol] : cells[resultCol];
      step(n[1]).claims.push({ source: rollup ? 'roll-up' : 'evidence table', cls: stepStatusClass(cell), raw: cell });
      if (evidence && refCol !== -1 && stepStatusClass(cell) === 'done' && (cells[refCol] || '').replace(/[—–-]/g, '').trim()) {
        step(n[1]).evidence = true;
      }
      if (rollup && /docs\/evidence\/[\w.-]+/.test(cell || '')) step(n[1]).evidence = true;
    }
  }

  const out = [];
  for (const [n, s] of steps) {
    const both = s.claims.filter((c) => c.cls === 'both');
    for (const c of both) out.push(`step ${n}: its ${c.source} status "${c.raw}" is both done and not done`);
    const done = s.claims.filter((c) => c.cls === 'done');
    const open = s.claims.filter((c) => c.cls === 'open');
    if (done.length && open.length) {
      out.push(`step ${n} is DONE in its ${done.map((c) => c.source).join('/')} but ${open.map((c) => `"${c.raw}"`).join('/')} in its ${open.map((c) => c.source).join('/')}`);
    } else if (done.length && !open.length && !both.length && !s.evidence) {
      out.push(`step ${n} is DONE but cites no redacted evidence reference (a docs/evidence/ path or an evidence-table ref)`);
    }
  }
  return out;
}

// "A–H" is the canonical live-money sequence; a doc describing it as "A–G" or
// "A to F" (or "seven steps") contradicts the one matrix. Only ranges and step
// counts in a rehearsal context are read, so unrelated prose cannot trip it.
const REHEARSAL_CONTEXT_RE = /rehears|sequence|transition|\bsteps?\b|live[- ]money|zaporedj/i;

function stepRangeProblems(text, state) {
  const r = isPlainObject(state.live_money_rehearsal) ? state.live_money_rehearsal : {};
  const ids = list(r.step_ids);
  if (ids.length < 2) return [];
  const first = ids[0];
  const last = ids[ids.length - 1];
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/\b([A-Z])\s*(?:–|—|-|\.\.|to|do)\s*([A-Z])\b/g)) {
    if (m[1] !== first || seen.has(m[0])) continue;
    const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 50);
    if (!REHEARSAL_CONTEXT_RE.test(ctx)) continue;
    if (m[2] !== last) {
      seen.add(m[0]);
      out.push(`describes the live-money sequence as "${m[0]}" but the canonical steps are ${first}–${last} (${ids.length})`);
    }
  }
  const count = canonicalTransitionCount(state);
  if (count != null) {
    const valid = new Set([String(count), NUMBER_WORDS[count]].filter(Boolean));
    const word = `(\\d+|${Object.values(NUMBER_WORDS).join('|')})`;
    for (const m of text.matchAll(new RegExp(`\\b${word}\\s+(?:ordered\\s+)?(?:live[- ]money\\s+)?(?:rehearsal\\s+)?(?:steps|transitions)\\b`, 'gi'))) {
      const tok = m[1].toLowerCase();
      const ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      if (!/rehears|A\s*[–—-]\s*H|live[- ]money/i.test(ctx)) continue;
      if (!valid.has(tok) && !seen.has(tok)) {
        seen.add(tok);
        out.push(`says "${m[0]}" but the canonical live-money rehearsal has ${count} steps (${first}–${last})`);
      }
    }
  }
  return out;
}

// What a document claims about each blocker: the first open/closed/resolved
// word on the same line within ~100 chars after the blocker id.
function blockerClaims(text, blockers) {
  const claims = new Map();
  for (const b of blockers) {
    if (!b || !b.id) continue;
    let i = text.indexOf(b.id);
    while (i !== -1) {
      const after = text.slice(i + b.id.length, i + b.id.length + 100).split(/\r?\n/)[0];
      const m = /\b(closed|resolved|open)\b/i.exec(after);
      if (m) {
        const claim = /open/i.test(m[1]) ? 'open' : 'closed';
        if (!claims.has(b.id)) claims.set(b.id, new Set());
        claims.get(b.id).add(claim);
      }
      i = text.indexOf(b.id, i + b.id.length);
    }
  }
  return claims;
}

function activeDocumentProblems(state, docs) {
  if (!isPlainObject(state)) return [];
  const out = [];
  const docClaims = []; // [{ path, claims }] for the cross-document blocker check
  const candidate = isPlainObject(state.candidate) ? state.candidate : {};
  const bundle = isPlainObject(candidate.bundle) ? candidate.bundle : {};
  const bundleLabel = bundle.build_hash || 'unset';
  const buildHashes = bundleHashesOf(candidate);
  const computed = computeVerdicts(state);
  const txCount = canonicalTransitionCount(state);
  const acceptedBlockers = list(state.blockers).filter((b) => b && (b.status === 'accepted' || b.status === 'closed'));

  for (const doc of list(docs)) {
    if (!doc || typeof doc.text !== 'string') continue;
    // v24: clearly-labelled Historical / Superseded sections are history, not
    // current truth, so only the rest of the document is held to the manifest.
    const text = currentText(doc.text);
    const where = `active doc ${doc.path}: `;
    const push = (m) => out.push(where + m);

    // v24 — one status per owner step; a done step cites evidence.
    for (const p of stepStatusProblems(text)) push(p);
    // v24 — the A–H range / step count matches the canonical matrix.
    for (const p of stepRangeProblems(text, state)) push(p);
    // v24 — blocker open/closed claims agree with the manifest (and, below,
    // with every other active document).
    const claims = blockerClaims(text, list(state.blockers));
    docClaims.push({ path: doc.path, claims });
    for (const b of list(state.blockers)) {
      const c = claims.get(b.id);
      if (!c) continue;
      if (c.has('closed') && b.status === 'open') push(`describes blocker ${b.id} as closed, but the manifest records it as open`);
      if (c.has('open') && b.status === 'closed') push(`describes blocker ${b.id} as open, but the manifest records it as closed`);
    }

    // 1 + 4 — candidate SHA and bundle hash contradictions (reuse the manifest
    // scanners against the document text).
    candidateMentionProblems(text, candidate, new Set(), push);
    bundleMentionProblems(text, buildHashes, bundleLabel, new Set(), push);

    // 2 — verdict contradiction. Match the "Label: VERDICT" idiom (handles
    // markdown bold and an optional "launch"); the generated table/legend prose
    // uses other separators and is not matched, so it cannot false-positive.
    for (const track of VERDICT_TRACKS) {
      const want = computed[track].verdict;
      // Match the "Label: VERDICT" idiom, tolerating markdown bold on either
      // side of the separator ("**Public paid:** **NO-GO**"). A separator is
      // required, so the generated table ("| Public paid launch | **GO** |")
      // and the legend prose cannot false-positive.
      // v24: the table-cell form ("| **public_paid** | **CONDITIONAL GO** |")
      // counts too — v23's certificate stated a stale verdict exactly that way
      // and slipped past the scan. The rendered table carries the computed
      // verdict, so it still agrees.
      const re = new RegExp(`\\b(?:${TRACK_LABEL_RE[track]})\\b(?:\\s+launch)?[\\s*]*(?:[:—-]|\\|)[\\s*|]*(CONDITIONAL GO|NO[- ]GO|GO)\\b`, 'ig');
      for (const m of text.matchAll(re)) {
        if (normVerdict(m[1]) !== normVerdict(want)) {
          push(`states ${track} = "${m[1]}" but the computed verdict is "${want}"`);
        }
      }
    }

    // 3 — an accepted/closed blocker re-described as open/unaccepted. Scoped:
    // the blocker's stable id or GHSA code must appear near a negation, so the
    // legitimate "accepted, not closed" wording of an accepted risk is allowed.
    for (const b of acceptedBlockers) {
      const ids = [b.id, ...(String(b.title || '').match(/GHSA-[\w-]+/gi) || [])].filter(Boolean);
      for (const id of ids) {
        let i = text.indexOf(id);
        while (i !== -1) {
          const window = text.slice(Math.max(0, i - 220), i + id.length + 220);
          if (/\bneither accepted nor closed\b/i.test(window)
              || /\bnot (?:yet |been )?accepted\b/i.test(window)
              || /\brisk is not accepted\b/i.test(window)
              || (b.status === 'accepted' && /\bstill (?:open|unaccepted)\b/i.test(window))) {
            push(`describes blocker ${b.id} as not accepted/open, but the manifest records it as ${b.status}`);
            break;
          }
          i = text.indexOf(id, i + id.length);
        }
      }
    }

    // 5 — inconsistent transition count. Any "<n>-transition" or "<word>-transition"
    // token that is not the canonical count contradicts the one live-money matrix.
    if (txCount != null) {
      const valid = new Set([String(txCount), NUMBER_WORDS[txCount]].filter(Boolean));
      const seenTx = new Set();
      for (const m of text.matchAll(/\b([a-z]+|\d+)-transition\b/gi)) {
        const tok = m[1].toLowerCase();
        if (!valid.has(tok) && !seenTx.has(tok)) {
          seenTx.add(tok);
          push(`says "${m[1]}-transition" but the canonical live-money rehearsal has ${txCount} transitions (${NUMBER_WORDS[txCount]})`);
        }
      }
    }
  }

  // v24 — cross-document: a blocker one active document calls open may not be
  // called closed by another.
  for (const b of list(state.blockers)) {
    const openIn = docClaims.filter((d) => d.claims.get(b.id) && d.claims.get(b.id).has('open')).map((d) => d.path);
    const closedIn = docClaims.filter((d) => d.claims.get(b.id) && d.claims.get(b.id).has('closed')).map((d) => d.path);
    const conflict = openIn.filter((p) => !closedIn.includes(p)).length && closedIn.filter((p) => !openIn.includes(p)).length;
    if (conflict) {
      out.push(`active docs disagree on blocker ${b.id}: open in ${openIn.join(', ')} but closed in ${closedIn.join(', ')}`);
    }
  }
  return out;
}

// --- AI-agent entry documents (SC-95-02) ----------------------------------
//
// README.md, CLAUDE.md and the prompt-pack scope note are the highest-traffic
// documents a coding agent reads as CURRENT TRUTH, yet they are hand-authored
// prose that carries no candidate SHA or bundle, so the activeDocumentProblems
// scanner (built for generated/handoff docs) does not police them. They drift
// in a distinct way: they teach a retired architecture, claim a track is open
// when its verdict is not a full GO, or repeat a resolved risk. This scanner
// fails release verification on exactly those drifts. Pure: the CLI reads the
// files and passes their text.

// Markers of the retired stateless-HMAC / no-Supabase-Auth identity model. The
// code uses Supabase Auth + HttpOnly cookies + a stable user UUID; a doc that
// still teaches the old model would make a coding agent regress it.
const RETIRED_AUTH_MARKERS = Object.freeze([
  /no supabase auth/i,
  /stateless hmac session token/i,
  /the session email is the identity/i,
  /\bemail\|exp\b/i,
]);

function agentDocumentProblems(state, docs) {
  if (!isPlainObject(state)) return [];
  const out = [];
  const computed = computeVerdicts(state);
  const txCount = canonicalTransitionCount(state);
  const publicPaidIsFullGo = normVerdict(computed.public_paid.verdict) === 'GO';
  // Closed blockers carry an optional list of subject phrases a doc must not
  // re-describe as an open/accepted risk (e.g. the resolved hero-contrast item).
  const closedSubjects = list(state.blockers)
    .filter((b) => b && b.status === 'closed' && Array.isArray(b.resolved_subject_markers))
    .flatMap((b) => b.resolved_subject_markers.map((m) => ({ id: b.id, marker: String(m) })));

  for (const doc of list(docs)) {
    if (!doc || typeof doc.text !== 'string') continue;
    const text = doc.text;
    const push = (m) => out.push(`agent doc ${doc.path}: ${m}`);

    // (a) retired auth model.
    for (const re of RETIRED_AUTH_MARKERS) {
      if (re.test(text)) push(`teaches the retired auth model (/${re.source}/); the code uses Supabase Auth + HttpOnly cookies + a stable user UUID`);
    }

    // (b) a launch track claimed open/live when its computed verdict is not a
    // full GO. Only fires while public_paid is below GO, so a real future GO
    // does not false-positive.
    if (!publicPaidIsFullGo) {
      const re = /public[ _-]?paid[^.\n]{0,48}?\b(?:is\s+)?(?:open|live|launched|available to everyone)\b/ig;
      const m = re.exec(text);
      if (m) push(`claims public paid is open/live ("${m[0].trim()}") but the computed public_paid verdict is "${computed.public_paid.verdict}"`);
    }

    // (c) a transition count other than the one canonical live-money count.
    if (txCount != null) {
      const valid = new Set([String(txCount), NUMBER_WORDS[txCount]].filter(Boolean));
      const seen = new Set();
      for (const m of text.matchAll(/\b([a-z]+|\d+)-transition\b/gi)) {
        const tok = m[1].toLowerCase();
        if (!valid.has(tok) && !seen.has(tok)) {
          seen.add(tok);
          push(`says "${m[1]}-transition" but the canonical live-money rehearsal has ${txCount} (${NUMBER_WORDS[txCount]})`);
        }
      }
    }

    // (d) a resolved blocker's subject re-described as an outstanding risk.
    for (const { id, marker } of closedSubjects) {
      if (new RegExp(marker, 'i').test(text)) {
        push(`repeats "${marker}" as an outstanding risk, but blocker ${id} is closed`);
      }
    }
  }
  return out;
}

// --- accepted-risk review dates (v15 SC-05) -------------------------------
//
// An accepted risk that can never expire quietly becomes permanent. When an
// accepted_risk carries a `review_by` date, release verification fails once that
// date passes without the owner re-affirming it — so the router advisory (and
// any other dated acceptance) cannot silently outlive its rationale.

function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Problems from accepted risks whose review date has passed (or is malformed).
 * `now` is injected so the check is deterministic in tests. Pure.
 */
function reviewProblems(state, now = Date.now()) {
  const problems = [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const consider = (kind, id, acc) => {
    if (!isPlainObject(acc) || acc.review_by == null) return;
    const due = parseDate(acc.review_by);
    if (due == null) { problems.push(`${kind} ${id}: accepted risk has an unparseable review_by (${JSON.stringify(acc.review_by)})`); return; }
    if (nowMs >= due) {
      problems.push(`${kind} ${id}: accepted risk is past its review_by (${acc.review_by}) — re-affirm with a new date or resolve it`);
    }
  };
  for (const b of list(state.blockers)) if (b && b.status === 'accepted') consider('blocker', b.id, b.accepted_risk);
  for (const c of list(state.checks)) if (c && c.accepted_risk) consider('check', c.id, c.accepted_risk);
  for (const e of list(state.owner_evidence)) if (e && e.accepted_risk) consider('evidence', e.id, e.accepted_risk);
  return problems;
}

// --- release-candidate provenance (v24 SV-24-01 C) ------------------------
//
// "The release-candidate workflow was green" is not evidence. A CI claim is
// only as good as the GitHub Actions run behind it, and a run proves only the
// commit in its head_sha — never an ancestor or a docs-only descendant. Each
// run the manifest relies on is recorded in `rc_runs` with its URL, head_sha,
// conclusion, times and job results, and:
//   - a check may claim passed_ci at SHA X only if a recorded run with
//     head_sha X is green on every required job;
//   - a FROZEN candidate needs such a run at its own exact SHA.
// A candidate that is pending its owner RC has no SHA at all (state
// pending_owner_rc): the RC run + its SHA-named artifacts freeze it, so a later
// manifest-only commit never has to name itself (the self-reference loop).

const CANDIDATE_STATES = Object.freeze(['frozen', 'pending_owner_rc']);
const RC_REQUIRED_JOBS = Object.freeze(['candidate-gate', 'authenticated-e2e']);
const RC_CONCLUSIONS = Object.freeze(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale']);
const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;

/** True when `runs` holds a green RC run at exactly `sha` with every required job green. */
function greenRcRunAt(runs, sha) {
  if (!sha) return false;
  return list(runs).some((r) => r && r.head_sha === sha && r.conclusion === 'success'
    && RC_REQUIRED_JOBS.every((name) => list(r.jobs).some((j) => j && j.name === name && j.conclusion === 'success')));
}

function rcProvenanceProblems(state) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const candidate = isPlainObject(state.candidate) ? state.candidate : {};
  const runs = list(state.rc_runs);
  const repo = typeof state.repository === 'string' ? state.repository : null;

  if (candidate.state != null && !CANDIDATE_STATES.includes(candidate.state)) {
    bad(`candidate.state must be one of ${CANDIDATE_STATES.join(', ')} (found ${JSON.stringify(candidate.state)})`);
  }
  if (candidate.state === 'frozen' && !candidate.sha) bad('candidate.state is frozen but candidate.sha is null');
  if (candidate.state === 'pending_owner_rc' && candidate.sha) {
    bad('candidate.state is pending_owner_rc but candidate.sha is set — a pending candidate is frozen by its RC run, not named in advance');
  }

  const ids = new Set();
  for (const r of runs) {
    if (!isPlainObject(r)) { bad('an rc_runs entry is not an object'); continue; }
    const id = r.run_id;
    const where = `rc_runs ${id || '?'}`;
    if (!id || !/^\d+$/.test(String(id))) bad(`${where}: run_id must be the numeric GitHub Actions run id`);
    if (ids.has(String(id))) bad(`${where}: duplicate run`);
    ids.add(String(id));
    const urlRe = new RegExp(`^https://github\\.com/${repo ? repo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : '[^/]+/[^/]+'}/actions/runs/${id}$`);
    if (!urlRe.test(String(r.url || ''))) bad(`${where}: url must be the concrete run URL https://github.com/${repo || '<repo>'}/actions/runs/${id}`);
    if (!FULL_SHA_RE.test(String(r.head_sha || ''))) bad(`${where}: head_sha must be the full 40-char commit the run executed`);
    if (!RC_CONCLUSIONS.includes(r.conclusion)) bad(`${where}: unknown conclusion ${JSON.stringify(r.conclusion)}`);
    if (!ISO_UTC_RE.test(String(r.created_at_utc || ''))) bad(`${where}: created_at_utc must be an ISO UTC time`);
    if (!ISO_UTC_RE.test(String(r.completed_at_utc || ''))) bad(`${where}: completed_at_utc must be an ISO UTC time`);
    if (!list(r.jobs).length) bad(`${where}: must list the jobs and their conclusions`);
    for (const j of list(r.jobs)) {
      if (!j || !j.name || !RC_CONCLUSIONS.includes(j.conclusion)) bad(`${where}: every job needs a name and a known conclusion`);
    }
    if (r.conclusion === 'success') {
      for (const name of RC_REQUIRED_JOBS) {
        const job = list(r.jobs).find((j) => j && j.name === name);
        if (!job || job.conclusion !== 'success') bad(`${where}: conclusion success but required job ${name} is ${job ? job.conclusion : 'missing'}`);
      }
    }
  }

  for (const c of list(state.checks)) {
    if (c && c.status === 'passed_ci' && !greenRcRunAt(runs, c.observed_at_sha)) {
      bad(`check ${c.id}: claims passed_ci at ${c.observed_at_sha || 'no SHA'} but no recorded green release-candidate run has that exact head_sha`);
    }
  }
  if (candidate.sha && candidate.state === 'frozen' && !greenRcRunAt(runs, candidate.sha)) {
    bad(`candidate ${candidate.sha} is frozen but no recorded green release-candidate run (jobs ${RC_REQUIRED_JOBS.join(' + ')}) has head_sha equal to it`);
  }
  return problems;
}

// --- integrity ------------------------------------------------------------

// Structural problems that make the manifest untrustworthy as a source of
// truth. Returns [] when the document can be believed — which says nothing
// about whether the release may ship.
function integrityProblems(state) {
  const problems = [];
  const bad = (msg) => problems.push(msg);

  if (!isPlainObject(state)) return ['launch state is not an object'];
  if (state.schema_version !== SCHEMA_VERSION) {
    bad(`schema_version must be "${SCHEMA_VERSION}" (found ${JSON.stringify(state.schema_version)})`);
  }

  const candidate = isPlainObject(state.candidate) ? state.candidate : null;
  if (!candidate) bad('candidate block missing');
  const sha = candidate && typeof candidate.sha === 'string' ? candidate.sha : null;

  // Every claim must be expressible in the shared vocabulary, or the
  // distinctions the vocabulary exists to preserve are gone.
  const checkIds = new Set();
  for (const c of list(state.checks)) {
    const id = c && c.id;
    if (!id) { bad('a check has no id'); continue; }
    if (checkIds.has(id)) bad(`duplicate check id: ${id}`);
    checkIds.add(id);
    if (!STATUSES.includes(c.status)) bad(`check ${id}: unknown status ${JSON.stringify(c.status)}`);
    if (typeof c.required !== 'boolean') bad(`check ${id}: required must be a boolean`);
    if (c.accepted_risk) for (const p of acceptanceProblems('check', id, c.accepted_risk)) bad(p);
    for (const track of list(c.required_for)) {
      if (!VERDICT_TRACKS.includes(track)) bad(`check ${id}: unknown verdict track ${track}`);
    }
    // Scoping a check to fewer tracks is a risk decision, so it must be argued
    // in writing next to the check itself.
    if (list(c.required_for).length && list(c.required_for).length < VERDICT_TRACKS.length && !c.scope_rationale) {
      bad(`check ${id}: required_for narrows the tracks but gives no scope_rationale`);
    }

    if (CHECK_PASSING.includes(c.status)) {
      // A pass with nothing behind it is a headline, not evidence.
      if (!c.evidence) bad(`check ${id}: claims ${c.status} but carries no evidence reference`);
      if (!c.observed_at_sha) bad(`check ${id}: claims ${c.status} but is not pinned to a SHA`);
      else if (sha && c.observed_at_sha !== sha) {
        bad(`check ${id}: evidence is from ${c.observed_at_sha}, candidate is ${sha}`);
      }
    }
  }

  const evidenceIds = new Set();
  for (const e of list(state.owner_evidence)) {
    const id = e && e.id;
    if (!id) { bad('an owner evidence item has no id'); continue; }
    if (evidenceIds.has(id)) bad(`duplicate owner evidence id: ${id}`);
    evidenceIds.add(id);
    if (!STATUSES.includes(e.status)) bad(`evidence ${id}: unknown status ${JSON.stringify(e.status)}`);
    if (e.accepted_risk) for (const p of acceptanceProblems('evidence', id, e.accepted_risk)) bad(p);
    if (EVIDENCE_PASSING.includes(e.status) && !e.evidence_ref) {
      bad(`evidence ${id}: claims ${e.status} but carries no evidence reference`);
    }
    for (const track of list(e.required_for)) {
      if (!VERDICT_TRACKS.includes(track)) bad(`evidence ${id}: unknown verdict track ${track}`);
    }
  }

  for (const b of list(state.blockers)) {
    if (!b || !b.id) { bad('a blocker has no id'); continue; }
    if (!SEVERITIES.includes(b.severity)) bad(`blocker ${b.id}: unknown severity ${JSON.stringify(b.severity)}`);
    if (!BLOCKER_STATUSES.includes(b.status)) bad(`blocker ${b.id}: status must be one of ${BLOCKER_STATUSES.join(', ')}`);
    if (b.status === 'accepted') for (const p of acceptanceProblems('blocker', b.id, b.accepted_risk)) bad(p);
  }

  const mig = isPlainObject(state.migrations) ? state.migrations : null;
  if (!mig) bad('migrations block missing');
  else {
    const av = isPlainObject(mig.applied_verification) ? mig.applied_verification : null;
    if (!av) bad('migrations.applied_verification missing');
    else {
      if (!STATUSES.includes(av.status)) bad(`migrations.applied_verification: unknown status ${JSON.stringify(av.status)}`);
      // Applied-ness is a property of a database, so it may only be claimed
      // from a run against one — never inferred from files in the repository.
      if (EVIDENCE_PASSING.includes(av.status)) {
        if (!av.source) bad('migrations.applied_verification: claims verification with no source');
        if (!av.last_run_utc) bad('migrations.applied_verification: claims verification with no run timestamp');
      }
    }

    // v23 SV-23-03: the Stripe-ownership enforcement cross-field invariant. The
    // manifest may NOT simultaneously assert enforcement is active / paid-ready
    // and leave the enabling migrations (038-040) unproven. `applied_verification`
    // above covers the base 001-037 schema; enforcement rests on 038-040 PLUS a
    // live stripe_ownership_uniqueness_ready() probe, which is a distinct fact
    // that must be recorded on its own — never inferred from prose that says
    // "enforcement_active".
    const oe = isPlainObject(mig.ownership_enforcement) ? mig.ownership_enforcement : null;
    if (oe) {
      const MIG_STATES = ['pending', 'unverified', 'applied_verified'];
      const PROBE_STATES = ['not_run', 'true', 'false'];
      if (!MIG_STATES.includes(oe.migrations_038_040)) {
        bad(`migrations.ownership_enforcement.migrations_038_040 must be one of ${MIG_STATES.join(', ')}`);
      }
      if (!PROBE_STATES.includes(oe.uniqueness_probe)) {
        bad(`migrations.ownership_enforcement.uniqueness_probe must be one of ${PROBE_STATES.join(', ')}`);
      }
      if (typeof oe.claimed_enforcement_active !== 'boolean') bad('migrations.ownership_enforcement.claimed_enforcement_active must be a boolean');
      if (typeof oe.claimed_paid_ready !== 'boolean') bad('migrations.ownership_enforcement.claimed_paid_ready must be a boolean');

      const claimsEnforcement = oe.claimed_enforcement_active === true || oe.claimed_paid_ready === true;
      if (claimsEnforcement && oe.migrations_038_040 !== 'applied_verified') {
        bad('migrations.ownership_enforcement claims enforcement_active/paid_ready but migrations 038-040 are not applied_verified — the launch state cannot assert Stripe ownership enforcement while its enabling migrations are pending/unverified');
      }
      if (oe.claimed_enforcement_active === true && oe.uniqueness_probe !== 'true') {
        bad('migrations.ownership_enforcement claims enforcement_active but stripe_ownership_uniqueness_ready() is not recorded true (the exact ON CONFLICT arbiter probe must be observed, not inferred)');
      }
      if (oe.migrations_038_040 === 'applied_verified' && !oe.owner_probe_ref) {
        bad('migrations.ownership_enforcement says 038-040 applied_verified but cites no owner_probe_ref — a machine-readable owner probe is required to claim applied-ness');
      }
    }
  }

  // The declared verdict is recomputed from the same data; a mismatch means
  // someone edited the conclusion without editing the facts.
  const computed = computeVerdicts(state);
  for (const track of VERDICT_TRACKS) {
    const declared = isPlainObject(state.verdicts) ? state.verdicts[track] : null;
    if (!isPlainObject(declared)) { bad(`verdicts.${track} missing`); continue; }
    if (!VERDICTS.includes(declared.verdict)) {
      bad(`verdicts.${track}: unknown verdict ${JSON.stringify(declared.verdict)} (must be one of ${VERDICTS.join(', ')})`);
    } else if (declared.verdict !== computed[track].verdict) {
      bad(`verdicts.${track}: declared ${declared.verdict}, computed ${computed[track].verdict}`);
    }
  }

  // v14 SC-04: prose that names a superseded candidate, or a bundle hash that
  // is not the candidate's, makes the document lie even when every structured
  // pin is correct. Treat those references as first-class integrity failures.
  for (const p of staleReferenceProblems(state)) bad(p);

  // v24 SV-24-01: every CI claim and every frozen candidate is backed by a
  // recorded GitHub Actions run at that exact SHA.
  for (const p of rcProvenanceProblems(state)) bad(p);

  return problems;
}

// --- verdict --------------------------------------------------------------

// One accepted-risk entry as it will be reported back to the caller. The item
// keeps its real status — a check that is `skipped` still reads `skipped` here.
// `risk_id` is what makes two records the same logical risk: the P0 blocker and
// the check that measures it are one risk seen from two places, and must be
// counted once.
function acceptedEntry(kind, item) {
  const acc = (item && item.accepted_risk) || {};
  return {
    risk_id: acc.risk_id || `${kind}:${item.id}`,
    kind,
    id: item.id,
    status: item.status,
    severity: item.severity || null,
    title: item.title || item.name || null,
    owner: item.owner || null,
    closure: item.closure || null,
    accepted_by: acc.accepted_by || null,
  };
}

// Fold entries that describe the same logical risk into one. A blocker is the
// canonical face of a risk (it carries the owner and the closure requirement),
// so it wins as the representative; the check and evidence that measure the same
// risk are recorded as additional sources rather than as separate risks.
const RISK_KIND_RANK = Object.freeze({ blocker: 0, check: 1, evidence: 2 });
function dedupeRisks(entries) {
  const byId = new Map();
  for (const e of entries) {
    const ref = `${e.kind}:${e.id}`;
    const cur = byId.get(e.risk_id);
    if (!cur) { byId.set(e.risk_id, { ...e, sources: [ref] }); continue; }
    const sources = cur.sources.includes(ref) ? cur.sources : [...cur.sources, ref];
    if (RISK_KIND_RANK[e.kind] < RISK_KIND_RANK[cur.kind]) {
      byId.set(e.risk_id, { ...e, sources });
    } else {
      cur.sources = sources;
    }
  }
  return [...byId.values()];
}

// Deterministic GO / CONDITIONAL GO / NO-GO per track, with the exact reasons
// and the accepted risks the verdict rests on. Capped beta and an unrestricted
// public paid launch are different risk decisions, so they are computed
// separately and never share a conclusion.
function computeVerdicts(state, observed = {}) {
  const candidate = isPlainObject(state && state.candidate) ? state.candidate : {};
  const checks = list(state && state.checks);
  const evidence = list(state && state.owner_evidence);
  const blockers = list(state && state.blockers);
  const mig = isPlainObject(state && state.migrations) ? state.migrations : {};
  const applied = isPlainObject(mig.applied_verification) ? mig.applied_verification : {};

  const shared = [];

  if (!candidate.sha) {
    shared.push(`no release candidate is pinned (candidate.sha is null${candidate.state ? `; state ${candidate.state}` : ''})`);
  } else if (observed.head_sha && observed.head_sha !== candidate.sha) {
    // A later commit invalidates evidence — but only if it could change what
    // the evidence describes. Recording the evidence is itself a commit, so
    // treating every commit as invalidating made a fully-evidenced release
    // unreachable: the act of writing down a GO produced a NO-GO.
    //
    // `code_changes` is supplied by the CLI (git). `undefined` means nobody
    // looked, and `null` means git could not answer — both fall back to the
    // strict rule, because unknown never means safe.
    const codeChanges = observed.code_changes;
    if (Array.isArray(codeChanges) && codeChanges.length === 0) {
      // Documentation-only drift. Evidence still describes the shipped code.
    } else if (Array.isArray(codeChanges)) {
      shared.push(
        `candidate ${candidate.sha} is stale: ${codeChanges.length} code file(s) changed since it was pinned `
        + `(${codeChanges.slice(0, 3).join(', ')}${codeChanges.length > 3 ? ', …' : ''})`,
      );
    } else {
      shared.push(`candidate ${candidate.sha} is stale: HEAD is ${observed.head_sha}`);
    }
  }

  if (!EVIDENCE_PASSING.includes(applied.status)) {
    shared.push(`migrations applied-state is ${applied.status || 'unknown'} (must be verified against the database)`);
  }

  const blocking = blockers.filter((b) => b.severity === 'P0' || b.severity === 'P1');

  const out = {};
  for (const track of VERDICT_TRACKS) {
    const reasons = [...shared];
    // Accepted required conditions bypassed for this track. These never satisfy
    // a condition — they record that the launch proceeds *over* an unmet one.
    // A non-empty list is exactly what separates CONDITIONAL GO from GO.
    const acceptedRaw = [];
    // A required check may be required for both tracks (the default, and what
    // `required: true` alone means) or scoped with `required_for`. Some proof
    // is genuinely a public-launch condition rather than a beta one: a
    // supervised cohort of invited accounts with a named owner watching is a
    // different risk than strangers arriving unannounced. Scoping is a stated
    // decision recorded in the check's note — it is not a way to make a red
    // check disappear, and a check with no `required_for` still blocks both.
    for (const b of blocking) {
      // A P1 is not a capped-beta condition; it only bears on the public launch.
      if (track === 'capped_beta' && b.severity === 'P1') continue;
      if (b.status === 'closed') continue;
      if (b.status === 'accepted') {
        if (acceptedFor(b, track)) acceptedRaw.push(acceptedEntry('blocker', b));
        continue;
      }
      // status === 'open'
      if (acceptedFor(b, track)) { acceptedRaw.push(acceptedEntry('blocker', b)); continue; }
      reasons.push(`open ${b.severity}: ${b.id}`);
    }
    for (const c of checks) {
      if (!c.required) continue;
      const scope = list(c.required_for);
      if (scope.length && !scope.includes(track)) continue;
      if (CHECK_PASSING.includes(c.status)) continue;
      if (acceptedFor(c, track)) { acceptedRaw.push(acceptedEntry('check', c)); continue; }
      reasons.push(`required check ${c.id} is ${c.status}`);
    }
    for (const e of evidence) {
      if (!list(e.required_for).includes(track)) continue;
      if (EVIDENCE_PASSING.includes(e.status)) continue;
      if (acceptedFor(e, track)) { acceptedRaw.push(acceptedEntry('evidence', e)); continue; }
      reasons.push(`owner evidence ${e.id} is ${e.status}`);
    }

    const accepted_risks = dedupeRisks(acceptedRaw);
    let verdict;
    if (reasons.length) verdict = 'NO-GO';
    else if (accepted_risks.length) verdict = 'CONDITIONAL GO';
    else verdict = 'GO';
    out[track] = { verdict, reasons, accepted_risks };
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  BLOCKER_STATUSES,
  acceptedFor,
  STATUSES,
  CHECK_PASSING,
  EVIDENCE_PASSING,
  SEVERITIES,
  VERDICTS,
  VERDICT_TRACKS,
  integrityProblems,
  staleReferenceProblems,
  activeDocumentProblems,
  agentDocumentProblems,
  currentText,
  stepStatusProblems,
  stepRangeProblems,
  rcProvenanceProblems,
  greenRcRunAt,
  CANDIDATE_STATES,
  RC_REQUIRED_JOBS,
  canonicalTransitionCount,
  reviewProblems,
  computeVerdicts,
};
