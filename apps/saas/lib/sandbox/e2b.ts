import type { ExecOptions, ExecResult, Sandbox, SandboxFactory, SandboxFile } from "./types";

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 120_000;
/** Sandbox working root inside the E2B VM. */
const ROOT = "/home/user/project";

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…[output truncated]" : s;
}

/**
 * E2B-backed sandbox (prod). Implemented against the documented
 * `@e2b/code-interpreter` SDK API. The SDK is imported dynamically and the
 * sandbox is created in `createSandbox()` — NEVER at module import — so a
 * missing key or missing dep cannot break the build or the local path.
 *
 * Activated by `getSandbox()` only when `E2B_API_KEY` is set; on any failure
 * the factory logs a warning and falls back to LocalSandbox.
 */
export class E2BSandbox implements Sandbox {
  readonly id: string;
  // Typed loosely: the SDK is an optional dependency, present only in prod.
  private sb: any;

  private constructor(sb: any) {
    this.sb = sb;
    this.id = `e2b-${sb.sandboxId ?? sb.id ?? "unknown"}`;
  }

  static async create(): Promise<E2BSandbox> {
    const mod: any = await import("@e2b/code-interpreter");
    const Ctor = mod.Sandbox ?? mod.default?.Sandbox ?? mod.default;
    const sb = await Ctor.create({ apiKey: process.env.E2B_API_KEY });
    try {
      await sb.files.makeDir(ROOT);
    } catch {
      /* dir may already exist */
    }
    return new E2BSandbox(sb);
  }

  private abs(p: string): string {
    return p.startsWith("/") ? p : `${ROOT}/${p}`;
  }

  async writeFiles(files: SandboxFile[]): Promise<void> {
    for (const f of files) await this.sb.files.write(this.abs(f.path), f.content);
  }

  async readFile(p: string): Promise<string | null> {
    try {
      return await this.sb.files.read(this.abs(p));
    } catch {
      return null;
    }
  }

  async readFiles(globs: string[]): Promise<SandboxFile[]> {
    // List the tree, then filter by glob client-side (parity with LocalSandbox).
    const res = await this.exec(
      `find . -type f -not -path './.git/*' | sed 's|^\\./||'`,
    );
    const paths = res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const matched = paths.filter((p) => globs.some((g) => globToRegExp(g).test(p)));
    const out: SandboxFile[] = [];
    for (const p of matched) {
      const content = await this.readFile(p);
      if (content !== null) out.push({ path: p, content });
    }
    return out;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const cwd = opts.cwd ? this.abs(opts.cwd) : ROOT;
    const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT;
    try {
      const res = await this.sb.commands.run(cmd, {
        cwd,
        timeoutMs,
      });
      return {
        stdout: truncate(res.stdout ?? ""),
        stderr: truncate(res.stderr ?? ""),
        code: res.exitCode ?? 0,
      };
    } catch (err: any) {
      // The SDK throws on non-zero exit; normalise to a result object.
      return {
        stdout: truncate(err?.stdout ?? ""),
        stderr: truncate((err?.stderr ?? "") + (err?.message ? `\n${err.message}` : "")),
        code: typeof err?.exitCode === "number" ? err.exitCode : 1,
      };
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.sb.kill();
    } catch {
      /* best-effort */
    }
  }
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export class E2BSandboxFactory implements SandboxFactory {
  async createSandbox(): Promise<Sandbox> {
    return E2BSandbox.create();
  }
}
