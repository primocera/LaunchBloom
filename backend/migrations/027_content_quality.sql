-- v6 Prompt 25: keyword metrics are only ever stored WITH their source and
-- date — the generator never writes them; the user records them after real
-- research. Kept separate from the AI-generated columns by design.
alter table seo_assets add column if not exists metric_source text;
alter table seo_assets add column if not exists metric_date date;
alter table seo_assets add column if not exists metric_notes text;

comment on column seo_assets.metric_source is 'Where the user researched volume/difficulty (tool name or URL). Null = unresearched.';
comment on column seo_assets.metric_date is 'When the metric was looked up. Required together with metric_source.';
comment on column seo_assets.metric_notes is 'The researched numbers themselves, recorded by the user with the source above.';
