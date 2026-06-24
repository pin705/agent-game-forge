/**
 * Local conversations registry — the zero-account dev stand-in for the
 * `conversations` + `messages` tables Supabase holds in prod (schema in
 * supabase/migrations/0001_init.sql).
 *
 * In local-dev (no Supabase) there are no tables, so we persist conversation
 * threads + their messages to a small JSON file under the data dir. This makes
 * the ENTIRE chat-history loop (list → select → load turns → rename → delete →
 * persist new run messages) runnable + testable with ZERO external accounts —
 * exactly like lib/publish/registry.ts does for publish state. In prod
 * (`supabaseConfigured()`), this registry is never touched.
 *
 * Concurrency: single-process in dev/CI; we read-modify-write the whole file
 * under a tiny in-process mutex (mirrors the publish registry). Not built for
 * multi-writer prod — that's what Supabase is for.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

/** One conversation thread (mirrors the prod `conversations` row). */
export type LocalConversation = {
  id: string;
  projectId: string;
  title: string | null;
  /** Epoch millis (created). */
  createdAt: number;
  /** Epoch millis (last activity — drives the history date grouping). */
  updatedAt: number;
};

/** One message in a conversation (mirrors the prod `messages` row). */
export type LocalMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  /** Streamed RunEvents persisted verbatim (the `events` jsonb column). */
  events: unknown[] | null;
  /** Order within the conversation. */
  position: number;
  /** Epoch millis. */
  createdAt: number;
};

type RegistryFile = {
  conversations: Record<string, LocalConversation>;
  /** conversationId → ordered messages. */
  messages: Record<string, LocalMessage[]>;
};

function registryPath(): string {
  return path.join(dataDir(), "conversations-registry.json");
}

// In-process serialization so concurrent read-modify-write calls don't clobber.
let writeChain: Promise<unknown> = Promise.resolve();

async function readFileSafe(): Promise<RegistryFile> {
  try {
    const raw = await fs.readFile(registryPath(), "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    if (parsed && typeof parsed === "object" && parsed.conversations && parsed.messages) {
      return parsed;
    }
  } catch {
    /* missing/corrupt → fresh */
  }
  return { conversations: {}, messages: {} };
}

async function writeFileAtomic(data: RegistryFile): Promise<void> {
  const p = registryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, p);
}

/** Run a read-modify-write against the registry, serialized in-process. */
async function mutate<T>(fn: (data: RegistryFile) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const data = await readFileSafe();
    const result = await fn(data);
    await writeFileAtomic(data);
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** List a project's conversations, most-recently-updated first. */
export async function listConversations(projectId: string): Promise<LocalConversation[]> {
  const data = await readFileSafe();
  return Object.values(data.conversations)
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Create a new conversation for a project. Returns the created record. */
export async function createConversation(
  projectId: string,
  title?: string | null,
): Promise<LocalConversation> {
  return mutate((data) => {
    const now = Date.now();
    const rec: LocalConversation = {
      id: newId("conv"),
      projectId,
      title: title ?? null,
      createdAt: now,
      updatedAt: now,
    };
    data.conversations[rec.id] = rec;
    data.messages[rec.id] = [];
    return rec;
  });
}

/** Get a conversation by id (no mutation). */
export async function getConversation(id: string): Promise<LocalConversation | null> {
  const data = await readFileSafe();
  return data.conversations[id] ?? null;
}

/** Rename a conversation. Returns the updated record (or null if missing). */
export async function renameConversation(
  id: string,
  title: string,
): Promise<LocalConversation | null> {
  return mutate((data) => {
    const rec = data.conversations[id];
    if (!rec) return null;
    rec.title = title;
    rec.updatedAt = Date.now();
    return rec;
  });
}

/** Delete a conversation and its messages. Idempotent. */
export async function deleteConversation(id: string): Promise<void> {
  await mutate((data) => {
    delete data.conversations[id];
    delete data.messages[id];
  });
}

/** Fetch a conversation's messages, ordered by position. */
export async function listMessages(conversationId: string): Promise<LocalMessage[]> {
  const data = await readFileSafe();
  const msgs = data.messages[conversationId] ?? [];
  return [...msgs].sort((a, b) => a.position - b.position);
}

/**
 * Append a message to a conversation. The position auto-increments from the
 * current tail. Bumps the conversation's updatedAt so it floats to the top of
 * the history list. Returns the stored message.
 */
export async function appendMessage(args: {
  conversationId: string;
  role: LocalMessage["role"];
  content: string | null;
  events?: unknown[] | null;
}): Promise<LocalMessage> {
  return mutate((data) => {
    const list = data.messages[args.conversationId] ?? (data.messages[args.conversationId] = []);
    const position = list.length;
    const msg: LocalMessage = {
      id: newId("msg"),
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      events: args.events ?? null,
      position,
      createdAt: Date.now(),
    };
    list.push(msg);
    const conv = data.conversations[args.conversationId];
    if (conv) conv.updatedAt = msg.createdAt;
    return msg;
  });
}
