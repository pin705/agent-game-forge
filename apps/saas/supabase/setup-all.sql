-- ============================================================
-- Footage SaaS — FULL schema setup (run once in Supabase SQL editor)
-- Concatenation of migrations 0001→0004, in order.
-- After running, PostgREST reloads its schema cache automatically.
-- ============================================================


-- ============ migrations/0001_init.sql ============

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

-- ============ migrations/0002_credits.sql ============

-- =============================================================================
-- Footage SaaS — credits & metering (P2)
-- Implements SAAS_ARCHITECTURE.md §5 (credits & billing) on top of the §4 data
-- model from 0001_init.sql (runs, credit_ledger, profiles.credits_balance).
--
-- Two SECURITY DEFINER functions move all credit mutations into ONE atomic
-- transaction each, so the ledger (source of truth, §4) and the cached
-- profiles.credits_balance can never drift:
--
--   record_run_charge(...)  — charge a finished run (spend; negative delta)
--   grant_credits(...)      — top-up / signup grant (positive delta) — P3 reuses
--
-- SECURITY DEFINER (+ pinned search_path) lets trusted server code call these
-- via the service-role client; they bypass RLS deliberately and validate their
-- own inputs. No client-facing GRANTs are added here — only the server
-- (service role / definer-owner) should execute them.
--
-- Run via the Supabase SQL editor or `supabase db push` AFTER 0001_init.sql.
-- Do NOT run against production without review. (P2 deliverable does NOT execute
-- this anywhere — it ships for the user to apply.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- record_run_charge — atomically settle a finished run.
--
-- In ONE transaction (the function body is implicitly transactional):
--   1. update the `runs` row: token/image/sandbox metering + credits_spent +
--      status='succeeded',
--   2. append a NEGATIVE `credit_ledger` row (reason 'run', tied to run_id),
--   3. decrement profiles.credits_balance by the charged credits.
--
-- Idempotency: keyed on run_id. If a ledger row with reason='run' already
-- exists for this run_id, we DO NOTHING and return the current balance — so a
-- retried/duplicated call never double-charges. The ledger insert is the guard.
--
-- Returns the resulting credits_balance (for the SSE `charge` event).
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- grant_credits — atomically add credits (signup grant, top-up). P3 (SePay
-- webhook) reuses this after verifying a payment.
--
-- In ONE transaction: append a POSITIVE ledger row + bump the cached balance.
--
-- Idempotency: when p_payment_id is provided, a prior ledger row with that
-- payment_id short-circuits (so a re-fired payment webhook can't double-grant).
-- Grants without a payment_id (e.g. manual/promo) are not deduped here.
--
-- Returns the resulting credits_balance.
-- -----------------------------------------------------------------------------
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

-- Execution is restricted to trusted server code (service role bypasses RLS and
-- can call these). We do NOT grant EXECUTE to anon/authenticated — clients must
-- never call these directly. (Revoke from PUBLIC for defense-in-depth.)
revoke execute on function public.record_run_charge(uuid, uuid, integer, integer, integer, integer, integer) from public;
revoke execute on function public.grant_credits(uuid, integer, text, uuid) from public;

-- =============================================================================
-- End of 0002_credits.sql
-- =============================================================================

-- ============ migrations/0003_payments.sql ============

-- =============================================================================
-- Footage SaaS — payments / SePay top-ups (P3)
-- Implements SAAS_ARCHITECTURE.md §5 (top-up via SePay/VietQR) on top of the §4
-- `payment_orders` table from 0001_init.sql and the idempotent `grant_credits`
-- function from 0002_credits.sql (P3 REUSES grant_credits — no new grant path).
--
-- 0001_init.sql ALREADY provides everything P3 needs:
--   • payment_orders(transfer_code) is UNIQUE  → the webhook's lookup-by-code is
--     index-backed (a unique constraint creates a unique index).
--   • payment_orders(sepay_txn_id) is UNIQUE    → idempotency layer 1 (a second
--     webhook with the same SePay txn id can't insert/settle twice) is
--     index-backed and DB-enforced.
--   • grant_credits(p_user_id, p_amount, p_reason, p_payment_id) is idempotent
--     on payment_id (= order id) → idempotency layer 2.
--   • RLS policy payment_orders_select_own lets a user poll their OWN order
--     status; inserts/updates happen via the service role (webhook/topup route).
--
-- So this migration adds NO columns and changes NO behaviour. It only adds a
-- couple of OPTIONAL helper indexes for housekeeping queries, and is fully
-- idempotent (safe to re-run). If you don't run housekeeping sweeps you can
-- skip this file entirely — the flow works with just 0001 + 0002.
--
-- Run via the Supabase SQL editor or `supabase db push` AFTER 0001 + 0002.
-- Do NOT run against production without review.
-- =============================================================================

-- Speed up a "expire stale pending orders" sweep (e.g. a cron that marks
-- pending orders older than N minutes as 'expired'). Partial index keeps it tiny
-- (only pending rows are ever scanned by such a sweep).
create index if not exists payment_orders_pending_created_idx
  on public.payment_orders (created_at)
  where status = 'pending';

-- Speed up "my recent top-ups, newest first" in a future billing history view.
create index if not exists payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

-- (transfer_code + sepay_txn_id are already UNIQUE-indexed by 0001_init.sql —
--  intentionally not re-created here.)

-- =============================================================================
-- End of 0003_payments.sql
-- =============================================================================

-- ============ migrations/0004_publish.sql ============

-- =============================================================================
-- Footage SaaS — Publish + Share + Remix (P4)
-- Implements SAAS_ARCHITECTURE.md §8 P4 (public play page + Remix) on top of the
-- §4 `projects` table from 0001_init.sql.
--
-- The primary share mechanism is serving a published game straight from our own
-- storage at a public `/play/<slug>` URL — works identically in local-dev and
-- prod, needs ZERO Cloudflare. This migration only adds the columns + one helper
-- function + index that flow needs. (Cloudflare Pages "export" is an OPTIONAL
-- secondary path gated on CLOUDFLARE_* creds; it needs no schema.)
--
-- 0001_init.sql already provides `slug` and `published_url`; this adds the
-- publish *state* (is_published / published_at / play_count) and the remix
-- lineage (remixed_from).
--
-- Fully idempotent (alter ... add column if not exists / create ... if not
-- exists / create or replace). Run via the Supabase SQL editor or
-- `supabase db push` AFTER 0001–0003. Do NOT run against production without
-- review. (The P4 deliverable does NOT execute this anywhere — it ships for the
-- user to apply.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns on projects (publish state + remix lineage).
--   is_published  — public play page is live for this project's slug.
--   published_at  — when it was last published (null while unpublished).
--   play_count    — total index.html loads of the public play page (vanity/sort).
--   remixed_from  — the source project this was cloned from (null for originals).
-- (slug + published_url already exist from 0001_init.sql.)
-- -----------------------------------------------------------------------------
alter table public.projects add column if not exists is_published boolean not null default false;
alter table public.projects add column if not exists published_at  timestamptz;
alter table public.projects add column if not exists play_count    integer not null default 0;
alter table public.projects add column if not exists remixed_from  uuid references public.projects (id) on delete set null;

-- Resolve a published project by slug fast (the public play route's hot path).
-- Partial index → only published rows are indexed (tiny + exactly what the play
-- route filters on: slug + is_published).
create unique index if not exists projects_published_slug_uidx
  on public.projects (slug)
  where is_published;

-- Helps "remixes of this game" / lineage queries (cheap, rarely-null-skewed).
create index if not exists projects_remixed_from_idx
  on public.projects (remixed_from)
  where remixed_from is not null;

-- -----------------------------------------------------------------------------
-- increment_play_count — bump play_count by slug for a PUBLISHED project.
--
-- SECURITY DEFINER (+ pinned search_path) so the public play route can call it
-- via the service-role client without granting the anon role UPDATE on projects.
-- Only ever touches a single counter on a published row, so it's safe to expose
-- to trusted server code. Returns the new count (or null if no published match).
--
-- Idempotency is NOT a goal here — each index.html load is one legitimate play.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- RLS: published projects must be PUBLICLY READABLE for play.
--
-- The public play route (app/play/[slug]/…) resolves a project by slug with NO
-- session. Two ways to allow that: (a) a public SELECT policy for published
-- rows, or (b) read published projects via the service-role client (bypasses
-- RLS). We implement BOTH-friendly: add a narrow public SELECT policy so even an
-- anon/RLS-scoped client can resolve a published project's lookup columns, AND
-- the route uses the service-role client when configured. The policy is the
-- cleaner primitive (no service-role key needed just to play a public game) and
-- is intentionally limited to `is_published = true` rows — unpublished projects
-- stay owner-only via the existing `projects_select_own` policy.
--
-- NOTE: Postgres RLS is row-level, not column-level — a SELECT policy can't hide
-- individual columns. Exposing published rows leaks only non-sensitive fields
-- (name/slug/r2_prefix/play_count/published_url); there are no secrets on
-- `projects` (files live in R2, credentials in env). If you'd rather expose
-- nothing, drop this policy and rely solely on the service-role read in the
-- route (set SUPABASE_SERVICE_ROLE_KEY).
-- -----------------------------------------------------------------------------
drop policy if exists "projects_select_published_public" on public.projects;
create policy "projects_select_published_public" on public.projects
  for select
  using (is_published = true);

-- Execution of the counter fn is for trusted server code (service role) only;
-- don't grant it to anon/authenticated. (Revoke from PUBLIC for defense in
-- depth — matches the 0002 pattern.)
revoke execute on function public.increment_play_count(text) from public;

-- =============================================================================
-- End of 0004_publish.sql
-- =============================================================================
