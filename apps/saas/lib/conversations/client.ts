"use client";

/**
 * Browser-side client for the Batch-2 conversation + message routes, plus the
 * ref-image upload route. Mirrors the studio's lib/runs.ts shapes, adapted to
 * the SaaS endpoints (project-scoped conversations, MessageDTO with string ids).
 */
import type { ConversationDTO, MessageDTO } from "@/lib/conversations/store";

export type { ConversationDTO, MessageDTO };

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`${input}: ${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
}

export const fetchConversations = (projectId: string) =>
  jsonFetch<{ conversations: ConversationDTO[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/conversations`,
  );

export const createConversation = (projectId: string, title?: string) =>
  jsonFetch<{ conversation: ConversationDTO }>(
    `/api/projects/${encodeURIComponent(projectId)}/conversations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  ).then((r) => r.conversation);

export const renameConversation = (id: string, title: string) =>
  jsonFetch<{ conversation: ConversationDTO }>(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((r) => r.conversation);

export const deleteConversation = (id: string) =>
  jsonFetch<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });

export const fetchMessages = (conversationId: string) =>
  jsonFetch<{ messages: MessageDTO[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );

/**
 * Upload a reference image to the project. Returns the project-relative path,
 * suitable for the run's `refImagePaths`.
 */
export async function uploadRefImage(projectId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const r = await jsonFetch<{ path: string; bytes: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/upload`,
    { method: "POST", body: form },
  );
  return r.path;
}
