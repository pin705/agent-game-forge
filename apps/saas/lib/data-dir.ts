import path from "node:path";

/**
 * Root of the app's local data dir. Everything written by the LOCAL drivers
 * (LocalStorage project files, LocalSandbox workspaces) lives under here.
 * Gitignored. Override with `OGF_DATA_DIR` for tests / CI.
 */
export function dataDir(): string {
  return process.env.OGF_DATA_DIR
    ? path.resolve(process.env.OGF_DATA_DIR)
    : path.join(process.cwd(), ".data");
}
