/**
 * Server-side credit operations — the bridge between the pure pricing math
 * (./pricing.ts) and Supabase. Everything here is best-effort against Supabase:
 * when Supabase is absent/placeholder (local dev) the functions degrade
 * gracefully (compute + log, no persistence) and NEVER crash a run — matching
 * the local-driver-fallback philosophy of P1.
 *
 * SAAS_ARCHITECTURE.md §5 (credits), §4 (ledger is source of truth).
 */
import { creditsForRun, type RunUsage } from "./pricing";

/**
 * Standing balance shown in local-dev (no Supabase) — the same 50 free credits a
 * fresh signup gets in prod. Lets the top-nav chip, the /billing balance, and
 * the credit-gate path all render + be exercised with ZERO accounts. Charges in
 * local-dev are computed + logged but not persisted (see chargeRun), so this
 * stays constant — that's expected offline.
 */
export const DEV_CREDITS = 50;

/** Floor a run's balance must clear before it may start (§5 guardrail). */
export function creditFloor(): number {
  const n = Number(process.env.CREDIT_FLOOR);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** True only when real (non-placeholder) Supabase env is present. */
export function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/**
 * Read a user's current credits_balance via the service-role client (bypasses
 * RLS; called from trusted server code). Returns null if unavailable.
 */
export async function readBalance(userId: string): Promise<number | null> {
  if (!supabaseConfigured()) return null;
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("profiles")
      .select("credits_balance")
      .eq("id", userId)
      .maybeSingle();
    return data ? (data.credits_balance as number) : null;
  } catch {
    return null;
  }
}

export type ChargeResult = {
  /** Credits charged for the run (always computed, even in local dev). */
  credits: number;
  /** Resulting balance after the charge, or null when not persisted. */
  balanceAfter: number | null;
  /** True when the charge was written to Supabase (prod path). */
  persisted: boolean;
};

/**
 * Compute the credits for a run and, when Supabase is configured, settle it
 * atomically via the `record_run_charge` SQL function (updates the run row,
 * appends the negative ledger entry, decrements the balance — all in one
 * transaction, idempotent on run_id). In local dev, computes + logs only.
 */
export async function chargeRun(args: {
  dbRunId: string | null;
  userId: string | undefined;
  usage: RunUsage;
}): Promise<ChargeResult> {
  const credits = creditsForRun(args.usage);

  if (!supabaseConfigured() || !args.userId || !args.dbRunId) {
    // Local-dev / unauthed: prove the math without persistence (never crash).
    console.log(
      `[billing] run charge (not persisted): ${credits} credits ` +
        `(model=${args.usage.model} in=${args.usage.inputTokens} out=${args.usage.outputTokens} ` +
        `images=${args.usage.images ?? 0} sandboxMs=${args.usage.sandboxMs ?? 0})`,
    );
    return { credits, balanceAfter: null, persisted: false };
  }

  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("record_run_charge", {
      p_run_id: args.dbRunId,
      p_user_id: args.userId,
      p_credits: credits,
      p_input: args.usage.inputTokens,
      p_output: args.usage.outputTokens,
      p_images: args.usage.images ?? 0,
      p_sandbox_ms: args.usage.sandboxMs ?? 0,
    });
    if (error) {
      console.warn("[billing] record_run_charge failed:", error.message);
      return { credits, balanceAfter: null, persisted: false };
    }
    // The function returns the resulting balance (integer).
    const balanceAfter = typeof data === "number" ? data : null;
    return { credits, balanceAfter, persisted: true };
  } catch (err) {
    console.warn(
      "[billing] record_run_charge threw:",
      err instanceof Error ? err.message : err,
    );
    return { credits, balanceAfter: null, persisted: false };
  }
}
