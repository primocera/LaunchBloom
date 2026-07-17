// v5 Prompt 10 — pure helpers for the Social Studio calendar. No DOM/fetch so
// they are node:test-friendly (grouping + date validation).

/** YYYY-MM-DD only. Matches the server-side planned_date guard. */
export function isValidPlannedDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Group social items into { unscheduled, days } where days is a date-sorted
 * array of { date, items }. Items without a valid planned_date go to
 * `unscheduled` so the user can plan them onto a date.
 */
export function groupByPlannedDate(items = []) {
  const byDate = new Map();
  const unscheduled = [];
  for (const it of items || []) {
    if (isValidPlannedDate(it && it.planned_date)) {
      if (!byDate.has(it.planned_date)) byDate.set(it.planned_date, []);
      byDate.get(it.planned_date).push(it);
    } else {
      unscheduled.push(it);
    }
  }
  const days = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => ({ date, items: list }));
  return { unscheduled, days };
}

/** Short label for a caption/card: platform · format · pillar. */
export function itemLabel(it = {}) {
  return [it.platform, it.content_type, it.pillar].filter(Boolean).join(' · ');
}
