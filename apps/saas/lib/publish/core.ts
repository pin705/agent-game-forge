/**
 * Publish + Share + Remix — core orchestration (P4).
 *
 * SAAS_ARCHITECTURE.md §8 P4. The PRIMARY share mechanism is serving a published
 * game straight from our own storage (`getStorage()`) at a public `/play/<slug>`
 * URL. This works identically in local-dev and prod and needs ZERO Cloudflare.
 *
 * Everything here is environment-aware:
 *   • prod  (`supabaseConfigured()`)  → the `projects` table is the source of
 *     truth (publish columns from migration 0004); files in R2 via getStorage().
 *   • local-dev (no Supabase)         → the local publish registry stands in for
 *     the projects table (lib/publish/registry.ts); files in LocalStorage.
 *
 * These helpers are pure-ish (no Request/Response, no Next coupling) so the API
 * routes AND the integration test (scripts/publish-test.mjs) both drive the
 * exact same logic.
 */
import { getStorage, type ProjectFile } from "@/lib/storage";
import { contentTypeFor, isBinaryPath, sanitizePlayPath } from "./content-type";
import * as registry from "./registry";

/** True only when real (non-placeholder) Supabase env is present. (Mirrors the
 *  check used across the app — see lib/billing/credits.ts.) */
export function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

// ── slug generation ──────────────────────────────────────────────────────────

/** Lowercase, hyphenated ascii base from a name (no random suffix). */
function slugBase(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "game"
  );
}

/** Short url-safe random suffix (5 base36 chars). */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Produce a URL-safe slug from a name that is unique per the supplied
 * `isTaken` predicate. Tries the bare base first, then base+suffix, retrying on
 * collision. (Prod uniqueness is also DB-enforced by the partial unique index.)
 */
async function uniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugBase(name);
  // First attempt: bare base (prettier URLs when free).
  if (!(await isTaken(base))) return base;
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely; fall back to a longer random tail.
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

// ── result types ───────────────────────────────────────────────────────────

export type PublishResult = {
  projectId: string;
  slug: string;
  /** Absolute `/play/<slug>` URL. */
  publishedUrl: string;
  isPublished: boolean;
  playCount: number;
  /** Optional Cloudflare Pages export URL (only when CF export ran; see cf.ts). */
  exportUrl?: string | null;
};

export type ServedFile = {
  /** Decoded bytes of the file (text → utf8 bytes; binary → decoded). */
  body: Buffer;
  contentType: string;
  /** The sanitized repo-relative path actually served. */
  path: string;
  /** True when the request resolved to the game entry (index.html / no path). */
  isIndex: boolean;
};

export type ServeError = { error: "not_published" | "not_found" | "bad_path" };

