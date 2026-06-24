import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent/run";
import type { RunEvent } from "@/lib/agent/events";

// The agent loop shells out + touches the filesystem — it must run on Node.
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
 * POST /api/runs  { projectId, prompt }  → text/event-stream of RunEvents.
 *
 * Auth guard:
 *  - When Supabase is configured (prod), an authed user is required (401 else).
 *    Credit checks land in P2.
 *  - In local-dev mode (no/placeholder Supabase), unauthenticated runs are
 *    allowed so the loop can be smoke-tested with zero accounts.
 */
export async function POST(req: NextRequest) {
  let body: { projectId?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const projectId = body.projectId?.trim();
  const prompt = body.prompt?.trim();
  if (!projectId || !prompt) {
    return Response.json({ error: "projectId and prompt are required" }, { status: 400 });
  }

  let userId: string | undefined;
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    userId = user.id;
    // Defense-in-depth: confirm the project belongs to this user (RLS also enforces).
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const gen = runAgent({ projectId, prompt, userId });
        let next = await gen.next();
        while (!next.done) {
          controller.enqueue(encoder.encode(sse(next.value)));
          next = await gen.next();
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse({ type: "error", message: err instanceof Error ? err.message : String(err) }),
          ),
        );
      } finally {
        controller.close();
      }
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
