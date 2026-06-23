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
