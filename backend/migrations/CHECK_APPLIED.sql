-- Which migrations are actually applied to THIS database.
-- Any row with applied = false (or null) needs running.
select * from (
  select '001_initial_schema' as migration, (to_regclass('public.customers') is not null and to_regclass('public.subscriptions') is not null and to_regclass('public.payments') is not null and to_regclass('public.workspaces') is not null and to_regclass('public.onboarding_answers') is not null and to_regclass('public.positioning_outputs') is not null and to_regclass('public.offers') is not null and to_regclass('public.launch_kits') is not null and to_regclass('public.content_items') is not null and to_regclass('public.email_items') is not null and to_regclass('public.ad_ideas') is not null and to_regclass('public.seo_items') is not null and to_regclass('public.weekly_tasks') is not null and exists (select 1 from pg_proc where proname='set_updated_at')) as applied
  union all
  select '002_studio_status' as migration, ((select count(*) from information_schema.columns where table_name='seo_items' and column_name in ('status')) = 1) as applied
  union all
  select '003_users' as migration, (to_regclass('public.users') is not null) as applied
  union all
  select '004_marketing_assets' as migration, (to_regclass('public.website_pages') is not null and to_regclass('public.email_assets') is not null and to_regclass('public.social_assets') is not null and to_regclass('public.creative_assets') is not null and to_regclass('public.seo_assets') is not null) as applied
  union all
  select '005_supabase_auth' as migration, ((select count(*) from information_schema.columns where table_name='workspaces' and column_name in ('user_id')) = 1) as applied
  union all
  select '006_stripe_events' as migration, (to_regclass('public.stripe_events') is not null and (select count(*) from information_schema.columns where table_name='subscriptions' and column_name in ('stripe_event_at')) = 1) as applied
  union all
  select '007_usage_events' as migration, (to_regclass('public.usage_events') is not null) as applied
  union all
  select '008_legal_consents' as migration, (to_regclass('public.legal_consents') is not null) as applied
  union all
  select '009_workspace_multi' as migration, ((select count(*) from information_schema.columns where table_name='workspaces' and column_name in ('archived')) = 1) as applied
  union all
  select '010_brand_profiles' as migration, (to_regclass('public.brand_profiles') is not null) as applied
  union all
  select '011_email_fields' as migration, ((select count(*) from information_schema.columns where table_name='email_assets' and column_name in ('objective','secondary_cta','personalization_tokens','exclusions')) = 4) as applied
  union all
  select '012_campaigns' as migration, (to_regclass('public.campaigns') is not null and (select count(*) from information_schema.columns where table_name='website_pages' and column_name in ('campaign_id')) = 1 and (select count(*) from information_schema.columns where table_name='email_assets' and column_name in ('campaign_id')) = 1 and (select count(*) from information_schema.columns where table_name='social_assets' and column_name in ('campaign_id')) = 1 and (select count(*) from information_schema.columns where table_name='creative_assets' and column_name in ('campaign_id')) = 1 and (select count(*) from information_schema.columns where table_name='seo_assets' and column_name in ('campaign_id')) = 1) as applied
  union all
  select '013_asset_library' as migration, (to_regclass('public.asset_versions') is not null and (select count(*) from information_schema.columns where table_name='website_pages' and column_name in ('favourite','archived','generation_run_id')) = 3 and (select count(*) from information_schema.columns where table_name='email_assets' and column_name in ('favourite','archived','generation_run_id')) = 3 and (select count(*) from information_schema.columns where table_name='social_assets' and column_name in ('favourite','archived','generation_run_id')) = 3 and (select count(*) from information_schema.columns where table_name='creative_assets' and column_name in ('favourite','archived','generation_run_id')) = 3 and (select count(*) from information_schema.columns where table_name='seo_assets' and column_name in ('status','favourite','archived','generation_run_id')) = 4) as applied
  union all
  select '014_analytics_events' as migration, (to_regclass('public.analytics_events') is not null) as applied
  union all
  select '015_email_events' as migration, (to_regclass('public.email_events') is not null) as applied
  union all
  select '016_marketing_consent' as migration, ((select count(*) from information_schema.columns where table_name='legal_consents' and column_name in ('marketing_opt_in','marketing_version')) = 2) as applied
  union all
  select '017_campaign_brief' as migration, ((select count(*) from information_schema.columns where table_name='campaigns' and column_name in ('markets','language','key_message','proof','restrictions','deadline','archived')) = 7 and (select count(*) from information_schema.columns where table_name='website_pages' and column_name in ('brief_snapshot','prompt_version')) = 2 and (select count(*) from information_schema.columns where table_name='email_assets' and column_name in ('brief_snapshot','prompt_version')) = 2 and (select count(*) from information_schema.columns where table_name='social_assets' and column_name in ('brief_snapshot','prompt_version')) = 2 and (select count(*) from information_schema.columns where table_name='creative_assets' and column_name in ('brief_snapshot','prompt_version')) = 2 and (select count(*) from information_schema.columns where table_name='seo_assets' and column_name in ('brief_snapshot','prompt_version')) = 2) as applied
  union all
  select '018_email_studio' as migration, ((select count(*) from information_schema.columns where table_name='email_assets' and column_name in ('subject_options','campaign_type','promo_details','email_length','tone')) = 5) as applied
  union all
  select '019_social_studio' as migration, ((select count(*) from information_schema.columns where table_name='social_assets' and column_name in ('pillar','slides','video_script','planned_date')) = 4) as applied
  union all
  select '020_creative_studio' as migration, ((select count(*) from information_schema.columns where table_name='creative_assets' and column_name in ('angle','designer_notes','video_timeline','slides','search_ad','test_matrix','compliance_flags','compliance_ack')) = 8) as applied
  union all
  select '021_seo_ideas' as migration, ((select count(*) from information_schema.columns where table_name='seo_items' and column_name in ('topic_cluster','search_intent','secondary_keywords')) = 3) as applied
  union all
  select '022_version_provenance' as migration, ((select count(*) from information_schema.columns where table_name='asset_versions' and column_name in ('source','author_email')) = 2) as applied
  union all
  select '023_admin_audit' as migration, (to_regclass('public.admin_audit') is not null) as applied
  union all
  select '024_ai_spend_ledger' as migration, (to_regclass('public.ai_spend_ledger') is not null and exists (select 1 from pg_proc where proname='reserve_ai_spend') and exists (select 1 from pg_proc where proname='finalize_ai_spend') and exists (select 1 from pg_proc where proname='release_ai_spend')) as applied
  union all
  select '025_email_outbox' as migration, (exists (select 1 from pg_proc where proname='claim_email_outbox') and (select count(*) from information_schema.columns where table_name='email_events' and column_name in ('attempts','next_attempt_at','locked_until','payload')) = 4) as applied
  union all
  select '026_generation_jobs' as migration, (to_regclass('public.generation_jobs') is not null) as applied
  union all
  select '027_content_quality' as migration, ((select count(*) from information_schema.columns where table_name='seo_assets' and column_name in ('metric_source','metric_date','metric_notes')) = 3) as applied
  union all
  select '028_campaign_deliverables' as migration, (to_regclass('public.campaign_deliverables') is not null) as applied
  union all
  select '029_consistency_findings' as migration, (to_regclass('public.consistency_findings') is not null) as applied
  union all
  select '030_brief_reviews' as migration, (to_regclass('public.asset_brief_reviews') is not null) as applied
  union all
  select '031_evidence' as migration, (to_regclass('public.evidence') is not null and to_regclass('public.asset_evidence_links') is not null) as applied
  union all
  select '032_workspace_templates' as migration, (to_regclass('public.workspace_templates') is not null) as applied
  union all
  select '033_analytics_dedupe' as migration, ((select count(*) from information_schema.columns where table_name='analytics_events' and column_name in ('dedupe_key')) = 1) as applied
  union all
  select '034_finding_audit' as migration, ((select count(*) from information_schema.columns where table_name='consistency_findings' and column_name in ('acknowledged_by','acknowledged_at')) = 2) as applied
  union all
  select '035_handoff_packet' as migration, ((select count(*) from information_schema.columns where table_name='campaigns' and column_name in ('last_handoff_fingerprint','last_handoff_at','last_handoff_format')) = 3) as applied
  union all
  select '036_email_suppressions' as migration, (to_regclass('public.email_suppressions') is not null and (select count(*) from information_schema.columns where table_name='email_events' and column_name in ('category')) = 1) as applied
) t order by migration;
