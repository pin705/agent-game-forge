import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "@/lib/data-dir";
import type { ExecOptions, ExecResult, Sandbox, SandboxFactory, SandboxFile } from "./types";

const MAX_OUTPUT = 200_000; // bytes per stream — truncation guard fed back to the model.
const DEFAULT_TIMEOUT = 120_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…[output truncated]" : s;
}

/**
 * Filesystem sandbox for local dev. A workspace dir under
 * `.data/sandboxes/<id>`; `exec` shells out via child_process with a timeout +
 * output cap. NO isolation between runs — strictly a dev driver, but it makes
 * the entire agent loop runnable end-to-end with zero external accounts.
 */
export class LocalSandbox implements Sandbox {
  readonly id: string;
  readonly root: string;

  constructor() {
    this.id = `local-${randomUUID().slice(0, 8)}`;
    this.root = path.join(dataDir(), "sandboxes", this.id);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async writeFiles(files: SandboxFile[]): Promise<void> {
    for (const f of files) {
      const full = path.join(this.root, f.path);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content, "utf8");
    }
  }

  async readFile(p: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.root, p), "utf8");
    } catch {
      return null;
    }
  }

  private async walk(rel = ""): Promise<string[]> {
    const dir = path.join(this.root, rel);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await this.walk(childRel)));
      else out.push(childRel);
    }
    return out;
  }

  async readFiles(globs: string[]): Promise<SandboxFile[]> {
    const all = await this.walk();
    const matched = all.filter((p) => globs.some((g) => globToRegExp(g).test(p)));
    return Promise.all(
      matched.map(async (p) => ({ path: p, content: (await this.readFile(p))! })),
    );
  }

  exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const cwd = opts.cwd ? path.join(this.root, opts.cwd) : this.root;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    return new Promise((resolve) => {
      const child = spawn(cmd, { cwd, shell: true });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeout);
      child.stdout.on("data", (d) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout: truncate(stdout),
          stderr: truncate(killed ? stderr + `\n[killed: timeout after ${timeout}ms]` : stderr),
          code: killed ? 124 : code ?? 0,
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ stdout: truncate(stdout), stderr: truncate(stderr + String(err)), code: 127 });
      });
    });
  }

  async destroy(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

/** Minimal POSIX-glob → RegExp (supports `**`, `*`, `?`). Enough for our patterns. */
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

export class LocalSandboxFactory implements SandboxFactory {
  async createSandbox(): Promise<Sandbox> {
    const sb = new LocalSandbox();
    await sb.init();
    return sb;
  }
}
