-- =============================================================================
-- Custom migration: RLS + SECURITY DEFINER functions + signup trigger.
--
-- Drizzle's schema DSL (lib/db/schema.ts → drizzle/0000_*.sql) creates the
-- TABLES + indexes + FKs + CHECK constraints. It cannot express plpgsql
-- functions, the auth.users signup trigger, or (cleanly) RLS policies — so those
-- live here, copied/adapted VERBATIM from the legacy reference SQL:
--   supabase/migrations/0001_init.sql  (RLS + policies + set_updated_at +
--                                       handle_new_user trigger)
--   supabase/migrations/0002_credits.sql  (record_run_charge, grant_credits)
--   supabase/migrations/0004_publish.sql  (projects_select_published_public
--                                          policy + increment_play_count)
--
-- This file runs as part of `db:migrate` AFTER 0000 (tables exist). It is fully
-- idempotent: `drop policy if exists` before each `create policy`,
-- `create or replace function`, `drop trigger if exists` before each trigger.
--
-- IMPORTANT (drizzle migrator): statements are split ONLY on the dedicated
-- standalone breakpoint marker lines below, and NEVER inside a function body.
-- Each create-or-replace-function is therefore one statement, so the semicolons
-- inside plpgsql bodies do not break the splitter. (This comment intentionally
-- avoids writing the literal marker text — the splitter would split on it here.)
-- =============================================================================

-- pgcrypto provides gen_random_uuid() (used by the table DEFAULTs in 0000).
-- Idempotent; harmless if Supabase already enabled it.
create extension if not exists "pgcrypto";
--> statement-breakpoint

-- =============================================================================
-- updated_at maintenance (from 0001_init.sql)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists projects_set_updated_at on public.projects;
--> statement-breakpoint
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
--> statement-breakpoint

drop trigger if exists conversations_set_updated_at on public.conversations;
--> statement-breakpoint
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
--> statement-breakpoint

-- =============================================================================
-- Row Level Security — enabled on EVERY table (from 0001_init.sql)
-- =============================================================================
alter table public.profiles       enable row level security;
--> statement-breakpoint
alter table public.projects        enable row level security;
--> statement-breakpoint
alter table public.conversations   enable row level security;
--> statement-breakpoint
alter table public.messages        enable row level security;
--> statement-breakpoint
alter table public.runs            enable row level security;
--> statement-breakpoint
alter table public.credit_ledger   enable row level security;
--> statement-breakpoint
alter table public.payment_orders  enable row level security;
--> statement-breakpoint

-- profiles: a user can read/update only their own profile (id = auth.uid()).
drop policy if exists "profiles_select_own" on public.profiles;
--> statement-breakpoint
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
--> statement-breakpoint

drop policy if exists "profiles_update_own" on public.profiles;
--> statement-breakpoint
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
--> statement-breakpoint
-- INSERT is performed by the signup trigger (security definer); no client insert.

-- projects: full CRUD scoped to the owner.
drop policy if exists "projects_select_own" on public.projects;
--> statement-breakpoint
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "projects_insert_own" on public.projects;
--> statement-breakpoint
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "projects_update_own" on public.projects;
--> statement-breakpoint
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "projects_delete_own" on public.projects;
--> statement-breakpoint
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);
--> statement-breakpoint

-- conversations: scoped to the owner (user_id is denormalised for fast RLS).
drop policy if exists "conversations_select_own" on public.conversations;
--> statement-breakpoint
create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "conversations_insert_own" on public.conversations;
--> statement-breakpoint
create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "conversations_update_own" on public.conversations;
--> statement-breakpoint
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "conversations_delete_own" on public.conversations;
--> statement-breakpoint
create policy "conversations_delete_own" on public.conversations
  for delete using (auth.uid() = user_id);
--> statement-breakpoint

