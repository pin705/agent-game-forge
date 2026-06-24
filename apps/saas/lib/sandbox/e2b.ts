/* eslint-disable @typescript-eslint/no-explicit-any -- the E2B SDK is an
   optional prod-only dependency with no bundled types in this app; the adapter
   intentionally types it loosely and never loads it on the local path. */
import { fileText } from "@/lib/storage/types";
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
 * BINARY-ACCURATE (P5 Item 1): files move as raw bytes. Writes pass a
 * `Uint8Array` straight to `files.write`; reads use the SDK's byte format
 * (`files.read(path, { format: "bytes" })`) which returns a `Uint8Array`. A
 * base64-over-shell fallback guarantees byte integrity even if the SDK's byte
 * read isn't available, so binary game assets (PNG/WAV from the broker) survive
 * the storage ⇄ sandbox round-trip.
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
    for (const f of files) {
      // The SDK's files.write accepts binary content (ArrayBuffer/Blob/bytes).
      // Pass the raw Uint8Array so bytes are never re-encoded as text.
      await this.sb.files.write(this.abs(f.path), f.bytes);
    }
  }

  /** Read raw bytes for a single file, or null if missing. Prefers the SDK byte
   *  read; falls back to a base64-over-shell read for byte-exactness. */
  async readFile(p: string): Promise<Uint8Array | null> {
    const abs = this.abs(p);
    // Primary: documented byte read (format: "bytes" → Uint8Array).
    try {
      const data = await this.sb.files.read(abs, { format: "bytes" });
      if (data != null) return toUint8(data);
    } catch {
      /* fall through to base64 shell read */
    }
    // Fallback: base64 the file via the shell, decode locally. Byte-exact for
    // any content; only used if the SDK byte read above failed/returned null.
    try {
      const res = await this.exec(
        `base64 < ${shellQuote(abs)} 2>/dev/null || python3 -c "import sys,base64;sys.stdout.write(base64.b64encode(open(${pyQuote(abs)},'rb').read()).decode())"`,
      );
      if (res.code !== 0) return null;
      const b64 = res.stdout.replace(/\s+/g, "");
      if (!b64) {
        // Could be a genuinely empty file; confirm existence cheaply.
        const exists = await this.exec(`test -f ${shellQuote(abs)} && echo 1 || echo 0`);
        return exists.stdout.trim() === "1" ? new Uint8Array(0) : null;
      }
      return new Uint8Array(Buffer.from(b64, "base64"));
    } catch {
      return null;
    }
  }

  async readFileText(p: string): Promise<string | null> {
    const bytes = await this.readFile(p);
    return bytes === null ? null : fileText({ bytes });
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
      const bytes = await this.readFile(p);
      if (bytes !== null) out.push({ path: p, bytes });
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

/** Coerce the SDK's byte-read result (Uint8Array | ArrayBuffer | Buffer) → Uint8Array. */
function toUint8(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  // Last resort: Buffer.from handles array-likes / strings.
  return new Uint8Array(Buffer.from(data));
}

/** Single-quote a path for POSIX sh (wrap + escape embedded single quotes). */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
/** Quote a path as a Python single-quoted string literal. */
function pyQuote(p: string): string {
  return `'${p.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
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
