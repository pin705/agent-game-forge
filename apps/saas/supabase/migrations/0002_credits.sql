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
