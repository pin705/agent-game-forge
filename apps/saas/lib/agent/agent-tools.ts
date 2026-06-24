import { promises as fs } from "node:fs";
import path from "node:path";
import type { Sandbox, SandboxFile } from "@/lib/sandbox";

/**
 * The Python agent-tools live in `apps/saas/agent-tools/` (copied from the
 * daemon, per the P1 spec). We inject them into every sandbox under
 * `agent-tools/` so the model can run them via run_shell
 * (`python agent-tools/fetch-asset.py …`, `verify-game.py`, `pipeline.py`).
 *
 * Located relative to this module so it resolves regardless of cwd.
 */
function agentToolsDir(): string {
  // lib/agent/agent-tools.ts → ../../agent-tools
  return path.join(process.cwd(), "agent-tools");
}

async function readDirFiles(base: string, rel = ""): Promise<SandboxFile[]> {
  const dir = path.join(base, rel);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SandboxFile[] = [];
  for (const e of entries) {
    if (e.name === "__pycache__" || e.name === ".DS_Store") continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await readDirFiles(base, childRel)));
    else {
      try {
        // Read raw bytes (no encoding) so any file transfers verbatim.
        const bytes = new Uint8Array(await fs.readFile(path.join(base, childRel)));
        out.push({ path: `agent-tools/${childRel}`, bytes });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

/** Copy the saas app's agent-tools into the sandbox under `agent-tools/`. */
export async function copyAgentTools(sandbox: Sandbox): Promise<void> {
  const files = await readDirFiles(agentToolsDir());
  if (files.length) await sandbox.writeFiles(files);
}
