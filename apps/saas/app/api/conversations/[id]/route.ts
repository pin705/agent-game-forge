import { NextRequest } from "next/server";
import * as conversations from "@/lib/conversations/store";
import { authorizeConversation } from "@/lib/conversations/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rename / delete a single conversation (Batch 2 ConversationList actions).
 *
 *   PATCH  /api/conversations/:id   { title }  → { conversation: ConversationDTO }
 *   DELETE /api/conversations/:id              → { ok: true }
 *
 * Owner-scoped: in prod, authorizeConversation confirms the caller owns the
 * conversation's project (RLS also enforces); open in local-dev.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeConversation(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  let body: { title?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return Response.json({ error: "title_required" }, { status: 400 });

  const conversation = await conversations.renameConversation(id, title);
  if (!conversation) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ conversation });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeConversation(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  await conversations.deleteConversation(id);
  return Response.json({ ok: true });
}
