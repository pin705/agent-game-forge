// Self-contained client for the OGF daemon's file-tree, file-content,
// filesystem-browse, project-open, and conversation routes (proxied at
// /api → :7621). No backend changes.
//
// This module is deliberately standalone — it does NOT import from lib/api.ts
// or lib/runs.ts so the studio's owned shell features (CodePanel, FileTree,
// OpenProjectDialog, ConversationList) have a single typed surface. Wire
// shapes mirror packages/contracts/src/api.ts exactly.

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function jsend<T>(
  url: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type EngineKind = 'godot' | 'unity' | 'web' | 'unknown';

export interface Project {
  path: string;
  name: string;
  engine: string;
  createdAt?: number;
  updatedAt?: number;
  lastOpenedAt?: number;
  lastRunAt?: number;
}

/** POST /api/projects/open — register/open an existing folder as a project.
 *  Used by OpenProjectDialog to IMPORT a project the dashboard didn't create. */
export const openProject = (path: string) =>
  jsend<{ project: Project }>('/api/projects/open', 'POST', { path });

// ---------------------------------------------------------------------------
// Filesystem browse (OpenProjectDialog's folder browser)
// ---------------------------------------------------------------------------

export interface FsListEntry {
  name: string;
  path: string;
  /** Set when the folder looks like a project (web/godot/unity). */
  engine?: string;
}

export interface FsListResult {
  /** Resolved current path. '' when listing Windows drive roots. */
  cwd: string;
  /** Parent path, or null at the top of the tree. */
  parent: string | null;
  /** Breadcrumb segments from root to cwd. */
  parts: { name: string; path: string }[];
  /** Windows drive list when at root. */
  drives?: string[];
  entries: FsListEntry[];
  /** The cwd itself looks like a project. */
  isProject?: boolean;
  engine?: string;
}

/** GET /api/fs/list?path= — list a directory for the folder picker. Pass ''
 *  to get the home dir (POSIX) or drive list (Windows). */
export const fsList = (path: string) =>
  jget<FsListResult>(`/api/fs/list?path=${encodeURIComponent(path)}`);

// ---------------------------------------------------------------------------
// File tree (CodePanel's left rail)
// ---------------------------------------------------------------------------

export type FileKind = 'text' | 'image' | 'binary';

export interface FileNode {
  name: string;
  /** POSIX, project-relative. '' for the root node. */
  relPath: string;
  kind: 'dir' | 'file';
  fileKind?: FileKind;
  size?: number;
  mtimeMs?: number;
  children?: FileNode[];
}

/** GET /api/files/tree?projectPath= — the project's file tree. */
export const fetchFileTree = (projectPath: string) =>
  jget<{ tree: FileNode }>(
    `/api/files/tree?projectPath=${encodeURIComponent(projectPath)}`,
  );

// ---------------------------------------------------------------------------
// File content (CodePanel's viewer/editor)
// ---------------------------------------------------------------------------

export interface ReadFileResponse {
  kind: FileKind;
  /** Present when kind === 'text'. */
  content?: string;
  /** base64 (no data: prefix) when kind === 'image'. */
  base64?: string;
  size: number;
  /** Server truncated the file (too large). */
  truncated?: boolean;
}

/** GET /api/files/content?projectPath=&relPath= — read one file. */
export const fetchFileContent = (projectPath: string, relPath: string) =>
  jget<ReadFileResponse>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

export interface WriteFileRequest {
  projectPath: string;
  relPath: string;
  content: string;
}

/** POST /api/files/content — overwrite a text file. */
export const writeFileContent = (req: WriteFileRequest) =>
  jsend<{ ok: true; size: number }>('/api/files/content', 'POST', req);

// ---------------------------------------------------------------------------
// Static file URL (image preview in CodePanel)
// ---------------------------------------------------------------------------

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Static URL for a project file via the daemon's web-play static mount.
 *  Mirrors lib/assets.ts#assetUrl. Resolves an <img src> to bytes on disk. */
export function fileUrl(projectPath: string, relPath: string): string {
  return `/api/web-play/${base64Url(projectPath)}/${relPath.replace(/\\/g, '/')}`;
}

// ---------------------------------------------------------------------------
// Conversations (ConversationList)
//
// fetchConversations/createConversation also live in lib/runs.ts, but that
// module (which we don't own) has no delete helper. ConversationList needs
// list + create + delete, so all three live here for a single import surface.
// ---------------------------------------------------------------------------

export type AgentId = 'codex' | 'claude-code';

export interface Conversation {
  id: string;
  projectPath: string;
  title: string | null;
  codexThreadId: string | null;
  agentId: AgentId;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/conversations?projectPath= — a project's conversations. */
export const fetchConversations = (projectPath: string) =>
  jget<{ conversations: Conversation[] }>(
    `/api/conversations?projectPath=${encodeURIComponent(projectPath)}`,
  );

/** POST /api/conversations — start a new conversation. */
export const createConversation = (
  projectPath: string,
  agentId: AgentId = 'codex',
  title?: string,
) =>
  jsend<{ conversation: Conversation }>('/api/conversations', 'POST', {
    projectPath,
    agentId,
    title,
  });

/** DELETE /api/conversations/:id — delete a conversation. */
export const removeConversation = (id: string) =>
  jsend<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}`, 'DELETE');
