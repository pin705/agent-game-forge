/**
 * Sandbox adapter — a per-run, isolated, ephemeral workspace the agent edits
 * files in and runs shell commands against (the Python agent-tools, verify
 * steps, etc).
 *
 * Two drivers implement this interface:
 *   - LocalSandbox : a temp dir under `.data/sandboxes/<id>`, exec via
 *                    node:child_process. NO isolation — dev only. Makes P1
 *                    runtime-verifiable with zero accounts.
 *   - E2BSandbox   : the E2B code-interpreter SDK (prod) — real isolation.
 *
 * Selected at runtime by `getSandbox()` based on `E2B_API_KEY` (see ./index.ts).
 * Matches the `Sandbox` adapter interface in SAAS_ARCHITECTURE.md §3.
 */

export type SandboxFile = { path: string; content: string };

export type ExecResult = { stdout: string; stderr: string; code: number };

export type ExecOptions = {
  /** Working dir relative to the sandbox root (default: root). */
  cwd?: string;
  /** Hard timeout in ms (driver kills the process past this). */
  timeout?: number;
};

export interface Sandbox {
  /** Stable id for this sandbox instance. */
  readonly id: string;
  /** Write (upsert) files into the sandbox workspace. */
  writeFiles(files: SandboxFile[]): Promise<void>;
  /** Read files matching glob patterns (POSIX globs, relative to root). */
  readFiles(globs: string[]): Promise<SandboxFile[]>;
  /** Read a single file, or `null` if missing. */
  readFile(path: string): Promise<string | null>;
  /** Run a shell command; returns stdout/stderr/exit-code (never throws on non-zero). */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Tear down the workspace. Idempotent. */
  destroy(): Promise<void>;
}

export interface SandboxFactory {
  /** Spin up a fresh sandbox. */
  createSandbox(): Promise<Sandbox>;
}
