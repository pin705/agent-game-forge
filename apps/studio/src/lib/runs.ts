// Typed client for the OGF daemon's run + conversation routes, proxied at
// /api → :7621. Mirrors apps/web/src/lib/api.ts exactly (same endpoints,
// payloads, and the createRun 409-duplicate handling). The studio app does
// not depend on @ogf/contracts, so the wire types are re-declared locally
// from packages/contracts/src/{events,api}.ts.

export type AgentId = 'codex' | 'claude-code';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Mirror of @ogf/contracts AgentEvent (events.ts). */
export type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'usage'; usage: { input?: number; output?: number; cachedRead?: number } }
  | { type: 'form'; form: unknown }
  | { type: 'raw'; raw: unknown };

export interface Conversation {
  id: string;
  projectPath: string;
  title: string | null;
  codexThreadId: string | null;
  agentId: AgentId;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRunRequest {
  agentId: AgentId;
  prompt: string;
  /** Either projectPath (when no conversation yet) OR conversationId (preferred). */
  projectPath?: string;
  conversationId?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  refImagePaths?: string[];
}

export interface CreateRunResponse {
  runId: string;
  conversationId: string;
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${input}: ${r.status} ${t}`);
  }
  return r.json() as Promise<T>;
}

// -------------------- Conversations --------------------

export const fetchConversations = (projectPath: string) =>
  jsonFetch<{ conversations: Conversation[] }>(
    `/api/conversations?projectPath=${encodeURIComponent(projectPath)}`,
  );

export const createConversation = (
  projectPath: string,
  agentId: AgentId = 'codex',
  title?: string,
) =>
  jsonFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, agentId, title }),
  });

// -------------------- Runs --------------------

/** createRun returns the new run normally, but if the server detects an
 *  active run for the same conversation it returns 409 with the existing
 *  runId. Caller should check `duplicate` and re-subscribe to that run's
 *  SSE stream instead of creating a duplicate agent spawn. */
export interface CreateRunDuplicate {
  duplicate: true;
  existingRunId: string;
  startedAt: number;
}

export async function createRun(
  req: CreateRunRequest,
): Promise<CreateRunResponse | CreateRunDuplicate> {
  const r = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (r.status === 409) {
    const data = (await r.json()) as { existingRunId: string; startedAt: number };
    return { duplicate: true, existingRunId: data.existingRunId, startedAt: data.startedAt };
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`/api/runs: ${r.status} ${t}`);
  }
  return r.json() as Promise<CreateRunResponse>;
}

export async function fetchActiveRun(conversationId: string): Promise<
  | { active: false }
  | { active: true; runId: string; status: string; startedAt: number; lastActivity: number }
> {
  return jsonFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/active-run`,
  );
}

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
}

export type StreamEvent =
  | { type: 'start'; data: { conversationId: string; resumed?: boolean } & Record<string, unknown> }
  | { type: 'agent'; data: AgentEvent }
  | { type: 'stdout'; data: { chunk: string } }
  | { type: 'stderr'; data: { chunk: string } }
  | { type: 'error'; data: { message: string; reason?: string } }
  | { type: 'end'; data: { code: number | null; status: string } };

/** Open an SSE stream for a run. Returns an unsubscribe closer — call it on
 *  unmount / conversation switch / before starting a new run to avoid leaking
 *  EventSource connections. */
export function subscribeRun(
  runId: string,
  onEvent: (e: StreamEvent) => void,
): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);

  const types: StreamEvent['type'][] = ['start', 'agent', 'stdout', 'stderr', 'error', 'end'];
  for (const t of types) {
    es.addEventListener(t, (ev) => {
      const e = ev as MessageEvent;
      try {
        const data = JSON.parse(e.data);
        onEvent({ type: t, data } as StreamEvent);
      } catch {
        // ignore malformed frame
      }
      if (t === 'end') es.close();
    });
  }

  es.onerror = () => {
    es.close();
  };

  return () => es.close();
}
