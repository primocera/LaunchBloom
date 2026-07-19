import { api } from '../../lib/api';
import { download, websitePageMarkdown, websitePagesDoc } from '../../lib/export';
import GeneratorStudio, { AssetField } from './generator';

// ---------------------------------------------------------------------------
// Website & Page Studio (v5 Prompt 8): generate home/product/collection/cart/
// about/FAQ/contact/thank-you/landing copy from the offer. Each page ships
// three hero directions, structured sections, meta-length checks and clean
// Markdown / Word export. The full structured page lives in the row's
// `sections` jsonb; render it here with per-section copy buttons.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    name: 'business_type', label: 'Business type', type: 'select', required: true,
    options: [
      { value: 'service', label: 'Service' },
      { value: 'digital_product', label: 'Digital product' },
      { value: 'ecommerce', label: 'Ecommerce' },
      { value: 'creator', label: 'Creator' },
      { value: 'coaching', label: 'Coaching' },
    ],
  },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  {
    name: 'page_types', label: 'Page types', type: 'checkboxes', required: true,
    options: [
      { value: 'home', label: 'Home' },
      { value: 'product', label: 'Product' },
      { value: 'collection', label: 'Collection / Category' },
      { value: 'landing', label: 'Landing Page' },
      { value: 'about', label: 'About' },
      { value: 'faq', label: 'FAQ' },
      { value: 'cart', label: 'Cart' },
      { value: 'contact', label: 'Contact' },
      { value: 'thank_you', label: 'Thank You' },
    ],
  },
  { name: 'website_goal', label: 'Website goal', type: 'text', placeholder: 'e.g. book discovery calls' },
  // Ecommerce product facts — used verbatim for product/cart pages, so the AI
  // never invents variants, shipping terms, discounts or proof.
  { name: 'product_facts', label: 'Product facts (ecommerce)', type: 'textarea', placeholder: 'Materials, dimensions, what it is, what it does…' },
  { name: 'benefits', label: 'Key benefits', type: 'textarea', placeholder: 'The outcomes a buyer cares about' },
  { name: 'objections', label: 'Common objections', type: 'textarea', placeholder: 'Doubts buyers have before purchasing' },
  { name: 'usage', label: 'How it is used', type: 'textarea', placeholder: 'How the customer uses / applies it' },
  { name: 'variants', label: 'Variants', type: 'text', placeholder: 'e.g. sizes, colours, bundles (leave blank if none)' },
  { name: 'shipping_returns', label: 'Shipping & returns', type: 'text', placeholder: 'Real policy — leave blank to use placeholders' },
  { name: 'proof', label: 'Verified proof', type: 'textarea', placeholder: 'Only real reviews / numbers / results — never invented' },
  { name: 'free_shipping_threshold', label: 'Free-shipping threshold', type: 'text', placeholder: 'e.g. $50 (only if you actually offer it)' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

const APPROACH_LABELS = {
  direct_response: 'Direct response',
  brand_led: 'Brand-led',
  problem_aware: 'Problem-aware',
};

function renderPage(item) {
  const page = item.sections || {};
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const heroDirs = Array.isArray(page.hero_directions) ? page.hero_directions : [];
  // v6 Prompt 21: unresolved [bracketed facts] must be filled before publish.
  const placeholders = (JSON.stringify(page).match(/\[[A-Za-z][^\]\n]{2,80}\]/g) || []).length;
  return (
    <>
      <div className="gen-card-title">{(page.page_type || item.page_type || 'page').replace(/_/g, ' ')}</div>
      {placeholders > 0 && (
        <p className="flow-muted" role="note">
          {placeholders} unresolved fact placeholder{placeholders === 1 ? '' : 's'} in brackets — replace with real details before this page is review-ready.
        </p>
      )}
      <AssetField label="Conversion goal" value={page.page_goal} />
      <AssetField label="SEO title" value={item.seo_title || page.seo_title} copy />
      <AssetField label="Meta description" value={item.meta_description || page.meta_description} copy />
      <AssetField label="H1" value={page.h1} copy />

      {heroDirs.length > 0 && (
        <div className="gen-subsection">
          <span className="gen-field-label">Hero directions (pick one)</span>
          {heroDirs.map((h, i) => (
            <div className="gen-subsection" key={i}>
              <AssetField label={APPROACH_LABELS[h.approach] || h.approach} value={h.headline} copy />
              <AssetField label="Subheadline" value={h.subheadline} copy />
            </div>
          ))}
        </div>
      )}

      <AssetField label="Hero headline (chosen)" value={page.hero_headline} copy />
      <AssetField label="Hero subheadline (chosen)" value={page.hero_subheadline} copy />
      <AssetField label="Primary CTA" value={item.cta || page.primary_cta} copy />
      <AssetField label="Secondary CTA" value={page.secondary_cta} copy />
      {sections.map((s, i) => (
        <div className="gen-subsection" key={i}>
          <AssetField label={s.section_name || `Section ${i + 1}`} value={s.headline} copy />
          <AssetField label="Body" value={s.body} copy />
          <AssetField label="Bullets" value={s.bullets} copy />
          {s.cta && <AssetField label="CTA" value={s.cta} copy />}
        </div>
      ))}
      {Array.isArray(page.trust_elements) && <AssetField label="Trust elements" value={page.trust_elements} copy />}
      {Array.isArray(page.faq) && page.faq.length > 0 && (
        <AssetField label="FAQ" value={page.faq.map((f) => `${f.question}\n${f.answer}`)} copy />
      )}
      <AssetField label="Design notes" value={page.design_notes} />

      <div className="flow-row" style={{ marginTop: 10 }}>
        <button className="btn-secondary" onClick={() => download(`${page.page_type || 'page'}.md`, websitePageMarkdown(item), 'text/markdown')}>
          Export Markdown
        </button>
        <button className="btn-secondary" onClick={() => download(`${page.page_type || 'page'}.doc`, websitePagesDoc([item]), 'application/msword')}>
          Export Word
        </button>
      </div>
    </>
  );
}

function fullCopy(item) {
  return websitePageMarkdown(item);
}

export default function WebsiteStudio() {
  // v6 Prompt 25: an SEO idea can arrive as a ready-made page brief.
  let brief = '';
  try {
    brief = localStorage.getItem('of-website-brief') || '';
    if (brief) localStorage.removeItem('of-website-brief');
  } catch { /* storage unavailable */ }
  return (
    <GeneratorStudio
      title="Website copy"
      blurb="Create structured drafts for the page’s job — with one primary CTA, evidence-aware claims and metadata to review."
      fields={FIELDS}
      initial={{ target_language: 'English', page_types: brief ? ['landing'] : ['home'], extra_context: brief || undefined }}
      generate={(v, opts) => api.generateWebsiteKit(v, opts)}
      resultKey="pages"
      table="website_pages"
      renderItem={renderPage}
      fullCopy={fullCopy}
    />
  );
}
