/**
 * Reference-image upload helper (Batch 2 attachments). The user attaches images
 * in the composer; we store them under the project's storage prefix at a
 * sanitized, collision-resistant path and return that project-relative path,
 * which is threaded into the run as context for the agent (run.ts).
 *
 * Stored under `.refs/` so they're clearly separate from the game's own files
 * (the agent can still read them via read_file). Bytes are stored verbatim
 * (binary-safe), matching the rest of the storage layer.
 */
import { getStorage } from "@/lib/storage";

/** Project-relative prefix all uploaded reference images live under. */
export const REFS_PREFIX = ".refs";

/** Sanitize a user-supplied filename to a safe basename (no path, no traversal). */
function safeName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "image";
  // Keep an extension if present; strip anything risky.
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return cleaned.slice(0, 80) || "image";
}

/** A unique, sortable, collision-resistant path for a stored reference image. */
export function refPathFor(filename: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${REFS_PREFIX}/${ts}_${rand}_${safeName(filename)}`;
}

/**
 * Store reference-image bytes under the project prefix; returns the
 * project-relative path. Pure data-layer (no auth) so it's unit-testable; the
 * API route does the authorization.
 */
export async function storeRefImage(
  projectId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const relPath = refPathFor(filename);
  await getStorage().writeProjectFile(projectId, relPath, bytes);
  return relPath;
}
