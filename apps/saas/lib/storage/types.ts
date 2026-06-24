/**
 * Storage adapter — per-project game files (R2 in prod, filesystem in dev).
 *
 * Two drivers implement this interface:
 *   - LocalStorage : files under `.data/projects/<projectId>/` (dev, zero accounts)
 *   - R2Storage    : S3-compatible Cloudflare R2 (prod)
 *
 * Selected at runtime by `getStorage()` based on env (see ./index.ts).
 *
 * BINARY-ACCURATE (P5 Item 1): a file's canonical content is raw `bytes`
 * (`Uint8Array`), NOT a UTF-8 string. This is what lets binary game assets
 * (PNG/JPG sprites, WAV/MP3 audio downloaded by the free-art broker) survive the
 * storage ⇄ sandbox round-trip byte-for-byte. Text is a convenience layer ON TOP:
 * use `textFile(path, string)` to author a text file and `fileText(file)` to read
 * one back as a string. The whole stack (LocalStorage, R2Storage, LocalSandbox,
 * E2BSandbox, run.ts hydrate/push-back, serveProjectFile) moves bytes; only the
 * model's `write_file` tool authors text (models emit html/js/json).
 */

/** A single project file: a repo-relative POSIX path + its raw byte content. */
export type ProjectFile = {
  /** Repo-relative POSIX path, e.g. `index.html` or `assets/sprite.png`. */
  path: string;
  /** Raw bytes — the canonical content (binary-safe; never re-encoded as text). */
  bytes: Uint8Array;
};

/** Construct a ProjectFile from UTF-8 text (the ergonomic path for code files). */
export function textFile(path: string, text: string): ProjectFile {
  return { path, bytes: new TextEncoder().encode(text) };
}

/** Decode a file's bytes as UTF-8 text. Safe for text files; for binary files
 *  the result is lossy (use `.bytes` directly when bytes matter). */
export function fileText(file: { bytes: Uint8Array }): string {
  return new TextDecoder().decode(file.bytes);
}

export interface Storage {
  /** Read every file for a project (empty array if the project has none yet). */
  getProjectFiles(projectId: string): Promise<ProjectFile[]>;
  /** Write (upsert) a set of files for a project. */
  putProjectFiles(projectId: string, files: ProjectFile[]): Promise<void>;
  /** List the repo-relative paths of a project's files. */
  listProjectFiles(projectId: string): Promise<string[]>;
  /** Read a single file's raw bytes, or `null` if it does not exist. */
  readProjectFile(projectId: string, path: string): Promise<Uint8Array | null>;
  /** Read a single file as UTF-8 text, or `null` if it does not exist. */
  readProjectFileText(projectId: string, path: string): Promise<string | null>;
  /** Write a single file from raw bytes. */
  writeProjectFile(projectId: string, path: string, bytes: Uint8Array): Promise<void>;
}
