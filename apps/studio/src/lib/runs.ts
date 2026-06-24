// Typed client for the OGF daemon's run + conversation routes, proxied at
// /api → :7621. Mirrors apps/web/src/lib/api.ts exactly (same endpoints,
// payloads, and the createRun 409-duplicate handling). The studio app does
// not depend on @ogf/contracts, so the wire types are re-declared locally
// from packages/contracts/src/{events,api}.ts.

export type AgentId = 'codex' | 'claude-code';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// ---------------------------------------------------------------------------
// Question-form protocol (mirror of @ogf/contracts forms.ts).
// The agent emits <question-form id="...">{...JSON...}</question-form> inline;
// the daemon parses it and streams a typed `form` event. The UI renders an
// interactive card and feeds the user's answers back as the next turn.
// ---------------------------------------------------------------------------

export type FormFieldType = 'select' | 'radio' | 'checkbox' | 'text' | 'textarea';

export interface FormFieldOption {
  value: string;
  label: string;
  detail?: string;
}

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  options?: FormFieldOption[];
  default?: string | string[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface QuestionForm {
  id: string;
  title: string;
  intro?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface QuestionFormAnswers {
  formId: string;
  answers: Record<string, string | string[]>;
}

// ---------------------------------------------------------------------------
// Pending changes (sprite-slicing sidecars). Mirror of @ogf/contracts
// PendingSliceEntry / UsageHit (api.ts). These are local .ogf-slice.json edits
// the user made in the slicer that haven't been written into the engine yet.
// ---------------------------------------------------------------------------

export interface UsageHit {
  file: string;
  line: number;
  col: number;
  snippet: string;
}

export interface PendingSliceEntry {
  /** Source sprite path, e.g. assets/enemies/scout/sheet-transparent.png. */
  sourcePath: string;
  /** Path of the .ogf-slice.json sidecar. */
  sidecarPath: string;
  cols: number;
  rows: number;
  fps: number;
  anchor: string;
  padding: number;
  offsetX: number;
  offsetY: number;
  frameW?: number;
  frameH?: number;
  mtimeMs: number;
  /** Where the source sprite is referenced in the project. */
  usages: UsageHit[];
}

export interface TokenUsage {
  input?: number;
  output?: number;
  cachedRead?: number;
}

/** Mirror of @ogf/contracts AgentEvent (events.ts). */
export type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'form'; form: QuestionForm }
  | { type: 'raw'; raw: unknown };

/** Mirror of @ogf/contracts Message (api.ts). Persisted chat history; the
 *  agent's `events` array is replayed verbatim to rebuild a turn on refresh. */
export interface Message {
  id: number;
  conversationId: string;
  role: 'user' | 'agent';
  content: string;
  events?: AgentEvent[];
  position: number;
  createdAt: number;
}

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

/** Rename a conversation. Hits PATCH /api/conversations/:id which validates the
 *  conversation exists and returns the updated row, so callers can reconcile
 *  local state without a refetch. */
export const renameConversation = (id: string, title: string) =>
  jsonFetch<{ conversation: Conversation }>(
    `/api/conversations/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  ).then((r) => r.conversation);

/** Persisted message history for a conversation. Used on mount to rebuild the
 *  transcript (markdown + tool chips + forms) after a refresh / tab switch. */
export const fetchMessages = (conversationId: string) =>
  jsonFetch<{ messages: Message[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );

// -------------------- Files --------------------

/** Read a project file. Returns markdown/text in `content`, or base64 bytes in
 *  `base64` (with kind === 'image'). Used by the spec-approval form's inline
 *  viewer and by inline image previews in tool results. */
export const fetchFileContent = (projectPath: string, relPath: string) =>
  jsonFetch<{ kind?: 'text' | 'image' | 'binary'; content?: string; base64?: string }>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

/** Read a File's bytes as a bare base64 string (no `data:` URL prefix), which
 *  is what the daemon's ref store expects (it decodes with Buffer.from(_, 'base64')). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('unexpected reader result'));
      // result is a data URL: "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Upload an image File to the project's reference-image store and return its
 *  project-relative path (e.g. `.ogf/refs/<ts>_<name>.png`), suitable for
 *  CreateRunRequest.refImagePaths. Reuses the existing POST /api/files/refs
 *  route (the same one Dropzone's uploadRef uses). */
export async function uploadRefImage(projectPath: string, file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const r = await jsonFetch<{ relPath: string; size: number }>('/api/files/refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, filename: file.name, base64 }),
  });
  return r.relPath;
}

// -------------------- Pending changes --------------------

/** List the project's pending sprite-slicing edits (unapplied .ogf-slice.json
 *  sidecars). Daemon route: GET /api/projects/pending-slices. */
export const fetchPendingSlices = (projectPath: string) =>
  jsonFetch<{ pending: PendingSliceEntry[] }>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
  );

/** Discard ALL pending slicing changes (deletes every .ogf-slice.json sidecar;
 *  the underlying engine files are untouched). Daemon supports a bulk DELETE
 *  only — there is no per-sidecar discard endpoint. Daemon route:
 *  DELETE /api/projects/pending-slices. */
export const clearPendingSlices = (projectPath: string) =>
  jsonFetch<{ ok: true; removed: number }>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
    { method: 'DELETE' },
  );

// -------------------- Question forms --------------------

/** Format submitted answers as the prose block the agent reads on the next
 *  turn. Mirrors apps/web/src/App.tsx#onSubmitForm exactly so the daemon /
 *  agent sees an identical payload. The Chat sends this string as a normal
 *  run; there is no dedicated answer endpoint. */
export function formatFormAnswers(answers: QuestionFormAnswers): string {
  const lines: string[] = [`## Form answers (id=${answers.formId})`, ''];
  for (const [key, value] of Object.entries(answers.answers)) {
    if (Array.isArray(value)) {
      lines.push(`- **${key}**: ${value.join(', ') || '(none)'}`);
    } else {
      lines.push(`- **${key}**: ${value}`);
    }
  }
  return lines.join('\n');
}

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