-- messages: no direct user_id column — scope through the owning conversation.
drop policy if exists "messages_select_own" on public.messages;
--> statement-breakpoint
create policy "messages_select_own" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );
--> statement-breakpoint

drop policy if exists "messages_insert_own" on public.messages;
--> statement-breakpoint
create policy "messages_insert_own" on public.messages
  for insert with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );
--> statement-breakpoint

drop policy if exists "messages_update_own" on public.messages;
--> statement-breakpoint
create policy "messages_update_own" on public.messages
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );
--> statement-breakpoint

drop policy if exists "messages_delete_own" on public.messages;
--> statement-breakpoint
create policy "messages_delete_own" on public.messages
  for delete using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );
--> statement-breakpoint

-- runs: scoped to the owner. Writes (token/credit metering) happen server-side
-- in P1+; reads are allowed to the owner here.
drop policy if exists "runs_select_own" on public.runs;
--> statement-breakpoint
create policy "runs_select_own" on public.runs
  for select using (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "runs_insert_own" on public.runs;
--> statement-breakpoint
create policy "runs_insert_own" on public.runs
  for insert with check (auth.uid() = user_id);
--> statement-breakpoint

drop policy if exists "runs_update_own" on public.runs;
--> statement-breakpoint
create policy "runs_update_own" on public.runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
--> statement-breakpoint

-- credit_ledger: append-only + read-own. The owner may read their ledger; the
-- signup trigger inserts the grant (security definer). No client UPDATE/DELETE
-- policy ⇒ rows are immutable to end users (append-only).
drop policy if exists "credit_ledger_select_own" on public.credit_ledger;
--> statement-breakpoint
create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);
--> statement-breakpoint

-- payment_orders: read-own; creation happens server-side (service role) in P3.
drop policy if exists "payment_orders_select_own" on public.payment_orders;
--> statement-breakpoint
create policy "payment_orders_select_own" on public.payment_orders
  for select using (auth.uid() = user_id);
--> statement-breakpoint

-- publish (P4, from 0004_publish.sql): published projects must be PUBLICLY
-- READABLE for the public /play/<slug> route (no session). Limited to
-- is_published = true rows; unpublished stay owner-only via projects_select_own.
drop policy if exists "projects_select_published_public" on public.projects;
--> statement-breakpoint
create policy "projects_select_published_public" on public.projects
  for select
  using (is_published = true);
--> statement-breakpoint

-- =============================================================================
-- Signup trigger: create profile + grant free starter credits (from 0001_init.sql)
-- SECURITY DEFINER so it can write rows the new user can't yet (RLS bypass for
-- this trusted function only). Grants 50 credits + the matching append-only
-- ledger entry (reason 'signup_grant'). Idempotent on re-fire.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  starter_credits constant integer := 50;
begin
  insert into public.profiles (id, credits_balance, plan)
  values (new.id, starter_credits, 'free')
  on conflict (id) do nothing;

  -- Only grant once per user (guard against duplicate trigger fires).
  if not exists (
    select 1 from public.credit_ledger
    where user_id = new.id and reason = 'signup_grant'
  ) then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, starter_credits, 'signup_grant');
  end if;

  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists on_auth_user_created on auth.users;
--> statement-breakpoint
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
--> statement-breakpoint

