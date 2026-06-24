/**
 * Local publish registry — the zero-account dev stand-in for the `projects`
 * publish columns (is_published / published_at / play_count / remixed_from /
 * slug) that Supabase holds in prod.
 *
 * In local-dev (no Supabase) there is no projects table, so we persist publish
 * state to a small JSON file under the data dir. This makes the ENTIRE
 * publish → /play/<slug> → remix loop runnable + testable with ZERO external
 * accounts (LocalStorage for files + this for metadata). In prod
 * (`supabaseConfigured()`), the registry is never touched — Supabase is the
 * source of truth.
 *
 * Concurrency: the loop is single-process in dev/CI; we read-modify-write the
 * whole file under a tiny in-process mutex. Not built for multi-writer prod —
 * that's what Supabase is for.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

/** One published-project record in the local registry. */
export type LocalPublishRecord = {
  /** Project id (matches the LocalStorage prefix `projects/<id>/`). */
  projectId: string;
  /** Human name (for the play-page chrome + remix naming). */
  name: string;
  /** URL-safe slug — the public play path is `/play/<slug>`. */
  slug: string;
  isPublished: boolean;
  /** ISO timestamp of the last publish, or null. */
  publishedAt: string | null;
  playCount: number;
  /** Source project id when this was created via remix, else null. */
  remixedFrom: string | null;
};

type RegistryFile = { projects: Record<string, LocalPublishRecord> };

function registryPath(): string {
  return path.join(dataDir(), "publish-registry.json");
}

// In-process serialization so concurrent read-modify-write calls don't clobber.
let writeChain: Promise<unknown> = Promise.resolve();

async function readFile(): Promise<RegistryFile> {
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

/** Run a read-modify-write against the registry, serialized in-process. */
async function mutate<T>(fn: (data: RegistryFile) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const data = await readFile();
    const result = await fn(data);
    await writeFileAtomic(data);
    return result;
  };
  // Chain so writes never interleave; isolate failures from the shared chain.
  const next = writeChain.then(run, run);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Look up a record by project id (no mutation). */
export async function getRecordById(projectId: string): Promise<LocalPublishRecord | null> {
  const data = await readFile();
  return data.projects[projectId] ?? null;
}

/** Look up a PUBLISHED record by slug (the play route's resolver). */
export async function getPublishedBySlug(slug: string): Promise<LocalPublishRecord | null> {
  const data = await readFile();
  for (const rec of Object.values(data.projects)) {
    if (rec.slug === slug && rec.isPublished) return rec;
  }
  return null;
}

/**
 * List ALL published records, sorted for the gallery: play_count desc, then most
 * recently published first. The dev stand-in for the prod `projects` query.
 */
export async function listPublished(): Promise<LocalPublishRecord[]> {
  const data = await readFile();
  return Object.values(data.projects)
    .filter((r) => r.isPublished)
    .sort((a, b) => {
      if (b.playCount !== a.playCount) return b.playCount - a.playCount;
      return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    });
}

/** True if a slug is already taken by ANY project (published or not). */
export async function slugTaken(slug: string, exceptProjectId?: string): Promise<boolean> {
  const data = await readFile();
  for (const rec of Object.values(data.projects)) {
    if (rec.slug === slug && rec.projectId !== exceptProjectId) return true;
  }
  return false;
}

/** Create or update a record (upsert by projectId). Returns the stored record. */
export async function upsertRecord(
  rec: Partial<LocalPublishRecord> & { projectId: string },
): Promise<LocalPublishRecord> {
  return mutate((data) => {
    const prev = data.projects[rec.projectId];
    const merged: LocalPublishRecord = {
      projectId: rec.projectId,
      name: rec.name ?? prev?.name ?? "Local game",
      slug: rec.slug ?? prev?.slug ?? rec.projectId,
      isPublished: rec.isPublished ?? prev?.isPublished ?? false,
      publishedAt: rec.publishedAt ?? prev?.publishedAt ?? null,
      playCount: rec.playCount ?? prev?.playCount ?? 0,
      remixedFrom: rec.remixedFrom ?? prev?.remixedFrom ?? null,
    };
    data.projects[rec.projectId] = merged;
    return merged;
  });
}

/** Set is_published (and published_at) for a project. Returns the record. */
export async function setPublished(
  projectId: string,
  isPublished: boolean,
): Promise<LocalPublishRecord | null> {
  return mutate((data) => {
    const rec = data.projects[projectId];
    if (!rec) return null;
    rec.isPublished = isPublished;
    rec.publishedAt = isPublished ? new Date().toISOString() : rec.publishedAt;
    return rec;
  });
}

/** Increment play_count for a PUBLISHED slug. Returns the new count or null. */
export async function incrementPlayCount(slug: string): Promise<number | null> {
  return mutate((data) => {
    for (const rec of Object.values(data.projects)) {
      if (rec.slug === slug && rec.isPublished) {
        rec.playCount += 1;
        return rec.playCount;
      }
    }
    return null;
  });
}
