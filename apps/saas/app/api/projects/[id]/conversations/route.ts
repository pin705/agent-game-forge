import { NextRequest } from "next/server";
import { authorizeProject, supabaseConfigured } from "@/lib/editor/access";
import * as conversations from "@/lib/conversations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-project conversation history (Batch 2).
 *
 *   GET  /api/projects/:id/conversations      → { conversations: ConversationDTO[] }
 *   POST /api/projects/:id/conversations       → { conversation: ConversationDTO }
 *        body: { title?: string }
 *
 * Owner-only when Supabase is configured (RLS + authorizeProject); open in
 * local-dev (registry fallback), matching the rest of the editor routes.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const list = await conversations.listConversations(id);
  return Response.json({ conversations: list });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  let body: { title?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — untitled conversation */
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;

  // In prod we need the owner's user_id (the row is RLS-scoped to them).
  let userId: string | undefined;
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    userId = user.id;
  }

  const conversation = await conversations.createConversation(id, { title, userId });
  if (!conversation) return Response.json({ error: "create_failed" }, { status: 500 });
  return Response.json({ conversation });
}
