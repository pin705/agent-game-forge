-- =============================================================================
-- LEGACY / REFERENCE ONLY. Drizzle now owns schema + migrations
-- (`lib/db/schema.ts` + `drizzle/`, applied with `npm run db:migrate`). This
-- file is preserved as the authored source-of-truth that Drizzle was ported
-- from; do not apply it by hand for new setups. See apps/saas/README.md §b.
-- =============================================================================
-- =============================================================================
-- Footage SaaS — initial schema (P0)
-- Implements SAAS_ARCHITECTURE.md §4 (data model) + §5/§6 (credits, auth).
--
-- RLS is enabled on EVERY table. Policies scope rows to the owning user via
-- `auth.uid() = user_id` (child tables scope through their owning project/user).
-- The signup trigger seeds a profile + grants free starter credits.
--
-- Safe to re-run: guarded with IF NOT EXISTS / DROP ... IF EXISTS where Postgres
-- allows it. Run via the Supabase SQL editor or `supabase db push`. Do NOT run
-- against production without review.
-- =============================================================================

-- Free credits granted on signup (SAAS_ARCHITECTURE.md §5). Keep in sync with
-- profiles.credits_balance default below.
-- (Postgres has no top-level constant; the value is inlined in the trigger.)

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- =============================================================================
-- Tables
-- =============================================================================

-- profiles -------------------------------------------------------------------
-- 1:1 with auth.users. `id` IS the user id (so child-table RLS can compare to
-- auth.uid() directly). Balance is a convenience cache; credit_ledger is the
-- source of truth (§4).
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  credits_balance integer not null default 50,
  plan            text    not null default 'free',
  created_at      timestamptz not null default now()
);

-- projects -------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  slug          text not null,
  engine        text not null default 'canvas',
  r2_prefix     text not null,
  published_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists projects_user_id_idx on public.projects (user_id);
create unique index if not exists projects_user_slug_uidx on public.projects (user_id, slug);

-- conversations --------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_project_id_idx on public.conversations (project_id);
create index if not exists conversations_user_id_idx on public.conversations (user_id);

-- messages -------------------------------------------------------------------
-- `events jsonb` holds streamed tool/agent events; `position` orders within a
-- conversation. Scoped to the user via the owning conversation (RLS below).
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text,
  events          jsonb,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);

-- runs -----------------------------------------------------------------------
create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'succeeded', 'failed', 'canceled')),
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  images        integer not null default 0,
  sandbox_ms    integer not null default 0,
  credits_spent integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists runs_project_id_idx on public.runs (project_id);
create index if not exists runs_user_id_idx on public.runs (user_id);

-- credit_ledger --------------------------------------------------------------
-- Append-only source of truth for the balance (§4/§5). `delta` is positive for
-- grants/top-ups and negative for spend. Optional refs tie an entry to a run or
-- a payment.
create table if not exists public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  run_id     uuid references public.runs (id) on delete set null,
  payment_id uuid, -- references payment_orders(id); FK added after that table exists
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_id_idx on public.credit_ledger (user_id);

-- payment_orders -------------------------------------------------------------
-- SePay (VietQR) / Stripe top-ups (§5). `transfer_code` is the unique code the
-- user includes in the bank transfer; `sepay_txn_id` makes webhook handling
-- idempotent.
create table if not exists public.payment_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider        text not null default 'sepay' check (provider in ('sepay', 'stripe')),
  transfer_code   text not null unique,
  amount_vnd      integer not null,
  credits_granted integer not null,
  status          text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  sepay_txn_id    text unique,
  created_at      timestamptz not null default now()
);
create index if not exists payment_orders_user_id_idx on public.payment_orders (user_id);

-- Deferred FK: credit_ledger.payment_id → payment_orders.id (now that it exists).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_ledger_payment_id_fkey'
  ) then
    alter table public.credit_ledger
      add constraint credit_ledger_payment_id_fkey
      foreign key (payment_id) references public.payment_orders (id) on delete set null;
  end if;
end $$;

-- =============================================================================
-- updated_at maintenance
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

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security — enabled on EVERY table
-- =============================================================================
alter table public.profiles       enable row level security;
alter table public.projects        enable row level security;
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;
alter table public.runs            enable row level security;
alter table public.credit_ledger   enable row level security;
alter table public.payment_orders  enable row level security;

-- profiles: a user can read/update only their own profile (id = auth.uid()).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- INSERT is performed by the signup trigger (security definer); no client insert.

-- projects: full CRUD scoped to the owner.
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- conversations: scoped to the owner (user_id is denormalised for fast RLS).
drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own" on public.conversations
  for delete using (auth.uid() = user_id);

-- messages: no direct user_id column — scope through the owning conversation.
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- runs: scoped to the owner. Writes (token/credit metering) happen server-side
-- in P1+; reads are allowed to the owner here.
drop policy if exists "runs_select_own" on public.runs;
create policy "runs_select_own" on public.runs
  for select using (auth.uid() = user_id);

drop policy if exists "runs_insert_own" on public.runs;
create policy "runs_insert_own" on public.runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "runs_update_own" on public.runs;
create policy "runs_update_own" on public.runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- credit_ledger: append-only + read-own. The owner may read their ledger; the
-- signup trigger inserts the grant (security definer). No client UPDATE/DELETE
-- policy ⇒ rows are immutable to end users (append-only).
drop policy if exists "credit_ledger_select_own" on public.credit_ledger;
create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);

-- payment_orders: read-own; creation happens server-side (service role) in P3.
drop policy if exists "payment_orders_select_own" on public.payment_orders;
create policy "payment_orders_select_own" on public.payment_orders
  for select using (auth.uid() = user_id);

-- =============================================================================
-- Signup trigger: create profile + grant free starter credits (§5/§6)
-- =============================================================================
-- SECURITY DEFINER so it can write rows the new user can't yet (RLS bypass for
-- this trusted function only). Grants 50 credits and records the matching
-- append-only ledger entry (reason 'signup_grant'). Idempotent on re-fire.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- End of 0001_init.sql
-- =============================================================================
