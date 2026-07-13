import { api } from '../../lib/api';
import GeneratorStudio, { AssetField } from './generator';

// ---------------------------------------------------------------------------
// Upgrade Prompt 16: Website & Page Studio — generate home/product/cart/about/
// FAQ/landing page copy from the offer. Full structured page is stored in the
// row's `sections` jsonb; render it here with per-section copy buttons.
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
      { value: 'collection', label: 'Collection' },
      { value: 'cart', label: 'Cart' },
      { value: 'about', label: 'About' },
      { value: 'faq', label: 'FAQ' },
      { value: 'thank_you', label: 'Thank You' },
      { value: 'contact', label: 'Contact' },
      { value: 'landing', label: 'Landing Page' },
    ],
  },
  { name: 'website_goal', label: 'Website goal', type: 'text', placeholder: 'e.g. book discovery calls' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

function renderPage(item) {
  const page = item.sections || {};
  const sections = Array.isArray(page.sections) ? page.sections : [];
  return (
    <>
      <div className="gen-card-title">{(page.page_type || item.page_type || 'page').replace(/_/g, ' ')}</div>
      <AssetField label="SEO title" value={item.seo_title || page.seo_title} copy />
      <AssetField label="Meta description" value={item.meta_description || page.meta_description} copy />
      <AssetField label="H1" value={page.h1} copy />
      <AssetField label="Hero headline" value={page.hero_headline} copy />
      <AssetField label="Hero subheadline" value={page.hero_subheadline} copy />
      <AssetField label="Primary CTA" value={item.cta || page.primary_cta} copy />
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
    </>
  );
}

function fullCopy(item) {
  const page = item.sections || {};
  const sections = Array.isArray(page.sections) ? page.sections : [];
  return [
    `# ${(page.page_type || item.page_type || 'page').toUpperCase()}`,
    `SEO title: ${item.seo_title || page.seo_title || ''}`,
    `Meta description: ${item.meta_description || page.meta_description || ''}`,
    `H1: ${page.h1 || ''}`,
    `Hero: ${page.hero_headline || ''} — ${page.hero_subheadline || ''}`,
    `CTA: ${item.cta || page.primary_cta || ''}`,
    '',
    ...sections.map((s) => `## ${s.section_name || ''}\n${s.headline || ''}\n${s.body || ''}\n${(s.bullets || []).map((b) => `- ${b}`).join('\n')}`),
  ].join('\n');
}

export default function WebsiteStudio() {
  return (
    <GeneratorStudio
      title="Website & Page Studio"
      blurb="Generate homepage, product page, cart page, about page, FAQ and landing page copy from your offer."
      fields={FIELDS}
      initial={{ target_language: 'English', page_types: ['home'] }}
      generate={(v) => api.generateWebsiteKit(v)}
      resultKey="pages"
      table="website_pages"
      renderItem={renderPage}
      fullCopy={fullCopy}
    />
  );
}
