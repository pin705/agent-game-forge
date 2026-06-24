/**
 * Owner-only access guard for a single conversation (rename / delete / messages
 * routes). Mirrors lib/editor/access.ts#authorizeProject:
 *
 *   • local-dev (no Supabase) → always allowed (zero-account loop).
 *   • prod                    → require an authed user; confirm the conversation
 *     exists and its owning project belongs to the caller. RLS also scopes every
 *     query, so a returned row is already owned — we treat "no row" as 404.
 */
import { getConversation, supabaseConfigured } from "./store";

export type ConversationAccess =
  | { ok: true }
  | { ok: false; status: 401 | 404; error: "unauthorized" | "not_found" };

export async function authorizeConversation(conversationId: string): Promise<ConversationAccess> {
  if (!supabaseConfigured()) return { ok: true };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };

  // RLS already restricts conversations to the owner; a returned row IS owned.
  const conv = await getConversation(conversationId);
  if (!conv) return { ok: false, status: 404, error: "not_found" };
  return { ok: true };
}
