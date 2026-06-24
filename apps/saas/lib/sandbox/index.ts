import type { Sandbox, SandboxFactory } from "./types";
import { LocalSandboxFactory } from "./local";

export type { Sandbox, SandboxFile, ExecResult, ExecOptions } from "./types";

/** True when an E2B key is present (i.e. prod sandbox is configured). */
function e2bConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

/**
 * Sandbox factory. Returns an E2B-backed sandbox when `E2B_API_KEY` is set,
 * else the filesystem LocalSandbox (dev default). If E2B is configured but
 * creation fails (bad key, SDK missing), logs a warning and CLEANLY falls back
 * to local so a run never hard-crashes on infra.
 */
export async function getSandbox(): Promise<Sandbox> {
  if (e2bConfigured()) {
    try {
      const { E2BSandboxFactory } = await import("./e2b");
      return await new E2BSandboxFactory().createSandbox();
    } catch (err) {
      console.warn(
        `[sandbox] E2B_API_KEY set but E2B sandbox creation failed — falling back to LocalSandbox. Reason:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const factory: SandboxFactory = new LocalSandboxFactory();
  return factory.createSandbox();
}

/** Test/diagnostic helper — which driver would be selected. */
export function sandboxDriverName(): "e2b" | "local" {
  return e2bConfigured() ? "e2b" : "local";
}
