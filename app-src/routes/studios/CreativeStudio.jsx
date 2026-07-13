import { api } from '../../lib/api';
import GeneratorStudio, { AssetField } from './generator';

// ---------------------------------------------------------------------------
// Upgrade Prompt 18: Ads & Creative Studio — hooks, static concepts, video
// ideas, UGC briefs, shot lists and testing angles.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    name: 'platforms', label: 'Platforms', type: 'checkboxes', required: true,
    options: [
      { value: 'meta', label: 'Meta' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'google', label: 'Google' },
      { value: 'pinterest', label: 'Pinterest' },
    ],
  },
  {
    name: 'creative_goal', label: 'Creative goal', type: 'select', required: true,
    options: ['leads', 'sales', 'traffic', 'awareness', 'retargeting'],
  },
  {
    name: 'formats', label: 'Formats', type: 'checkboxes',
    options: [
      { value: 'static', label: 'Static' },
      { value: 'video', label: 'Video' },
      { value: 'ugc', label: 'UGC' },
      { value: 'carousel', label: 'Carousel' },
      { value: 'search_ad', label: 'Search ad' },
    ],
  },
  {
    name: 'budget_level', label: 'Budget level', type: 'select',
    options: ['low', 'medium', 'high'],
  },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

function renderItem(item) {
  return (
    <>
      <div className="gen-card-title">{item.platform} · {item.creative_type}</div>
      <AssetField label="Hook" value={item.hook} copy />
      <AssetField label="Headline" value={item.headline} copy />
      <AssetField label="Primary text" value={item.primary_text} copy />
      <AssetField label="Visual direction" value={item.visual_direction} copy />
      <AssetField label="Shot list" value={item.shot_list} copy />
      <AssetField label="Text overlays" value={item.text_overlays} copy />
      <AssetField label="CTA" value={item.cta} copy />
      <AssetField label="Testing angle" value={item.testing_angle} />
    </>
  );
}

const fullCopy = (i) =>
  [`${i.platform} · ${i.creative_type}`, `Hook: ${i.hook}`, `Headline: ${i.headline}`, i.primary_text,
    `Visual: ${i.visual_direction}`, 'Shots:', ...(i.shot_list || []).map((s) => `- ${s}`),
    'Overlays:', ...(i.text_overlays || []).map((s) => `- ${s}`), `CTA: ${i.cta}`, `Testing: ${i.testing_angle}`]
    .filter(Boolean).join('\n');

export default function CreativeStudio() {
  return (
    <GeneratorStudio
      title="Ads & Creative Studio"
      blurb="Generate ad hooks, static concepts, video ideas, UGC briefs and a testing plan you can shoot with a phone."
      fields={FIELDS}
      initial={{ target_language: 'English', platforms: ['meta'], formats: ['static', 'video'] }}
      generate={(v) => api.generateCreativeAssets(v)}
      resultKey="items"
      table="creative_assets"
      renderItem={renderItem}
      fullCopy={fullCopy}
    />
  );
}
