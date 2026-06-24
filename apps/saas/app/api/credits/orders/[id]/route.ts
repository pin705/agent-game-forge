import { NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/credits/orders/[id]  (authed)  →  { status, credits, amountVnd }
 *
 * Polled by the top-up UI until `status` becomes 'paid' (set by the SePay
 * webhook once the matching transfer is verified + credits granted). Read
 * through the REQUEST-scoped client so RLS scopes the row to `auth.uid()` — a
 * user can only see their own orders.
 *
 * Local-dev (no Supabase, or a `local-…` simulated id): always returns
 * 'pending' so the UI shows the QR + waiting state with ZERO accounts. (There's
 * no bank/webhook locally, so it never flips to 'paid' — expected.)
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!supabaseConfigured() || id.startsWith("local-")) {
    return Response.json({ status: "pending", credits: null, amountVnd: null, simulated: true });
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("payment_orders")
    .select("status, credits_granted, amount_vnd")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({
    status: data.status as string,
    credits: data.credits_granted as number,
    amountVnd: data.amount_vnd as number,
  });
}
