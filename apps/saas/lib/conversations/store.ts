/**
 * Conversation + message store — the single seam the chat-history feature talks
 * to, with two backends chosen at runtime:
 *
 *   • prod  (`supabaseConfigured()`) → the `conversations` + `messages` tables
 *     (RLS-scoped to the owner). Reads use the request-bound client; persistence
 *     from a run uses the request client too (RLS still applies — the run is
 *     made by the owner).
 *   • local-dev (no/placeholder Supabase) → the on-disk JSON registry
 *     (lib/conversations/registry.ts), so the WHOLE history loop is exercisable
 *     with ZERO accounts (mirrors the publish-registry fallback).
 *
 * Everything above this seam (API routes, runAgent persistence) uses the
 * normalized DTO shapes below — never the raw row types — so the UI and the
 * tests don't care which backend is live.
 */
import * as registry from "./registry";

/** Normalized conversation DTO returned to the client. */
export type ConversationDTO = {
  id: string;
  projectId: string;
  title: string | null;
  /** Epoch millis. */
  createdAt: number;
  updatedAt: number;
};

/** Normalized message DTO returned to the client (events replayed verbatim). */
export type MessageDTO = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  events: unknown[] | null;
  position: number;
  createdAt: number;
};

/** True only when real (non-placeholder) Supabase env is present. */
export function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

function toMillis(ts: string | number | null | undefined): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const n = Date.parse(ts);
    return Number.isNaN(n) ? Date.now() : n;
  }
  return Date.now();
}

/* -------------------------------------------------------------------------- */
/* Supabase row mappers                                                       */
/* -------------------------------------------------------------------------- */

type ConversationRow = {
  id: string;
  project_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageDTO["role"];
  content: string | null;
  events: unknown[] | null;
  position: number;
  created_at: string;
};

function mapConversation(r: ConversationRow): ConversationDTO {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    createdAt: toMillis(r.created_at),
    updatedAt: toMillis(r.updated_at),
  };
}

function mapMessage(r: MessageRow): MessageDTO {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    events: r.events ?? null,
    position: r.position,
    createdAt: toMillis(r.created_at),
  };
}

function mapLocalConversation(c: registry.LocalConversation): ConversationDTO {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function mapLocalMessage(m: registry.LocalMessage): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    events: m.events,
    position: m.position,
    createdAt: m.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Supabase client helper                                                     */
/* -------------------------------------------------------------------------- */

async function sb() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

/* -------------------------------------------------------------------------- */
/* Public API — list / create / rename / delete / messages / append          */
/* -------------------------------------------------------------------------- */

/** List a project's conversations, most-recently-updated first. */
export async function listConversations(projectId: string): Promise<ConversationDTO[]> {
  if (!supabaseConfigured()) {
    return (await registry.listConversations(projectId)).map(mapLocalConversation);
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("conversations")
    .select("id, project_id, title, created_at, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => mapConversation(r as ConversationRow));
}

/** Create a conversation for a project (prod requires the owner's user_id). */
export async function createConversation(
  projectId: string,
  opts?: { title?: string | null; userId?: string },
): Promise<ConversationDTO | null> {
  if (!supabaseConfigured()) {
    return mapLocalConversation(await registry.createConversation(projectId, opts?.title ?? null));
  }
  if (!opts?.userId) return null;
  const supabase = await sb();
  const { data } = await supabase
    .from("conversations")
    .insert({ project_id: projectId, user_id: opts.userId, title: opts.title ?? null })
    .select("id, project_id, title, created_at, updated_at")
    .single();
  return data ? mapConversation(data as ConversationRow) : null;
}

/** Get a conversation by id (used to authorize message access). */
export async function getConversation(id: string): Promise<ConversationDTO | null> {
  if (!supabaseConfigured()) {
    const c = await registry.getConversation(id);
    return c ? mapLocalConversation(c) : null;
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("conversations")
    .select("id, project_id, title, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  return data ? mapConversation(data as ConversationRow) : null;
}

/** Rename a conversation. Returns the updated DTO (or null if missing). */
export async function renameConversation(id: string, title: string): Promise<ConversationDTO | null> {
  if (!supabaseConfigured()) {
    const c = await registry.renameConversation(id, title);
    return c ? mapLocalConversation(c) : null;
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", id)
    .select("id, project_id, title, created_at, updated_at")
    .maybeSingle();
  return data ? mapConversation(data as ConversationRow) : null;
}

/** Delete a conversation (and its messages, via FK cascade in prod). */
export async function deleteConversation(id: string): Promise<void> {
  if (!supabaseConfigured()) {
    await registry.deleteConversation(id);
    return;
  }
  const supabase = await sb();
  await supabase.from("conversations").delete().eq("id", id);
}

/** Fetch a conversation's messages, ordered by position. */
export async function listMessages(conversationId: string): Promise<MessageDTO[]> {
  if (!supabaseConfigured()) {
    return (await registry.listMessages(conversationId)).map(mapLocalMessage);
  }
  const supabase = await sb();
  const { data } = await supabase
    .from("messages")
    .select("id, conversation_id, role, content, events, position, created_at")
    .eq("conversation_id", conversationId)
    .order("position", { ascending: true });
  return (data ?? []).map((r) => mapMessage(r as MessageRow));
}

/**
 * Append a message. The position auto-increments from the current tail and the
 * conversation's updatedAt is bumped (so it floats to the top of history).
 */
export async function appendMessage(args: {
  conversationId: string;
  role: MessageDTO["role"];
  content: string | null;
  events?: unknown[] | null;
}): Promise<MessageDTO | null> {
  if (!supabaseConfigured()) {
    return mapLocalMessage(await registry.appendMessage(args));
  }
  const supabase = await sb();
  // Compute the next position from the current tail.
  const { data: tail } = await supabase
    .from("messages")
    .select("position")
    .eq("conversation_id", args.conversationId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (tail?.position ?? -1) + 1;
  const { data } = await supabase
    .from("messages")
    .insert({
      conversation_id: args.conversationId,
      role: args.role,
      content: args.content,
      events: args.events ?? null,
      position,
    })
    .select("id, conversation_id, role, content, events, position, created_at")
    .single();
  // Touch the conversation so it floats to the top of history. The
  // set_updated_at trigger overwrites this with now() — the point is just to
  // perform an UPDATE that fires the trigger.
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);
  return data ? mapMessage(data as MessageRow) : null;
}
