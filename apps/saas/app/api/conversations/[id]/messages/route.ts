import { NextRequest } from "next/server";
import * as conversations from "@/lib/conversations/store";
import { authorizeConversation } from "@/lib/conversations/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persisted message history for a conversation (Batch 2). Used on mount to
 * rebuild the transcript (markdown + tool chips + question forms) after a
 * refresh / conversation switch.
 *
 *   GET /api/conversations/:id/messages → { messages: MessageDTO[] }
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeConversation(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const messages = await conversations.listMessages(id);
  return Response.json({ messages });
}
