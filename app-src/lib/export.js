// ---------------------------------------------------------------------------
// Prompt 29: copy and export utilities. Full kit as readable Markdown,
// content plan as CSV (spec headers), email sequence as Markdown, plus a
// browser download helper. No PDF (spec: skip unless simple).
// ---------------------------------------------------------------------------

// ── Prompt 13: library exports + unresolved-placeholder / safety warnings ───

// Bracketed fill-in tokens the AI leaves when a real fact is missing.
const PLACEHOLDER_RE = /\[[^\]\n]{2,80}\]/g;

/** Unique unresolved [PLACEHOLDER] tokens found in any stringifiable value. */
export function findPlaceholders(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const found = text.match(PLACEHOLDER_RE) || [];
  // Ignore markdown links like [label](url) — those aren't fill-ins.
  const real = found.filter((m) => !text.includes(`${m}(`));
  return [...new Set(real)];
}

/** One library row → plain text for TXT export and search. */
export function assetPlainText(item = {}) {
  const skip = new Set(['id', 'workspace_id', 'launch_kit_id', 'offer_id', 'campaign_id', 'created_at', 'updated_at', 'generation_run_id']);
  return Object.entries(item)
    .filter(([k, v]) => !skip.has(k) && v != null && v !== '' && (typeof v !== 'object' || Array.isArray(v)))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join('; ') : v}`)
    .join('\n');
}

/** Library rows → CSV with a stable column set. */
export function assetsCsv(items = []) {
  const cols = ['type_label', 'title', 'status', 'platform', 'language', 'campaign_id', 'created_at'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...(items || []).map((i) => cols.map((c) => esc(i[c])).join(','))].join('\n');
}

/** Any string/array/object → Word-openable HTML (.doc). */
export function toWordDoc(title, text) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = String(text).split('\n').map((ln) => (ln.trim() ? `<p>${esc(ln)}</p>` : '')).join('\n');
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;
}

export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const mdList = (arr) => (arr || []).map((x) => `- ${x}`).join('\n');

export function landingPageMarkdown(lp = {}) {
  return [
    `## Landing Page`,
    `# ${lp.headline || ''}`,
    lp.subheadline || '',
    `**CTA:** ${lp.primary_cta || ''}`,
    `### The problem`, lp.problem_section || '',
    `### The solution`, lp.solution_section || lp.transformation_section || '',
    `### Benefits`, mdList(lp.benefits),
    `### What's included`, mdList(lp.whats_included || lp.offer_stack),
    lp.who_its_for?.length ? `### Who it's for\n${mdList(lp.who_its_for)}` : '',
    lp.who_its_not_for?.length ? `### Who it's not for\n${mdList(lp.who_its_not_for)}` : '',
    lp.how_it_works?.length ? `### How it works\n${(lp.how_it_works || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '',
    lp.pricing_section ? `### Pricing\n${lp.pricing_section}` : '',
    `### FAQ`,
    ...(lp.faq || []).map((f) => `**${f.question}**\n${f.answer}`),
    lp.final_cta_section ? `### Final CTA\n${lp.final_cta_section}` : '',
  ].filter(Boolean).join('\n\n');
}

// ── Prompt 8: Website Studio exports (Markdown + Word) ──────────────────────

