import { api } from '../../lib/api';
import GeneratorStudio, { AssetField } from './generator';

// ---------------------------------------------------------------------------
// Upgrade Prompt 18: Captions & Content Studio — hooks, captions, carousels,
// reels and stories tied to the offer.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    name: 'platforms', label: 'Platforms', type: 'checkboxes', required: true,
    options: [
      { value: 'instagram', label: 'Instagram' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'pinterest', label: 'Pinterest' },
      { value: 'facebook', label: 'Facebook' },
    ],
  },
  {
    name: 'content_goal', label: 'Content goal', type: 'select', required: true,
    options: ['awareness', 'trust', 'leads', 'sales', 'launch', 'engagement'],
  },
  {
    name: 'content_style', label: 'Content style', type: 'select',
    options: ['educational', 'personal', 'premium', 'soft selling', 'bold', 'storytelling'],
  },
  { name: 'number_of_items', label: 'Number of items', type: 'number', placeholder: '12' },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

function renderItem(item) {
  return (
    <>
      <div className="gen-card-title">{item.platform} · {item.content_type}{item.goal ? ` · ${item.goal}` : ''}</div>
      <AssetField label="Hook" value={item.hook} copy />
      <AssetField label="Caption" value={item.caption} copy />
      <AssetField label="CTA" value={item.cta} copy />
      <AssetField label="Visual direction" value={item.visual_direction} copy />
      <AssetField label="Hashtags" value={item.hashtags} copy />
    </>
  );
}

const fullCopy = (i) =>
  [`${i.platform} · ${i.content_type}`, `Hook: ${i.hook}`, i.caption, `CTA: ${i.cta}`, `Visual: ${i.visual_direction}`, (i.hashtags || []).join(' ')]
    .filter(Boolean).join('\n');

export default function SocialStudio() {
  return (
    <GeneratorStudio
      title="Captions & Content Studio"
      blurb="Generate scroll-stopping captions, hooks, carousels, reels and stories that connect to your offer."
      fields={FIELDS}
      initial={{ target_language: 'English', number_of_items: 12, platforms: ['instagram'] }}
      generate={(v) => api.generateSocialAssets(v)}
      resultKey="items"
      table="social_assets"
      renderItem={renderItem}
      fullCopy={fullCopy}
    />
  );
}
