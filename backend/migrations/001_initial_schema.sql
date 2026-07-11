-- OfferFlow AI initial schema
-- Run in the Supabase SQL editor (new Supabase project, separate from ConversionForge).
--
-- Identity model: no Supabase Auth. The backend's HMAC session email is the
-- identity, so user-owned data hangs off workspaces.user_email. The backend
-- uses the service_role key (bypasses RLS) — ownership is enforced in routes.
--
-- Also create a PRIVATE storage bucket named: offerflow-data
-- (used by lib/auth.js for credits.json)

-- =========================================================================
-- Billing (inherited from ConversionForge)
-- =========================================================================

create table if not exists public.customers (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  name                text,
  stripe_customer_id  text unique,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists customers_stripe_customer_id_idx on public.customers (stripe_customer_id);
create index if not exists customers_email_idx on public.customers (email);

create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  stripe_subscription_id  text not null unique,
  customer_id             uuid references public.customers (id) on delete set null,
  stripe_price_id         text,
  status                  text not null,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  trial_end               timestamptz,
  cancel_at_period_end    boolean not null default false,
  metadata                jsonb not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists subscriptions_customer_id_idx on public.subscriptions (customer_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

create table if not exists public.payments (
  id                        uuid primary key default gen_random_uuid(),
  stripe_payment_intent_id  text not null unique,
  customer_id               uuid references public.customers (id) on delete set null,
  amount                    integer not null,
  currency                  text not null default 'usd',
  status                    text not null,
  metadata                  jsonb not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists payments_customer_id_idx on public.payments (customer_id);

-- =========================================================================
-- OfferFlow core
-- =========================================================================

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  name        text not null default 'My business',
  type        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists workspaces_user_email_idx on public.workspaces (user_email);

create table if not exists public.onboarding_answers (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  skills                 text,
  interests              text,
  experience             text,
  audience_ideas         text,
  product_type           text,
  current_stage          text,
  main_goal              text,
  weekly_time_available  text,
  biggest_challenge      text,
  platforms              text[],
  created_at             timestamptz not null default now()
);

create index if not exists onboarding_answers_workspace_id_idx on public.onboarding_answers (workspace_id);

create table if not exists public.positioning_outputs (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  possible_niches         jsonb,
  recommended_niche       jsonb,
  ideal_customer          jsonb,
  positioning_statement   text,
  desired_transformation  text,
  tagline_options         jsonb,
  bio_options             jsonb,
  elevator_pitch          text,
  content_pillars         jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists positioning_outputs_workspace_id_idx on public.positioning_outputs (workspace_id);

create table if not exists public.offers (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  offer_name         text,
  offer_type         text,
  promise            text,
  target_customer    text,
  what_is_included   jsonb,
  delivery_format    text,
  price_suggestion   text,
  bonuses            jsonb,
  objections         jsonb,
  objection_answers  jsonb,
  cta                text,
  why_it_fits        text,
  status             text not null default 'draft',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists offers_workspace_id_idx on public.offers (workspace_id);

create table if not exists public.launch_kits (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  offer_id          uuid not null references public.offers (id) on delete cascade,
  title             text,
  summary           text,
  launch_checklist  jsonb,
  landing_page      jsonb,
  content_plan      jsonb,
  email_sequence    jsonb,
  ads_kit           jsonb,
  seo_kit           jsonb,
  weekly_plan       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists launch_kits_workspace_id_idx on public.launch_kits (workspace_id);
create index if not exists launch_kits_offer_id_idx on public.launch_kits (offer_id);

-- =========================================================================
-- Per-item tables (granular editing in the studios)
-- =========================================================================

create table if not exists public.content_items (
  id             uuid primary key default gen_random_uuid(),
  launch_kit_id  uuid not null references public.launch_kits (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  day_number     integer,
  platform       text,
  content_type   text,
  topic          text,
  hook           text,
  caption_angle  text,
  cta            text,
  goal           text,
  status         text not null default 'planned',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists content_items_launch_kit_id_idx on public.content_items (launch_kit_id);
create index if not exists content_items_workspace_id_idx on public.content_items (workspace_id);

create table if not exists public.email_items (
  id              uuid primary key default gen_random_uuid(),
  launch_kit_id   uuid not null references public.launch_kits (id) on delete cascade,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  sequence_order  integer,
  email_type      text,
  subject_line    text,
  preheader       text,
  main_angle      text,
  body_outline    jsonb,
  cta             text,
  status          text not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists email_items_launch_kit_id_idx on public.email_items (launch_kit_id);
create index if not exists email_items_workspace_id_idx on public.email_items (workspace_id);

create table if not exists public.ad_ideas (
  id                uuid primary key default gen_random_uuid(),
  launch_kit_id     uuid not null references public.launch_kits (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  ad_type           text,
  hook              text,
  primary_text      text,
  headline          text,
  visual_direction  text,
  cta               text,
  status            text not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists ad_ideas_launch_kit_id_idx on public.ad_ideas (launch_kit_id);
create index if not exists ad_ideas_workspace_id_idx on public.ad_ideas (workspace_id);

create table if not exists public.seo_items (
  id                uuid primary key default gen_random_uuid(),
  launch_kit_id     uuid not null references public.launch_kits (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  keyword           text,
  page_type         text,
  title             text,
  meta_description  text,
  content_angle     text,
  priority          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists seo_items_launch_kit_id_idx on public.seo_items (launch_kit_id);
create index if not exists seo_items_workspace_id_idx on public.seo_items (workspace_id);

create table if not exists public.weekly_tasks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id     uuid references public.launch_kits (id) on delete cascade,
  week_start        date,
  task_type         text,
  task_title        text,
  task_description  text,
  priority          text,
  completed         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists weekly_tasks_workspace_id_idx on public.weekly_tasks (workspace_id);
create index if not exists weekly_tasks_launch_kit_id_idx on public.weekly_tasks (launch_kit_id);

-- =========================================================================
-- updated_at trigger
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','subscriptions','payments','workspaces','positioning_outputs',
    'offers','launch_kits','content_items','email_items','ad_ideas','seo_items','weekly_tasks'
  ] loop
    execute format('create or replace trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end;
$$;

-- RLS: enabled as defense-in-depth; the backend's service_role bypasses it,
-- and no anon/auth keys are handed to clients in this architecture.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','subscriptions','payments','workspaces','onboarding_answers','positioning_outputs',
    'offers','launch_kits','content_items','email_items','ad_ideas','seo_items','weekly_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
