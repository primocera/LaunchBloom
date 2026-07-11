// ---------------------------------------------------------------------------
// Prompt 29: copy and export utilities. Full kit as readable Markdown,
// content plan as CSV (spec headers), email sequence as Markdown, plus a
// browser download helper. No PDF (spec: skip unless simple).
// ---------------------------------------------------------------------------

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

/** The full launch kit as one clean Markdown document. */
export function kitMarkdown(kit, items = {}) {
  const parts = [
    `# ${kit.title || 'Launch Kit'}`,
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
