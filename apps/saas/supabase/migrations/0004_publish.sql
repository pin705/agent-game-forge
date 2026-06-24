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
