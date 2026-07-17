-- v5 Prompt 15: separate optional marketing consent from required Terms/Privacy
-- consent, both versioned on the same auditable row.
alter table legal_consents
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists marketing_version text;