-- =============================================================================
-- record_run_charge — atomically settle a finished run (from 0002_credits.sql).
-- In ONE transaction: (1) update the runs row (metering + credits_spent +
-- status='succeeded'), (2) append a NEGATIVE credit_ledger row (reason 'run',
-- tied to run_id), (3) decrement profiles.credits_balance. Idempotent on run_id
-- (a prior reason='run' ledger row short-circuits → no double-charge). Returns
-- the resulting credits_balance (for the SSE `charge` event).
-- =============================================================================
create or replace function public.record_run_charge(
  p_run_id     uuid,
  p_user_id    uuid,
  p_credits    integer,
  p_input      integer,
  p_output     integer,
  p_images     integer,
  p_sandbox_ms integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_charge  integer := greatest(coalesce(p_credits, 0), 0); -- never a negative "spend"
begin
  -- Idempotency guard: a run is charged at most once.
  if exists (
    select 1 from public.credit_ledger
    where run_id = p_run_id and reason = 'run'
  ) then
    select credits_balance into v_balance
    from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  -- (1) Settle the run row: metering + credits + final status.
  update public.runs
     set input_tokens  = coalesce(p_input, 0),
         output_tokens = coalesce(p_output, 0),
         images        = coalesce(p_images, 0),
         sandbox_ms    = coalesce(p_sandbox_ms, 0),
         credits_spent = v_charge,
         status        = 'succeeded'
   where id = p_run_id;

  -- (2) Append the negative ledger entry (source of truth). Only when there's
  --     an actual charge — a 0-credit run records no ledger movement.
  if v_charge > 0 then
    insert into public.credit_ledger (user_id, delta, reason, run_id)
    values (p_user_id, -v_charge, 'run', p_run_id);
  end if;

  -- (3) Decrement the cached balance to match the ledger movement, and return
  --     it. (Equivalent to summing the ledger; we decrement for cheapness and
  --     keep it consistent because every mutation goes through these functions.)
  update public.profiles
     set credits_balance = credits_balance - v_charge
   where id = p_user_id
   returning credits_balance into v_balance;

  return v_balance;
end;
$$;
--> statement-breakpoint

-- =============================================================================
-- grant_credits — atomically add credits (signup grant, top-up). P3 (SePay
-- webhook) reuses this after verifying a payment (from 0002_credits.sql).
-- In ONE transaction: append a POSITIVE ledger row + bump the cached balance.
-- Idempotency: when p_payment_id is provided, a prior ledger row with that
-- payment_id short-circuits (a re-fired payment webhook can't double-grant).
-- Returns the resulting credits_balance.
-- =============================================================================
create or replace function public.grant_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_reason     text,
  p_payment_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_amount  integer := greatest(coalesce(p_amount, 0), 0); -- grants are non-negative
begin
  -- Idempotency for payment-backed grants.
  if p_payment_id is not null and exists (
    select 1 from public.credit_ledger where payment_id = p_payment_id
  ) then
    select credits_balance into v_balance
    from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  if v_amount > 0 then
    insert into public.credit_ledger (user_id, delta, reason, payment_id)
    values (p_user_id, v_amount, coalesce(p_reason, 'grant'), p_payment_id);

    update public.profiles
       set credits_balance = credits_balance + v_amount
     where id = p_user_id
     returning credits_balance into v_balance;
  else
    select credits_balance into v_balance
    from public.profiles where id = p_user_id;
  end if;

  return v_balance;
end;
$$;
--> statement-breakpoint

-- =============================================================================
-- increment_play_count — bump play_count by slug for a PUBLISHED project
-- (from 0004_publish.sql). SECURITY DEFINER (+ pinned search_path) so the public
-- play route can call it via the service-role client without granting anon
-- UPDATE on projects. Returns the new count (or null if no published match).
-- =============================================================================
create or replace function public.increment_play_count(p_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.projects
     set play_count = play_count + 1
   where slug = p_slug and is_published
   returning play_count into v_count;
  return v_count; -- null when no published project matches the slug
end;
$$;
--> statement-breakpoint

-- =============================================================================
-- Defense-in-depth: these functions are for trusted server code (service role)
-- only — revoke EXECUTE from PUBLIC so anon/authenticated clients can't call
-- them directly (from 0002_credits.sql + 0004_publish.sql).
-- =============================================================================
revoke execute on function public.record_run_charge(uuid, uuid, integer, integer, integer, integer, integer) from public;
--> statement-breakpoint
revoke execute on function public.grant_credits(uuid, integer, text, uuid) from public;
--> statement-breakpoint
revoke execute on function public.increment_play_count(text) from public;
