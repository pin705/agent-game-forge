/**
 * Account credit summary for the current (authed) user — reads through the
 * request-scoped Supabase client so RLS scopes everything to `auth.uid()`.
 * The balance is the cached `profiles.credits_balance`, kept consistent with
 * the append-only `credit_ledger` by the SQL charge/grant functions (§4/§5).
 *
 * Best-effort: returns nulls/empties when Supabase is absent (local dev) or the
 * profile/ledger isn't readable yet — never throws.
 */
import { DEV_CREDITS, supabaseConfigured } from "./credits";

export type LedgerEntry = {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
};

export type CreditSummary = {
  balance: number | null;
  recentLedger: LedgerEntry[];
};

export async function getCreditSummary(limit = 10): Promise<CreditSummary> {
  // Local-dev (no Supabase): surface the standing dev balance so /billing shows
  // a real number + the top-up flow is exercisable with ZERO accounts.
  if (!supabaseConfigured()) return { balance: DEV_CREDITS, recentLedger: [] };
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { balance: null, recentLedger: [] };

    const [{ data: profile }, { data: ledger }] = await Promise.all([
      supabase.from("profiles").select("credits_balance").eq("id", user.id).maybeSingle(),
      supabase
        .from("credit_ledger")
        .select("id, delta, reason, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    return {
      balance: profile ? (profile.credits_balance as number) : null,
      recentLedger: (ledger as LedgerEntry[] | null) ?? [],
    };
  } catch {
    return { balance: null, recentLedger: [] };
  }
}
