import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent/run";
import type { RunEvent } from "@/lib/agent/events";
import { ENABLED_MODEL_IDS, isEnabledModel } from "@/lib/agent/catalog";
import { creditFloor, readBalance } from "@/lib/billing/credits";

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
  let body: { projectId?: string; prompt?: string; model?: string };
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

  // Optional model selection (P5). An explicit id MUST be an enabled catalog id
  // — premium tiers aren't wired, so we refuse them rather than fake a run. No
  // model → runAgent falls back to the default tier.
  const requestedModel = body.model?.trim();
  if (requestedModel && !isEnabledModel(requestedModel)) {
    return Response.json(
      { error: "model_unavailable", message: "That model isn't available yet.", allowed: ENABLED_MODEL_IDS },
      { status: 400 },
    );
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

    // Credit gate (§5 guardrail): refuse the run if the balance is below the
    // floor. 402 Payment Required so the UI can surface a top-up prompt.
    // Skipped entirely in local-dev (no Supabase) so the loop stays testable.
    const floor = creditFloor();
    const balance = await readBalance(userId);
    if (balance !== null && balance < floor) {
      return Response.json(
        {
          error: "out_of_credits",
          message: "Out of credits — top up to continue.",
          balance,
          floor,
        },
        { status: 402 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const gen = runAgent({ projectId, prompt, userId, model: requestedModel });
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
