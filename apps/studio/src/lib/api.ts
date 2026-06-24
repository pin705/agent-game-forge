// Thin client for the existing OGF daemon (proxied at /api → :7621).
// The new shadcn studio reuses the backend untouched.

export type Project = {
  path: string;
  name: string;
  engine: string;
  createdAt?: number;
  updatedAt?: number;
  lastRunAt?: number;
};

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export const fetchProjects = () => jget<{ projects: Project[] }>('/api/projects');
export const openProject = (path: string) => jpost<{ project: Project }>('/api/projects/open', { path });
export const createProject = (req: { path: string; engine: string; name: string }) =>
  jpost<{ project: Project; files: string[] }>('/api/projects/create', req);
export const fsList = (p: string) => jget<{ cwd: string }>(`/api/fs/list?path=${encodeURIComponent(p)}`);
export const fetchFileContent = (projectPath: string, relPath: string) =>
  jget<{ content?: string }>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

export function projectId(p: Project): string {
  return btoa(p.path).replace(/[^a-zA-Z0-9]/g, '');
}

// -------------------- Publish to web (Cloudflare Pages) --------------------
// The daemon surfaces a human-readable `error` string on 4xx/5xx (e.g. the 400
// "configure Cloudflare in Settings" case). The default jget/jpost helpers
// above collapse failures to "<url>: <status>", so publish uses its own
// helpers that read the JSON `{ error }` body and throw that text instead —
// the message reaches the PublishDialog verbatim.

async function readError(r: Response, fallback: string): Promise<string> {
  try {
    const body = (await r.json()) as { error?: unknown };
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* non-JSON / empty body — fall back to the status line below */
  }
  return fallback;
}

/** Deploy the project to Cloudflare Pages. Resolves with the public URL.
 *  Rejects with the daemon's `error` text (400 when CF creds are missing,
 *  500 on deploy failure) so the UI can show it — and detect the creds case. */
export async function publishProject(projectPath: string): Promise<{ url: string }> {
  const r = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  });
  if (!r.ok) throw new Error(await readError(r, `Publish failed (${r.status})`));
  return r.json() as Promise<{ url: string }>;
}

/** Last-published URL for a project, or null if it has never been published. */
export function getPublishUrl(projectPath: string): Promise<{ url: string | null }> {
  return jget<{ url: string | null }>(`/api/publish?projectPath=${encodeURIComponent(projectPath)}`);
}
