import { NextRequest } from "next/server";
import { getPack } from "@/lib/billing/packs";
import { supabaseConfigured } from "@/lib/billing/credits";
import { buildVietQrUrl, makeTransferCode } from "@/lib/payments/sepay";

// Touches Supabase (service-role insert) — must run on Node, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receiving-bank config for the VietQR, from env (placeholders in .env.example). */
function bankConfig() {
  return {
    account: process.env.SEPAY_BANK_ACCOUNT ?? "",
    code: process.env.SEPAY_BANK_CODE ?? "",
    name: process.env.SEPAY_ACCOUNT_NAME ?? "",
  };
}

/**
 * POST /api/credits/topup  { packId }  (authed)
 *
 * Creates a PENDING payment order for the chosen credit pack and returns
 * everything the UI needs to render a VietQR + bank details and start polling:
 *   { orderId, transferCode, amountVnd, credits, qrUrl, bank }
 *
 * Flow (§5): the user scans `qrUrl` / transfers `amountVnd` to `bank.account`
 * with `transferCode` in the memo; SePay later fires the webhook on the matching
 * incoming transfer, which grants the credits and marks this order `paid`.
 *
 * Modes:
 *  - Prod (Supabase configured + authed): inserts the order via the
 *    service-role client (server-to-server; the row is later updated by the
 *    webhook which has no user session). 401 if not authed.
 *  - Local-dev (no/placeholder Supabase): returns a SIMULATED order (random
 *    orderId, real transfer code + QR) so the top-up UI renders end-to-end with
 *    ZERO accounts. Nothing is persisted; polling stays 'pending'.
 */
export async function POST(req: NextRequest) {
  let body: { packId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const pack = getPack(body.packId);
  if (!pack) {
    return Response.json({ error: "unknown_pack" }, { status: 400 });
  }

  const transferCode = makeTransferCode();
  const bank = bankConfig();
  const qrUrl = buildVietQrUrl({
    account: bank.account,
    bank: bank.code,
    amountVnd: pack.amountVnd,
    transferCode,
  });

  // Local-dev: simulate (no persistence) so the QR UI works with no accounts.
  if (!supabaseConfigured()) {
    return Response.json({
      orderId: `local-${transferCode}`,
      transferCode,
      amountVnd: pack.amountVnd,
      credits: pack.credits,
      qrUrl,
      bank,
      simulated: true,
    });
  }

  // Prod: require an authed user, then create the pending order (service role).
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from("payment_orders")
      .insert({
        user_id: user.id,
        provider: "sepay",
        transfer_code: transferCode,
        amount_vnd: pack.amountVnd,
        credits_granted: pack.credits,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !data) {
      console.warn("[topup] order insert failed:", error?.message);
      return Response.json({ error: "order_create_failed" }, { status: 500 });
    }

    return Response.json({
      orderId: data.id as string,
      transferCode,
      amountVnd: pack.amountVnd,
      credits: pack.credits,
      qrUrl,
      bank,
    });
  } catch (err) {
    console.warn("[topup] threw:", err instanceof Error ? err.message : err);
    return Response.json({ error: "order_create_failed" }, { status: 500 });
  }
}
