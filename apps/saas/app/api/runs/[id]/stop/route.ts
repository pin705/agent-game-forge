import { NextRequest } from "next/server";
import { abortRun, getRun } from "@/lib/agent/run-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/**
 * POST /api/runs/[id]/stop  → { ok: true }.
 *
 * Cleanly aborts a background run (gen.return() → runAgent's finally → sandbox
 * teardown). Stops after the current in-flight step. Owner-checked in prod;
 * open in local-dev.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: runId } = await ctx.params;
  const state = getRun(runId);
  if (!state) return Response.json({ error: "not_found" }, { status: 404 });

  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (state.userId && state.userId !== user.id)
      return Response.json({ error: "not_found" }, { status: 404 });
  }

  await abortRun(runId);
  return Response.json({ ok: true });
}
