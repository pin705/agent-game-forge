/**
 * Local projects registry — the zero-account dev stand-in for the `projects`
 * table Supabase holds in prod (supabase/migrations/0001_init.sql).
 *
 * In local-dev (no Supabase) there is no projects table, so we persist a small
 * JSON file under the data dir. This makes the dashboard "New game" → build page
 * loop runnable + browser-testable with ZERO external accounts — exactly like
 * lib/publish/registry.ts (publish state) and lib/conversations/registry.ts
 * (chat history) already do. In prod (`supabaseConfigured()`), this registry is
 * NEVER touched — Supabase + RLS is the source of truth.
 *
 * Concurrency: single-process in dev/CI; we read-modify-write the whole file
 * under a tiny in-process mutex (mirrors the sibling registries). Not built for
 * multi-writer prod — that's what Supabase is for.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

/** One project record (mirrors the prod `projects` row, dev subset). */
export type LocalProject = {
  id: string;
  /** Owner — the local-dev DEV_USER.id. Kept so ownership reads mirror prod. */
  userId: string;
  name: string;
  slug: string;
  engine: string;
  /** Epoch millis. */
  createdAt: number;
  updatedAt: number;
};

type RegistryFile = { projects: Record<string, LocalProject> };

function registryPath(): string {
  return path.join(dataDir(), "projects-registry.json");
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readFileSafe(): Promise<RegistryFile> {
  try {
    const raw = await fs.readFile(registryPath(), "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    if (parsed && typeof parsed === "object" && parsed.projects) return parsed;
  } catch {
    /* missing/corrupt → fresh */
  }
  return { projects: {} };
}

async function writeFileAtomic(data: RegistryFile): Promise<void> {
  const p = registryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, p);
}

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

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "game"}-${suffix}`;
}

function newId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new project owned by `userId`. Returns the created record. */
export async function createProject(args: {
  userId: string;
  name: string;
  engine?: string;
}): Promise<LocalProject> {
  return mutate((data) => {
    const now = Date.now();
    const rec: LocalProject = {
      id: newId(),
      userId: args.userId,
      name: args.name,
      slug: slugify(args.name),
      engine: args.engine ?? "canvas",
      createdAt: now,
      updatedAt: now,
    };
    data.projects[rec.id] = rec;
    return rec;
  });
}

/** Rename a project owned by `userId`. Returns the updated record (or null if
 *  the id is missing / not owned). Bumps `updatedAt`. */
export async function renameProject(args: {
  userId: string;
  id: string;
  name: string;
}): Promise<LocalProject | null> {
  return mutate((data) => {
    const rec = data.projects[args.id];
    if (!rec || rec.userId !== args.userId) return null;
    rec.name = args.name;
    rec.updatedAt = Date.now();
    return rec;
  });
}

/** Delete a project owned by `userId`. Returns true when a row was removed. */
export async function deleteProject(args: {
  userId: string;
  id: string;
}): Promise<boolean> {
  return mutate((data) => {
    const rec = data.projects[args.id];
    if (!rec || rec.userId !== args.userId) return false;
    delete data.projects[args.id];
    return true;
  });
}

/** Look up a project by id (no mutation). */
export async function getProject(id: string): Promise<LocalProject | null> {
  const data = await readFileSafe();
  return data.projects[id] ?? null;
}

/** List a user's projects, most-recently-updated first. */
export async function listProjects(userId: string): Promise<LocalProject[]> {
  const data = await readFileSafe();
  return Object.values(data.projects)
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
