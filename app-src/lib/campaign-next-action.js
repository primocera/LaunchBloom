// ---------------------------------------------------------------------------
// v9 SC-02: one deterministic, rule-versioned campaign next-action + readiness
// service, shared by the Dashboard campaigns card and the Campaign Overview so
// the SAME campaign state always yields the SAME next action and reasons.
//
// Pure functions, no imports of React or the network. It never invents
// deadlines, urgency or a 0–100 score, never persists a second readiness state
// (everything is derived from canonical rows), and only claims "ready" when the
// exact scoped condition is true.
//
//   campaignSummary(campaign, review?) → canonical inputs (review optional)
//   campaignNextAction(summary)        → the single next action
//   readinessGroups(summary)           → Brief / Deliverables / Review / Handoff
//
// Priority (locked by tests): incomplete core brief → approval required →
// choose a plan → required deliverable missing → stale required asset →
// unresolved high finding → required asset Needs review → evidence reminder →
// handoff/export. Optional deliverables never block completion.
// ---------------------------------------------------------------------------

import { missingDecisions, totalAssets, sectionPath } from '../routes/campaign/shared.js';
import { missingRequiredDeliverables, DELIVERABLE_TABLE } from './next-actions.js';

export const NEXT_ACTION_RULES_VERSION = 'cna-1';

const REQUIRED_TABLES = (plan) => new Set(
  (plan || [])
    .filter((r) => r.requirement_state === 'required')
    .map((r) => DELIVERABLE_TABLE[r.deliverable_code]?.[0])
    .filter(Boolean),
);

/**
 * Build canonical, review-agnostic inputs from the campaign list payload
 * (campaign + asset_counts + deliverable_plan) and, when available, the review
 * queue. When `review` is omitted the review-derived signals are marked
 * `evaluated: false` — the selector then routes to Review rather than asserting
 * an unseen blocker or a false "ready to export".
 */
export function campaignSummary(campaign, review) {
  const c = campaign || {};
  const plan = c.deliverable_plan || [];
  const requiredTables = REQUIRED_TABLES(plan);
  const requiredMissing = missingRequiredDeliverables(c); // [{table,label}]

  let reviewSummary = { evaluated: false };
  if (review) {
    const staleRequired = (review.stale || [])
      .filter((a) => requiredTables.has(a.table));
    const needsReviewRequired = (review.needs_review_assets || [])
      .filter((a) => requiredTables.has(a.table));
    reviewSummary = {
      evaluated: true,
      highFindings: (review.blocking || []).length,
      staleRequired: staleRequired.length,
      needsReviewRequired: needsReviewRequired.length,
      evidenceReminders: (review.evidence_reminders || []).length,
    };
  }

  return {
    rules_version: NEXT_ACTION_RULES_VERSION,
    id: c.id,
    name: c.name || 'this campaign',
    brief: {
      missing: missingDecisions(c).map(([, label]) => label),
      approved: !!c.brief_approved,
    },
    deliverables: {
      hasPlan: plan.length > 0,
      requiredTotal: plan.filter((r) => r.requirement_state === 'required').length,
      requiredMissing, // required deliverables with no asset yet
    },
    assets: totalAssets(c),
    review: reviewSummary,
  };
}

const at = (summary, section) => sectionPath(summary.id, section);

/**
 * The single trustworthy next action. Output is honest about cost: no step in
 * the chain itself spends an AI action (generation happens later, on Create,
 * and is disclosed there), so `spends_ai_action` is always false here.
 */