/** One saved website page (row) → clean Markdown. Pure + snapshot-tested. */
export function websitePageMarkdown(item = {}) {
  const p = item.sections || {};
  const sections = Array.isArray(p.sections) ? p.sections : [];
  const heroDirs = Array.isArray(p.hero_directions) ? p.hero_directions : [];
  return [
    `# ${(p.page_type || item.page_type || 'page').replace(/_/g, ' ').toUpperCase()}`,
    p.page_goal ? `_Goal: ${p.page_goal}_` : '',
    `**SEO title:** ${item.seo_title || p.seo_title || ''}`,
    `**Meta description:** ${item.meta_description || p.meta_description || ''}`,
    `## ${p.h1 || ''}`,
    `**Hero:** ${p.hero_headline || ''}`,
    p.hero_subheadline || '',
    heroDirs.length ? `### Hero directions\n${heroDirs.map((h) => `- **${(h.approach || '').replace(/_/g, ' ')}:** ${h.headline} — ${h.subheadline}`).join('\n')}` : '',
    `**Primary CTA:** ${item.cta || p.primary_cta || ''}`,
    p.secondary_cta ? `**Secondary CTA:** ${p.secondary_cta}` : '',
    ...sections.map((s) => [
      `### ${s.section_name || ''}`,
      s.headline || '',
      s.body || '',
      mdList(s.bullets),
      s.cta ? `_CTA: ${s.cta}_` : '',
    ].filter(Boolean).join('\n\n')),
    Array.isArray(p.faq) && p.faq.length ? `### FAQ\n${p.faq.map((f) => `**${f.question}**\n${f.answer}`).join('\n\n')}` : '',
    p.design_notes ? `### Design notes\n${p.design_notes}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Many pages → one Markdown document. */
export function websitePagesMarkdown(items = []) {
  return (items || []).map(websitePageMarkdown).join('\n\n---\n\n');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Word-openable HTML document (.doc). Dependency-free and CSP-safe — no OOXML
 * zip library, but Word opens this cleanly with real headings and lists.
 */
export function websitePagesDoc(items = []) {
  const md = websitePagesMarkdown(items);
  const bodyHtml = md.split('\n').map((ln) => {
    if (ln.startsWith('### ')) return `<h3>${esc(ln.slice(4))}</h3>`;
    if (ln.startsWith('## ')) return `<h2>${esc(ln.slice(3))}</h2>`;
    if (ln.startsWith('# ')) return `<h1>${esc(ln.slice(2))}</h1>`;
    if (ln.startsWith('- ')) return `<li>${esc(ln.slice(2))}</li>`;
    if (ln === '---') return '<hr/>';
    if (ln.trim() === '') return '';
    return `<p>${esc(ln)}</p>`;
  }).join('\n');
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Website copy</title></head><body>${bodyHtml}</body></html>`;
}

export function emailSequenceMarkdown(items = []) {
  return [
    '## Email Sequence',
    ...items.map((i) =>
      [
        `### Email ${i.sequence_order}: ${i.subject_line}`,
        `- **Type:** ${i.email_type}`,
        `- **Preheader:** ${i.preheader}`,
        `- **Angle:** ${i.main_angle}`,
        `- **Outline:**`,
        ...(Array.isArray(i.body_outline) ? i.body_outline : []).map((x) => `  - ${x}`),
        `- **CTA:** ${i.cta}`,
      ].join('\n')
    ),
  ].join('\n\n');
}

// Spec headers: day, platform, content_type, topic, hook, caption_angle, cta, goal, status
export function contentPlanCsv(items = []) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['day', 'platform', 'content_type', 'topic', 'hook', 'caption_angle', 'cta', 'goal', 'status'];
  const rows = items.map((i) =>
    [i.day_number, i.platform, i.content_type, i.topic, i.hook, i.caption_angle, i.cta, i.goal, i.status].map(esc).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

function itemsMarkdown(title, items, fields) {
  return [
    `## ${title}`,
    ...(items || []).map((i) =>
      fields
        .filter(([k]) => i[k] != null && i[k] !== '')
        .map(([k, label], idx) => (idx === 0 ? `### ${i[k]}` : `- **${label}:** ${Array.isArray(i[k]) ? i[k].join('; ') : i[k]}`))
        .join('\n')
    ),
  ].join('\n\n');
}

/** The full campaign package as one clean Markdown document. */
export function kitMarkdown(kit, items = {}) {
  const parts = [
    `# ${kit.title || 'Campaign package'}`,
    kit.summary || '',
    kit.launch_checklist?.length ? `## Launch checklist\n${mdList(kit.launch_checklist)}` : '',
    landingPageMarkdown(kit.landing_page || {}),
  ];

  if (items.content_items?.length) {
    parts.push(
      itemsMarkdown('30-Day Content Plan', items.content_items, [
        ['topic', 'Topic'], ['day_number', 'Day'], ['platform', 'Platform'], ['content_type', 'Type'],
        ['hook', 'Hook'], ['caption_angle', 'Angle'], ['cta', 'CTA'], ['goal', 'Goal'],
      ])
    );
  }
  if (items.email_items?.length) parts.push(emailSequenceMarkdown(items.email_items));
  if (items.ad_ideas?.length) {
    parts.push(
      itemsMarkdown('Ads Starter Kit', items.ad_ideas, [
        ['headline', 'Headline'], ['ad_type', 'Type'], ['hook', 'Hook'],
        ['primary_text', 'Primary text'], ['visual_direction', 'Visual'], ['cta', 'CTA'],
      ])
    );
  }
  if (items.seo_items?.length) {
    parts.push(
      itemsMarkdown('SEO Starter Kit', items.seo_items, [
        ['keyword', 'Keyword'], ['page_type', 'Page type'], ['title', 'Title'],
        ['meta_description', 'Meta description'], ['content_angle', 'Angle'], ['priority', 'Priority'],
      ])
    );
  }
  if (items.weekly_tasks?.length) {
    parts.push(
      itemsMarkdown('Weekly Action Plan', items.weekly_tasks, [
        ['task_title', 'Task'], ['task_type', 'Type'], ['priority', 'Priority'], ['task_description', 'Details'],
      ])
    );
  }

  return parts.filter(Boolean).join('\n\n---\n\n');
}
