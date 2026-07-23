// v9 SC-06: pure, testable field-level version comparison for the Library asset
// drawer. No React, no DOM — inputs in, plain data out (unit-tested from
// backend/tests/version-diff.test.js). It classifies each editable field as
// Added / Removed / Changed / Unchanged between a version snapshot ("before")
// and the current asset ("after"), so restore/compare can be shown clearly and
// a restore is only ever confirmed against a real, visible difference.

const norm = (v) => (v == null ? '' : Array.isArray(v) ? v.join('\n') : String(v));

/**
 * @param {object} before  the version snapshot's field values
 * @param {object} after   the current asset's field values
 * @param {Array<[string,string]>} fields  [name, label] pairs to compare
 * @returns {{ field, label, status, before, after }[]}  status ∈
 *          'added' | 'removed' | 'changed' | 'unchanged'
 */
export function diffFields(before = {}, after = {}, fields = []) {
  return fields.map(([field, label]) => {
    const b = norm(before[field]);
    const a = norm(after[field]);
    let status;
    if (b === a) status = 'unchanged';
    else if (!b && a) status = 'added';
    else if (b && !a) status = 'removed';
    else status = 'changed';
    return { field, label: label || field, status, before: b, after: a };
  });
}

/** Only the fields that actually differ (drives the "N changes" summary). */
export function changedFields(before, after, fields) {
  return diffFields(before, after, fields).filter((d) => d.status !== 'unchanged');
}

/** A one-line human summary, e.g. "2 changed, 1 added". Empty string if none. */
export function diffSummary(before, after, fields) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const d of changedFields(before, after, fields)) counts[d.status] += 1;
  return [
    counts.changed ? `${counts.changed} changed` : null,
    counts.added ? `${counts.added} added` : null,
    counts.removed ? `${counts.removed} removed` : null,
  ].filter(Boolean).join(', ');
}
