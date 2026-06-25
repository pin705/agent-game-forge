import { NextRequest } from "next/server";
import { getActiveRun } from "@/lib/agent/run-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/**
 * GET /api/runs/active?conversationId=<id>  → { runId: string | null }.
 *
 * The active (in-flight) run for a conversation — used by the client on mount to
 * re-attach after F5 / returning to the page. Owner-checked in prod (the run's
 * userId must match the authed user); open in local-dev.
 */
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId")?.trim();
  if (!conversationId) return Response.json({ runId: null });

  const state = getActiveRun(conversationId);
  if (!state) return Response.json({ runId: null });

  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (state.userId && state.userId !== user.id) return Response.json({ runId: null });
  }

  return Response.json({ runId: state.runId });
}
