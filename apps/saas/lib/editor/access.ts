/**
 * Owner-only access + safe-path helpers shared by the editor data layer
 * (the file read/write API and the draft-preview serving route).
 *
 * Two environments, matching the rest of the app:
 *   • prod (`supabaseConfigured()`) → require an authed user who OWNS the
 *     project row (RLS `createClient` + an explicit ownership check).
 *   • local-dev (no Supabase)       → open, so the whole editor loop is
 *     runtime-verifiable with zero accounts (same posture as the existing
 *     `/api/projects/[id]/files` list route and the publish loop).
 */
import { getStorage } from "@/lib/storage";
import { contentTypeFor, sanitizePlayPath } from "@/lib/publish/content-type";

/** True only when real (non-placeholder) Supabase env is present. */
export function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

export type AccessResult =
  | { ok: true }
  | { ok: false; status: 401 | 404; error: "unauthorized" | "project_not_found" };

/**
 * Authorize the current request for `projectId`. In local-dev this always
 * succeeds. In prod it requires an authed user and a matching project row that
 * the user owns (RLS already scopes the select to the caller, so a returned row
 * IS owned by them — we treat "no row" as 404).
 */
export async function authorizeProject(projectId: string): Promise<AccessResult> {
  if (!supabaseConfigured()) return { ok: true };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, status: 404, error: "project_not_found" };

  return { ok: true };
}

/**
 * Sanitize a repo-relative path for the FILE API (read/write a single file).
 *
 * Reuses the play-route sanitizer (rejects `..`, backslashes, NUL, drive
 * letters, `://`, decodes percent-encoding) so the exact same traversal
 * guarantees apply. The one difference: an empty/`/` path is INVALID here
 * (returns null) — the file API addresses a concrete file, it does not default
 * to index.html. A trailing-slash "directory" is likewise rejected.
 */
export function sanitizeFilePath(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "" || raw === "/" || raw.endsWith("/")) return null;
  const safe = sanitizePlayPath(raw);
  // sanitizePlayPath maps empty/dir → index.html; guard against an input that
  // collapsed to that only via real "index.html", not via emptiness above.
  if (safe === null) return null;
  return safe;
}

export type DraftServed = {
  /** The file's raw bytes, served verbatim. */
  body: Buffer;
  contentType: string;
  /** The sanitized repo-relative path actually served. */
  path: string;
  /** True when the request resolved to the game entry (index.html / no path). */
  isIndex: boolean;
};

export type DraftServeError = { error: "not_found" | "bad_path" };

/**
 * Serve one file from a project's CURRENT (draft, unpublished) storage prefix
 * — the live-preview source. Mirrors `serveProjectFile` (publish/core.ts) but
 * addresses the project directly by id (no slug / publish-state resolution),
 * since the owner is previewing their own in-progress game.
 *
 * Path-traversal safe via `sanitizePlayPath`; defaults to `index.html`.
 */
export async function serveDraftFile(
  projectId: string,
  rawPath: string | string[] | undefined | null,
): Promise<DraftServed | DraftServeError> {
  const safePath = sanitizePlayPath(rawPath);
  if (safePath === null) return { error: "bad_path" };

  const bytes = await getStorage().readProjectFile(projectId, safePath);
  if (bytes === null) return { error: "not_found" };

  return {
    body: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    contentType: contentTypeFor(safePath),
    path: safePath,
    isIndex: safePath === "index.html",
  };
}
