import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import GeneratorStudio, { AssetField } from './generator';

/** v6 Prompt 25: seed the Website studio with this idea as a page brief. */
export function ideaToPageBrief(item) {
  return [
    `Write this page for the primary keyword "${item.keyword}" (${item.keyword_intent || 'intent unknown'}).`,
    `H1: ${item.h1 || ''}`,
    `SEO title: ${item.seo_title || ''}`,
    `Meta description: ${item.meta_description || ''}`,
    Array.isArray(item.h2s) && item.h2s.length ? `Follow this outline:\n${item.h2s.map((h) => `- ${h}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// SEO Ideas Studio (v6 Prompt 14): full generator-shell parity with the other
// four studios — campaign-aware, plan-gated, saved to seo_assets with
// provenance. Radically honest (v6 Prompt 25): output is content ideas to
// RESEARCH. No search volume, difficulty, CPC or ranking claims exist
// anywhere; every idea is explicitly labeled "Not researched".
// ---------------------------------------------------------------------------

const FIELDS = [
  { name: 'site_focus', label: 'Site focus', type: 'text', required: true, placeholder: 'e.g. listing-video packages for real-estate agents' },
  {
    name: 'page_types', label: 'Page types to prioritize', type: 'checkboxes',
    options: [
      { value: 'landing page', label: 'Landing page' },
      { value: 'product page', label: 'Product page' },
      { value: 'blog post', label: 'Blog post' },
      { value: 'guide', label: 'Guide' },
      { value: 'comparison page', label: 'Comparison page' },
      { value: 'FAQ page', label: 'FAQ page' },
    ],
  },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea', placeholder: 'Existing pages, topics you already cover, topics to avoid…' },
];

// The pre-publish research checklist (mirrors backend seo-provider guidance).
const RESEARCH_CHECKLIST = [
  'Search the primary keyword in Google and read the top 10 results — match the dominant intent.',
  'Check Google autocomplete and "People also ask" for real related phrases.',
  'Use a keyword tool for volume and difficulty — record the source and date.',
  'Confirm you can create genuinely better content than what ranks now.',
  'Check the target page does not compete with an existing page for the same keyword.',
];

function renderIdea(item, { navigate }) {
  const faq = Array.isArray(item.faq) ? item.faq : [];
  const researched = Boolean(item.metric_source && item.metric_date);
  return (
    <>
      <div className="gen-card-title">
        {item.keyword}{' '}
        {researched ? (
          <span className="seo-badge" title="Metrics recorded by you, with source and date.">Researched — {item.metric_source} ({item.metric_date})</span>
        ) : (
          <span className="seo-badge" title="This is an AI content idea, not researched keyword data.">Not researched</span>
        )}
      </div>
      <AssetField label="Page type" value={item.page_type} />
      <AssetField label="Search intent" value={item.keyword_intent} />
      <AssetField label="Priority" value={item.priority} />
      <AssetField label="SEO title" value={item.seo_title} copy />
      <AssetField label="Meta description" value={item.meta_description} copy />
      <AssetField label="H1" value={item.h1} copy />
      <AssetField label="H2 outline" value={item.h2s} copy />
      {faq.length > 0 && (
        <AssetField label="FAQ" value={faq.map((f) => `${f.question}\n${f.answer}`)} copy />
      )}
      <AssetField label="Internal link ideas" value={item.internal_links} copy />
      <div className="gen-subsection">
        <span className="gen-field-label">Research before publishing</span>
        <ul className="kit-checklist">
          {RESEARCH_CHECKLIST.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </div>
      <div className="flow-row" style={{ marginTop: 10 }}>
        <button
          className="btn-secondary"
          onClick={() => {
            localStorage.setItem('of-website-brief', ideaToPageBrief(item));
            navigate('/app/website');
          }}
        >
          Use as a page brief in Website copy →
        </button>
      </div>
    </>
  );
}

function fullCopy(item) {
  const faq = Array.isArray(item.faq) ? item.faq : [];
  return [
    `# ${item.keyword} (${item.page_type || 'page'} · ${item.keyword_intent || ''} · ${item.metric_source && item.metric_date ? `researched: ${item.metric_source} ${item.metric_date}` : 'NOT RESEARCHED'})`,
    `SEO title: ${item.seo_title || ''}`,
    `Meta description: ${item.meta_description || ''}`,
    `H1: ${item.h1 || ''}`,
    Array.isArray(item.h2s) && item.h2s.length ? `H2 outline:\n${item.h2s.map((h) => `- ${h}`).join('\n')}` : '',
    faq.length ? `FAQ:\n${faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : '',
    Array.isArray(item.internal_links) && item.internal_links.length ? `Internal links:\n${item.internal_links.map((l) => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export default function SeoStudio() {
  const navigate = useNavigate();
  return (
    <GeneratorStudio
      title="SEO Ideas"
      blurb="Generate page and article ideas to research. No keyword volume, difficulty or ranking promise is inferred — any real metric must include its source and date."
      fields={FIELDS}
      initial={{ target_language: 'English' }}
      generate={(v, opts) => api.generateSeoIdeas(v, opts)}
      resultKey="items"
      table="seo_assets"
      renderItem={(item) => renderIdea(item, { navigate })}
      fullCopy={fullCopy}
    />
  );
}