export function campaignNextAction(summary) {
  const s = summary;
  const base = { rules_version: NEXT_ACTION_RULES_VERSION, spends_ai_action: false };

  // 1 · incomplete core brief (hard blocker)
  if (s.brief.missing.length) {
    return {
      ...base, action_code: 'brief_incomplete', severity: 'blocker',
      label: 'Complete the campaign brief', destination: at(s, 'brief'),
      reason: `${s.brief.missing.length} required decision${s.brief.missing.length === 1 ? '' : 's'} left: ${s.brief.missing.join(', ')}`,
    };
  }
  // 2 · approval required (hard blocker)
  if (!s.brief.approved) {
    return {
      ...base, action_code: 'brief_approval', severity: 'blocker',
      label: 'Approve the brief and start creating', destination: at(s, 'brief'),
      reason: 'The brief is complete but not approved — new assets inherit it once approved',
    };
  }
  // 3 · no saved plan → guide the user to choose requirements
  if (!s.deliverables.hasPlan) {
    return {
      ...base, action_code: 'plan_deliverables', severity: 'blocker',
      label: 'Choose what this campaign needs', destination: at(s, 'deliverables'),
      reason: 'No deliverable plan yet — mark what is required, optional or not needed',
    };
  }
  // 4 · required deliverable missing (hard blocker)
  if (s.deliverables.requiredMissing.length) {
    const first = s.deliverables.requiredMissing[0];
    return {
      ...base, action_code: 'deliverable_missing', severity: 'blocker',
      label: `Create the required ${first.label}`, destination: `/app/create?campaign=${s.id}`,
      reason: `${s.deliverables.requiredMissing.length} required deliverable${s.deliverables.requiredMissing.length === 1 ? '' : 's'} not started`,
    };
  }
  // Review-derived steps need the review queue. Without it, route to Review
  // rather than asserting an unseen blocker or a false export-ready state.
  if (!s.review.evaluated) {
    return {
      ...base, action_code: 'review_campaign', severity: 'review',
      label: 'Review the campaign', destination: at(s, 'review'),
      reason: 'Required deliverables are in place — run the review checks before handoff',
    };
  }
  // 5 · stale required asset
  if (s.review.staleRequired) {
    return {
      ...base, action_code: 'stale_required', severity: 'review',
      label: `Review ${s.review.staleRequired} brief change${s.review.staleRequired === 1 ? '' : 's'}`, destination: at(s, 'review'),
      reason: 'A required asset was generated before a brief change — keep or update its snapshot',
    };
  }
  // 6 · unresolved high finding (export-blocking)
  if (s.review.highFindings) {
    return {
      ...base, action_code: 'finding_high', severity: 'blocker',
      label: `Review ${s.review.highFindings} high-severity finding${s.review.highFindings === 1 ? '' : 's'}`, destination: at(s, 'review'),
      reason: 'These consistency checks block a clean handoff until resolved or acknowledged',
    };
  }
  // 7 · required asset Needs review
  if (s.review.needsReviewRequired) {
    return {
      ...base, action_code: 'asset_needs_review', severity: 'review',
      label: `Review ${s.review.needsReviewRequired} asset${s.review.needsReviewRequired === 1 ? '' : 's'} that need review`, destination: at(s, 'review'),
      reason: 'An edited required asset is marked Needs review',
    };
  }
  // 8 · evidence / research reminder
  if (s.review.evidenceReminders) {
    return {
      ...base, action_code: 'evidence_reminder', severity: 'reminder',
      label: `Recheck ${s.review.evidenceReminders} evidence source${s.review.evidenceReminders === 1 ? '' : 's'}`, destination: at(s, 'review'),
      reason: 'Evidence past its review-by date — recheck before relying on it',
    };
  }
  // 9 · handoff / export. Only reached when review is evaluated and clean.
  return {
    ...base, action_code: 'export_handoff', severity: 'ready',
    label: 'Export the handoff packet', destination: at(s, 'handoff'),
    reason: 'Required deliverables are in place and these checks found no blocking issue — review remains yours',
  };
}

/**
 * Transparent readiness — four groups, each with a state and human-readable
 * reasons. No synthetic score. States: 'incomplete' | 'attention' | 'blocked'
 * | 'unknown' | 'ready'.
 */
export function readinessGroups(summary) {
  const s = summary;

  const brief = s.brief.missing.length
    ? { state: 'incomplete', reasons: [`Still needed: ${s.brief.missing.join(', ')}`] }
    : !s.brief.approved
      ? { state: 'attention', reasons: ['Complete — approve it so new assets inherit it'] }
      : { state: 'ready', reasons: ['Approved'] };

  let deliverables;
  if (!s.deliverables.hasPlan) {
    deliverables = { state: 'incomplete', reasons: ['No plan yet — choose what this campaign needs'] };
  } else if (s.deliverables.requiredMissing.length) {
    deliverables = {
      state: 'attention',
      reasons: [`${s.deliverables.requiredMissing.length} required not started: ${s.deliverables.requiredMissing.map((d) => d.label).join(', ')}`],
    };
  } else {
    deliverables = { state: 'ready', reasons: [`${s.deliverables.requiredTotal} required in place`] };
  }

  let review;
  if (!s.review.evaluated) {
    review = { state: 'unknown', reasons: ['Open the campaign to run the review checks'] };
  } else {
    const reasons = [];
    if (s.review.highFindings) reasons.push(`${s.review.highFindings} high-severity finding${s.review.highFindings === 1 ? '' : 's'} blocking handoff`);
    if (s.review.staleRequired) reasons.push(`${s.review.staleRequired} required asset${s.review.staleRequired === 1 ? '' : 's'} to re-check after a brief change`);
    if (s.review.needsReviewRequired) reasons.push(`${s.review.needsReviewRequired} required asset${s.review.needsReviewRequired === 1 ? '' : 's'} marked Needs review`);
    if (s.review.evidenceReminders) reasons.push(`${s.review.evidenceReminders} evidence source${s.review.evidenceReminders === 1 ? '' : 's'} past review-by date`);
    review = reasons.length
      ? { state: s.review.highFindings ? 'blocked' : 'attention', reasons }
      : { state: 'ready', reasons: ['No blocking issues detected by these checks (not an approval)'] };
  }

  const briefReady = s.brief.missing.length === 0 && s.brief.approved;
  const delivReady = s.deliverables.hasPlan && s.deliverables.requiredMissing.length === 0;
  const handoff = !s.review.evaluated
    ? { state: 'unknown', reasons: ['Run the review checks to confirm handoff readiness'] }
    : (briefReady && delivReady && review.state === 'ready')
      ? { state: 'ready', reasons: ['Nothing is blocking a handoff export — publishing stays your decision'] }
      : { state: 'attention', reasons: ['Resolve the items above before exporting the handoff'] };

  return [
    { key: 'brief', label: 'Brief', ...brief },
    { key: 'deliverables', label: 'Required deliverables', ...deliverables },
    { key: 'review', label: 'Review blockers', ...review },
    { key: 'handoff', label: 'Handoff', ...handoff },
  ];
}
