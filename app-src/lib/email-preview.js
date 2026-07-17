// v5 Prompt 9 — pure helpers for the Email Studio: promotion-window formatting
// (dates always sourced from the brief, timezone-aware), plain-text preview and
// Markdown export. No DOM/fetch so they are node:test-friendly.

/**
 * Human promo window from brief facts. Returns '' when no dates are given —
 * the caller must never invent a deadline. Timezone is appended when present.
 */
export function promoWindow({ start_date, end_date, timezone } = {}) {
  if (!start_date && !end_date) return '';
  const tz = timezone ? ` (${timezone})` : '';
  if (start_date && end_date) return `${start_date} → ${end_date}${tz}`;
  if (end_date) return `Ends ${end_date}${tz}`;
  return `Starts ${start_date}${tz}`;
}

/** One saved email row → complete plain-text version (no markup). */
export function emailPlainText(e = {}) {
  return [
    `Subject: ${e.subject_line || ''}`,
    `Preheader: ${e.preheader || ''}`,
    '',
    e.headline || '',
    '',
    (e.body_copy || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, ''),
    '',
    e.cta ? `→ ${e.cta}` : '',
    e.secondary_cta ? `→ ${e.secondary_cta}` : '',
    '',
    '[Unsubscribe] · [View in browser] · [Company address]', // compliance footer placeholders
  ].filter((l) => l !== '').join('\n');
}

/** One saved email row → Markdown. */
export function emailMarkdown(e = {}) {
  const subjects = Array.isArray(e.subject_options) && e.subject_options.length
    ? e.subject_options : (e.subject_line ? [e.subject_line] : []);
  return [
    `### ${e.flow_type || 'email'} — ${e.objective || ''}`.trim(),
    e.send_timing ? `_Timing: ${e.send_timing}${e.segment ? ` · Segment: ${e.segment}` : ''}_` : '',
    subjects.length ? `**Subject options:**\n${subjects.map((s) => `- ${s}`).join('\n')}` : '',
    `**Preheader:** ${e.preheader || ''}`,
    e.headline ? `**Headline:** ${e.headline}` : '',
    '',
    e.body_copy || '',
    '',
    `**CTA:** ${e.cta || ''}`,
    e.secondary_cta ? `**Secondary CTA:** ${e.secondary_cta}` : '',
    e.exclusions ? `_Exclude: ${e.exclusions}_` : '',
  ].filter(Boolean).join('\n\n');
}

/** Many emails → one Markdown document. */
export function emailsMarkdown(items = []) {
  return (items || []).map(emailMarkdown).join('\n\n---\n\n');
}
