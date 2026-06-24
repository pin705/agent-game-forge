import { NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/billing/credits";
import {
  extractTransferCode,
  parseSepayWebhook,
  verifyWebhookAuth,
} from "@/lib/payments/sepay";

// Server-to-server (no user session) — Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/sepay  — SePay fires this on every bank transaction on the
 * linked account. We turn a matching INCOMING transfer into granted credits.
 *
 * Steps (SAAS_ARCHITECTURE.md §5):
 *  (a) AUTH: verify `Authorization: Apikey <key>` == SEPAY_WEBHOOK_API_KEY
 *      (constant-time). Absent/wrong ⇒ 401. Fails closed if the key is unset.
 *  (b) PARSE the JSON body → { sepayTxnId, amountVnd, transferType, memo }.
 *  (c) IGNORE non-incoming (`transferType !== 'in'`) — 200, nothing to do.
 *  (d) EXTRACT our transfer code from the memo; look up the PENDING order.
 *  (e) VERIFY `transferAmount >= amount_vnd` (under-payment ⇒ ignore, 200).
 *  (f) IDEMPOTENCY (layer 1): if the order is already 'paid' or a row already
 *      carries this sepay_txn_id, return 200 WITHOUT re-granting.
 *  (g) GRANT via the existing `grant_credits(user, credits, 'topup', order_id)`
 *      SQL function (its payment_id idempotency is layer 2) + mark the order
 *      'paid' and store sepay_txn_id.
 *
 * Return policy: ALWAYS 200 for anything we handled or safely ignored (so SePay
 * doesn't retry forever). 4xx ONLY for auth (401) or unparseable body (400).
 * We NEVER trust amounts/codes from the body beyond matching a pre-created
 * pending order created by /api/credits/topup.
 */
export async function POST(req: NextRequest) {
  // (a) Auth — constant-time compare against the configured Apikey.
  const ok = verifyWebhookAuth(
    req.headers.get("authorization"),
    process.env.SEPAY_WEBHOOK_API_KEY,
  );
  if (!ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // (b) Parse.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const hook = parseSepayWebhook(raw);
  if (!hook) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  // (c) Only incoming transfers add credits.
  if (hook.transferType !== "in") {
    return Response.json({ ok: true, ignored: "not_incoming" });
  }

  // (d) Find our transfer code embedded in the bank memo.
  const transferCode = extractTransferCode(hook.memo);
  if (!transferCode) {
    // A legit transfer with no recognizable code (someone paid without our memo).
    // Nothing to credit; ack so SePay stops retrying.
    return Response.json({ ok: true, ignored: "no_transfer_code" });
  }

  // Without Supabase we can authenticate + parse but can't persist a grant.
  // Acknowledge so the endpoint is exercisable locally without a DB.
  if (!supabaseConfigured()) {
    return Response.json({ ok: true, simulated: true, transferCode, txn: hook.sepayTxnId });
  }

  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const admin = createServiceRoleClient();

    // (f) Idempotency layer 1a: a row already stamped with this txn id ⇒ done.
    const { data: byTxn } = await admin
      .from("payment_orders")
      .select("id, status")
      .eq("sepay_txn_id", hook.sepayTxnId)
      .maybeSingle();
    if (byTxn) {
      return Response.json({ ok: true, duplicate: "sepay_txn_id" });
    }

    // (d) Look up the order by our transfer code.
    const { data: order } = await admin
      .from("payment_orders")
      .select("id, user_id, amount_vnd, credits_granted, status")
      .eq("transfer_code", transferCode)
      .maybeSingle();

    if (!order) {
      // Code we didn't issue (or already cleaned up). Ack — don't retry.
      return Response.json({ ok: true, ignored: "order_not_found" });
    }

    // (f) Idempotency layer 1b: already settled.
    if (order.status === "paid") {
      return Response.json({ ok: true, duplicate: "already_paid" });
    }

    // (e) Amount check — must cover the order. NEVER trust the body's amount as
    //     the credit basis; we grant the ORDER's credits, the body only gates.
    if (hook.amountVnd < (order.amount_vnd as number)) {
      return Response.json({ ok: true, ignored: "amount_too_low" });
    }

    // (g) Grant credits via the existing idempotent SQL function (layer 2:
    //     payment_id = order.id dedupes inside the function too), then mark the
    //     order paid + stamp the txn id.
    const { error: grantErr } = await admin.rpc("grant_credits", {
      p_user_id: order.user_id,
      p_amount: order.credits_granted,
      p_reason: "topup",
      p_payment_id: order.id,
    });
    if (grantErr) {
      // Don't ack a failed grant — let SePay retry so credits aren't lost.
      console.warn("[sepay] grant_credits failed:", grantErr.message);
      return Response.json({ error: "grant_failed" }, { status: 500 });
    }

    // Mark paid + store the txn id. Guard the UPDATE on status='pending' so two
    // concurrent webhooks can't both flip it (the txn-id unique index + the
    // grant_credits payment_id guard are the other backstops).
    const { error: updErr } = await admin
      .from("payment_orders")
      .update({ status: "paid", sepay_txn_id: hook.sepayTxnId })
      .eq("id", order.id)
      .eq("status", "pending");
    if (updErr) {
      console.warn("[sepay] mark-paid failed (credits already granted):", updErr.message);
      // Credits were granted (idempotent); the order may be marked paid by the
      // racing call. Ack so SePay doesn't retry — grant_credits won't double.
    }

    return Response.json({ ok: true, granted: order.credits_granted, orderId: order.id });
  } catch (err) {
    console.warn("[sepay] webhook threw:", err instanceof Error ? err.message : err);
    // Transient/unexpected — let SePay retry.
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
