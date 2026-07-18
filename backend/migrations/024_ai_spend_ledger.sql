-- 024: Atomic global AI spend ledger (playbook v6, Prompt 5).
-- Replaces the racy Storage-JSON daily counter with a transactional table +
-- single-statement reserve function, so concurrent serverless requests can
-- never lose increments or exceed the daily cap.

create table if not exists ai_spend_ledger (
  day date primary key,
  reserved integer not null default 0,          -- calls reserved (pre-provider)
  used integer not null default 0,              -- calls finalized (provider responded)
  released integer not null default 0,          -- reservations released after failure
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,4) not null default 0,
  updated_at timestamptz not null default now()
);

alter table ai_spend_ledger enable row level security; -- service_role only

-- Atomically reserve one AI call against the day's cap. The whole
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE runs as one statement, so two
-- concurrent callers serialize on the row: the loser re-checks the cap.
-- Returns the new reserved count, or no row when the cap is already reached.
create or replace function reserve_ai_spend(p_day date, p_cap integer)
returns table (reserved_count integer)
language sql
security definer
set search_path = public
as $$
  insert into ai_spend_ledger as l (day, reserved)
  values (p_day, 1)
  on conflict (day) do update
    set reserved = l.reserved + 1,
        updated_at = now()
    where l.reserved - l.released < p_cap
  returning l.reserved;
$$;

-- Record the real provider usage after a successful call.
create or replace function finalize_ai_spend(
  p_day date,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  update ai_spend_ledger
    set used = used + 1,
        input_tokens = input_tokens + coalesce(p_input_tokens, 0),
        output_tokens = output_tokens + coalesce(p_output_tokens, 0),
        estimated_cost_usd = estimated_cost_usd + coalesce(p_cost, 0),
        updated_at = now()
    where day = p_day;
$$;

-- Give a failed call's reservation back to the day's budget.
create or replace function release_ai_spend(p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  update ai_spend_ledger
    set released = released + 1,
        updated_at = now()
    where day = p_day;
$$;
