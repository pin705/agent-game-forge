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
