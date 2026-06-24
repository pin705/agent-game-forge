/**
 * Storage adapter — per-project game files (R2 in prod, filesystem in dev).
 *
 * Two drivers implement this interface:
 *   - LocalStorage : files under `.data/projects/<projectId>/` (dev, zero accounts)
 *   - R2Storage    : S3-compatible Cloudflare R2 (prod)
 *
 * Selected at runtime by `getStorage()` based on env (see ./index.ts).
 */

/** A single project file: a repo-relative POSIX path + its text content. */
export type ProjectFile = {
  /** Repo-relative POSIX path, e.g. `index.html` or `data/level.json`. */
  path: string;
  /** UTF-8 text content. (P1 is text-only; binary assets land in a later phase.) */
  content: string;
};

export interface Storage {
  /** Read every file for a project (empty array if the project has none yet). */
  getProjectFiles(projectId: string): Promise<ProjectFile[]>;
  /** Write (upsert) a set of files for a project. */
  putProjectFiles(projectId: string, files: ProjectFile[]): Promise<void>;
  /** List the repo-relative paths of a project's files. */
  listProjectFiles(projectId: string): Promise<string[]>;
  /** Read a single file, or `null` if it does not exist. */
  readProjectFile(projectId: string, path: string): Promise<string | null>;
  /** Write a single file. */
  writeProjectFile(projectId: string, path: string, content: string): Promise<void>;
}