/** Build the absolute `/play/<slug>` URL from an origin + slug. */
export function playUrl(origin: string, slug: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/play/${slug}`;
}

/**
 * Resolve the public base URL for play links. Prefers the explicit
 * NEXT_PUBLIC_SITE_URL, else the request origin passed by the caller, else a
 * localhost dev default.
 */
export function resolveSiteOrigin(requestOrigin?: string | null): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (requestOrigin) return requestOrigin.replace(/\/+$/, "");
  return "http://localhost:7640";
}

// ── publish / unpublish ──────────────────────────────────────────────────────

/**
 * Publish a project: ensure it has a unique slug, flip is_published=true, stamp
 * published_at, and persist published_url = the absolute `/play/<slug>` URL.
 * `origin` is used to build that absolute URL (caller derives it from the
 * request / NEXT_PUBLIC_SITE_URL).
 *
 * Prod: updates the projects row via the service-role client (owner already
 * verified by the route). Dev: upserts the local registry.
 */
export async function publishProject(args: {
  projectId: string;
  /** Origin for the public URL, e.g. https://studio.example.com. */
  origin: string;
  /** Fallback name when the project has none yet (dev path). */
  fallbackName?: string;
}): Promise<PublishResult> {
  const { projectId, origin } = args;

  if (supabaseConfigured()) {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, slug, is_published, play_count")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) throw new PublishError("project_not_found", 404);

    let slug = (project.slug as string) || "";
    // Ensure a usable, unique slug. The existing per-user slug from 0001 may not
    // be globally unique among PUBLISHED games, so re-check against published.
    const taken = async (s: string) => {
      const { data } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", s)
        .eq("is_published", true)
        .neq("id", projectId)
        .maybeSingle();
      return Boolean(data);
    };
    if (!slug || (await taken(slug))) {
      slug = await uniqueSlug((project.name as string) ?? args.fallbackName ?? "game", taken);
    }

    const publishedUrl = playUrl(origin, slug);
    const { data: updated, error } = await supabase
      .from("projects")
      .update({
        slug,
        is_published: true,
        published_at: new Date().toISOString(),
        published_url: publishedUrl,
      })
      .eq("id", projectId)
      .select("slug, play_count")
      .single();
    if (error || !updated) throw new PublishError(error?.message ?? "publish_failed", 500);

    return {
      projectId,
      slug: updated.slug as string,
      publishedUrl,
      isPublished: true,
      playCount: (updated.play_count as number) ?? 0,
    };
  }

  // ── local-dev: registry-backed simulated project ──
  const existing = await registry.getRecordById(projectId);
  let slug = existing?.slug ?? "";
  const taken = (s: string) => registry.slugTaken(s, projectId);
  if (!slug || (await taken(slug))) {
    slug = await uniqueSlug(existing?.name ?? args.fallbackName ?? "game", taken);
  }
  const publishedUrl = playUrl(origin, slug);
  const rec = await registry.upsertRecord({
    projectId,
    name: existing?.name ?? args.fallbackName ?? "Local game",
    slug,
    isPublished: true,
    publishedAt: new Date().toISOString(),
  });
  return {
    projectId,
    slug: rec.slug,
    publishedUrl,
    isPublished: true,
    playCount: rec.playCount,
  };
}

/**
 * Read the current publish state for a project (for SSR of the publish button).
 * Returns sensible defaults when the project/record is absent. The `origin` is
 * used to (re)build the play URL when published.
 */
export async function getPublishState(
  projectId: string,
  origin: string,
): Promise<{ isPublished: boolean; url: string | null; playCount: number; slug: string | null }> {
  if (supabaseConfigured()) {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("projects")
      .select("slug, is_published, play_count, published_url")
      .eq("id", projectId)
      .maybeSingle();
    if (!data) return { isPublished: false, url: null, playCount: 0, slug: null };
    const slug = (data.slug as string) ?? null;
    const isPublished = Boolean(data.is_published);
    return {
      isPublished,
      url: isPublished ? ((data.published_url as string) ?? (slug ? playUrl(origin, slug) : null)) : null,
      playCount: (data.play_count as number) ?? 0,
      slug,
    };
  }
  const rec = await registry.getRecordById(projectId);
  if (!rec) return { isPublished: false, url: null, playCount: 0, slug: null };
  return {
    isPublished: rec.isPublished,
    url: rec.isPublished ? playUrl(origin, rec.slug) : null,
    playCount: rec.playCount,
    slug: rec.slug,
  };
}

/** Unpublish a project (is_published=false). Idempotent. */
export async function unpublishProject(projectId: string): Promise<void> {
  if (supabaseConfigured()) {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();
    await supabase.from("projects").update({ is_published: false }).eq("id", projectId);
    return;
  }
  await registry.setPublished(projectId, false);
}

// ── resolve a published project by slug ──────────────────────────────────────

export type ResolvedProject = {
  projectId: string;
  slug: string;
  name: string;
};

/** Resolve a PUBLISHED project by slug → its id (for serving files). null if
 *  no published project owns that slug. */
export async function resolvePublishedProject(slug: string): Promise<ResolvedProject | null> {
  if (supabaseConfigured()) {
    // Prefer service-role (works even if the public RLS policy isn't applied);
    // the row is public-by-design when is_published.
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("projects")
      .select("id, name, slug, is_published")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();
    if (!data) return null;
    return { projectId: data.id as string, slug: data.slug as string, name: (data.name as string) ?? slug };
  }
  const rec = await registry.getPublishedBySlug(slug);
  if (!rec) return null;
  return { projectId: rec.projectId, slug: rec.slug, name: rec.name };
}

// ── serve a file from a published game ───────────────────────────────────────

/**
 * Serve one file from a published game's storage. THE core of the public play
 * page: resolve the slug → read the requested file (default index.html) from
 * getStorage() → return decoded bytes + Content-Type.
 *
 * Path-traversal safe: the requested path is sanitized (sanitizePlayPath) before
 * it ever reaches the storage adapter, and the adapter itself only ever reads
 * under `projects/<id>/`. Anything climbing out (`..`, absolute, backslash,
 * encoded variants) is rejected with `bad_path`.
 *
 * Play-count side effect is intentionally NOT here (a pure read) — callers bump
 * it once per index load via `recordPlay()`.
 */
export async function serveProjectFile(
  slug: string,
  rawPath: string | string[] | undefined | null,
): Promise<ServedFile | ServeError> {
  const safePath = sanitizePlayPath(rawPath);
  if (safePath === null) return { error: "bad_path" };

  const project = await resolvePublishedProject(slug);
  if (!project) return { error: "not_published" };

  const storage = getStorage();
  const content = await storage.readProjectFile(project.projectId, safePath);
  if (content === null) return { error: "not_found" };

  const contentType = contentTypeFor(safePath);
  // Storage holds UTF-8 text (P1 is text-only). For binary extensions we accept
  // base64-encoded content (forward-compat with a binary-aware writer) and
  // fall back to raw bytes if it isn't valid base64.
  let body: Buffer;
  if (isBinaryPath(safePath) && isLikelyBase64(content)) {
    body = Buffer.from(content, "base64");
  } else {
    body = Buffer.from(content, "utf8");
  }

  return {
    body,
    contentType,
    path: safePath,
    isIndex: safePath === "index.html",
  };
}

/** Bump play_count for a published slug (once per index load). Best-effort:
 *  never throws — a metrics miss must not break serving the game. Returns the
 *  new count, or null when unavailable. */
export async function recordPlay(slug: string): Promise<number | null> {
  try {
    if (supabaseConfigured()) {
      const { createServiceRoleClient } = await import("@/lib/supabase/server");
      const supabase = createServiceRoleClient();
      const { data } = await supabase.rpc("increment_play_count", { p_slug: slug });
      return typeof data === "number" ? data : null;
    }
    return await registry.incrementPlayCount(slug);
  } catch {
    return null;
  }
}

// ── remix ────────────────────────────────────────────────────────────────────

export type RemixResult = { projectId: string; name: string; slug: string };

export class PublishError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/**
 * Remix (clone) a source project for `userId`: create a NEW project row
 * (name = "<orig> (remix)", remixed_from = source id, NOT published) and copy
 * ALL files from the source's storage prefix to the new project's prefix via
 * the storage adapter.
 *
 * Guard: only a PUBLISHED source (or one owned by `userId`) may be remixed —
 * enforced by the caller resolving access, but we re-check published/owned here
 * for defense in depth.
 *
 * Identify the source by id OR slug (`srcRef`). Returns the new project id so
 * the UI can open it in the editor.
 */
export async function remixProject(args: {
  /** Source project id OR slug. */
  srcRef: string;
  /** Owner of the new (remixed) project. Undefined in local-dev. */
  userId?: string;
  /** Allow remixing a source the user OWNS even if it isn't published. */
  allowOwned?: boolean;
}): Promise<RemixResult> {
  const { srcRef, userId } = args;
  const storage = getStorage();

  if (supabaseConfigured()) {
    if (!userId) throw new PublishError("unauthorized", 401);
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const supabase = createServiceRoleClient();

    // Resolve source by id first, then slug.
    const byId = isUuid(srcRef)
      ? await supabase
          .from("projects")
          .select("id, name, slug, user_id, is_published, engine")
          .eq("id", srcRef)
          .maybeSingle()
      : { data: null };
    const src =
      byId.data ??
      (
        await supabase
          .from("projects")
          .select("id, name, slug, user_id, is_published, engine")
          .eq("slug", srcRef)
          .maybeSingle()
      ).data;
    if (!src) throw new PublishError("source_not_found", 404);

    const owned = src.user_id === userId;
    if (!src.is_published && !(owned && args.allowOwned)) {
      throw new PublishError("not_remixable", 403);
    }

    const name = `${src.name} (remix)`;
    const slug = await uniqueSlug(name, async (s) => {
      const { data } = await supabase.from("projects").select("id").eq("user_id", userId).eq("slug", s).maybeSingle();
      return Boolean(data);
    });

    // Create the new row first (need its id for the r2_prefix + file copy).
    const { data: created, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name,
        slug,
        engine: (src.engine as string) ?? "canvas",
        r2_prefix: "projects/pending",
        remixed_from: src.id,
        is_published: false,
      })
      .select("id")
      .single();
    if (error || !created) throw new PublishError(error?.message ?? "remix_create_failed", 500);

    const newId = created.id as string;
    await supabase.from("projects").update({ r2_prefix: `projects/${newId}` }).eq("id", newId);

    await copyAllFiles(storage, src.id as string, newId);

    return { projectId: newId, name, slug };
  }

  // ── local-dev: resolve via registry (or treat srcRef as a raw project id) ──
  let srcRec = await registry.getRecordById(srcRef);
  if (!srcRec) srcRec = await registry.getPublishedBySlug(srcRef);
  // Fall back to treating srcRef as a bare project id that has files in storage
  // even if it was never registered (keeps dev ergonomic).
  const srcId = srcRec?.projectId ?? srcRef;
  if (srcRec && !srcRec.isPublished && !args.allowOwned) {
    throw new PublishError("not_remixable", 403);
  }

  const srcName = srcRec?.name ?? "Local game";
  const name = `${srcName} (remix)`;
  const newId = `remix-${Math.random().toString(36).slice(2, 10)}`;
  const slug = await uniqueSlug(name, (s) => registry.slugTaken(s, newId));

  await copyAllFiles(storage, srcId, newId);

  await registry.upsertRecord({
    projectId: newId,
    name,
    slug,
    isPublished: false,
    remixedFrom: srcId,
  });

  return { projectId: newId, name, slug };
}

/** Copy every file from one project's prefix to another via the storage adapter. */
async function copyAllFiles(
  storage: ReturnType<typeof getStorage>,
  srcId: string,
  destId: string,
): Promise<void> {
  const files: ProjectFile[] = await storage.getProjectFiles(srcId);
  if (files.length > 0) await storage.putProjectFiles(destId, files);
}

// ── small utils ──────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Heuristic: does a stored string look like base64 (for binary assets)? */
function isLikelyBase64(s: string): boolean {
  if (s.length === 0 || s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}
