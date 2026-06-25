import { NextRequest } from "next/server";
import { getRun, subscribe } from "@/lib/agent/run-executor";
import type { RunEvent } from "@/lib/agent/events";

// SSE tail of a background run. Node runtime (the run touches the FS).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

function sse(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * GET /api/runs/[id]/stream?since=<n>  → text/event-stream.
 *
 * Replays the run's events since `since` (default 0), then tails live until the
 * run ends, then closes. This is the SAME path for both start (since=N after a
 * POST) and resume (since=0 on F5/return). 404 if the run is unknown/evicted.
 *
 * Owner-checked in prod (the run's userId must match the authed user); open in
 * local-dev.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const since = Number(req.nextUrl.searchParams.get("since") || 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const unsubscribe = subscribe(
        runId,
        since,
        (ev) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sse(ev)));
          } catch {
            close();
          }
        },
        () => close(),
      );

      // subscribe() returns null only if the run vanished between getRun and
      // here — close immediately so the client sees end-of-stream.
      if (!unsubscribe) {
        close();
        return;
      }

      // If the client disconnects, stop tailing (the run keeps going — the
      // executor owns it). This NEVER aborts the run.
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
