import { getSandbox, sandboxDriverName } from "@/lib/sandbox";
import { getStorage, storageDriverName } from "@/lib/storage";
import type { RunEvent } from "./events";
import { runLoop, modelDriverName } from "./loop";
import { copyAgentTools } from "./agent-tools";

export type RunResult = {
  runId: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  files: string[];
};

/**
 * Orchestrate a full agent run:
 *   (a) hydrate a fresh sandbox from storage (project files + the Python
 *       agent-tools so run_shell can use them),
 *   (b) drive the tool-use loop, streaming events,
 *   (c) push changed files back to storage,
 *   (d) destroy the sandbox,
 *   (e) return token totals.
 *
 * Supabase persistence is best-effort: if configured, the run + a summary
 * message are persisted; if not (local dev), it's skipped gracefully — a
 * missing/placeholder Supabase NEVER crashes the run.
 *
 * Yields RunEvents (async generator) so the API route can pipe SSE.
 */
export async function* runAgent(args: {
  projectId: string;
  prompt: string;
  userId?: string;
}): AsyncGenerator<RunEvent, RunResult, void> {
  const storage = getStorage();
  const sandbox = await getSandbox();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const model = modelDriverName();

  const persist = await maybeCreateRunRow({
    runId,
    projectId: args.projectId,
    userId: args.userId,
    model,
  });

  yield {
    type: "run_start",
    runId,
    sandboxId: sandbox.id,
    model,
    driver: { sandbox: sandboxDriverName(), storage: storageDriverName(), model },
  };

  let result: RunResult = { runId, inputTokens: 0, outputTokens: 0, steps: 0, files: [] };

  try {
    // (a) hydrate: project files + the agent-tools (so run_shell can invoke them).
    const existing = await storage.getProjectFiles(args.projectId);
    if (existing.length) await sandbox.writeFiles(existing);
    await copyAgentTools(sandbox);

    // (b) drive the loop, forwarding every event.
    const loop = runLoop({ sandbox, prompt: args.prompt });
    let next = await loop.next();
    while (!next.done) {
      yield next.value;
      next = await loop.next();
    }
    const totals = next.value;

    // (c) push changed files back (exclude the agent-tools we injected).
    const after = await sandbox.readFiles(["**/*"]);
    const projectFiles = after.filter((f) => !f.path.startsWith("agent-tools/"));
    if (projectFiles.length) await storage.putProjectFiles(args.projectId, projectFiles);

    result = {
      runId,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      steps: totals.steps,
      files: projectFiles.map((f) => f.path).sort(),
    };

    yield {
      type: "done",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      steps: result.steps,
      files: result.files,
    };

    await persist?.finish("succeeded", result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
    await persist?.finish("failed", result);
  } finally {
    // (d) tear down.
    await sandbox.destroy();
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Best-effort Supabase persistence                                           */
/* -------------------------------------------------------------------------- */

type PersistHandle = {
  finish(status: "succeeded" | "failed", r: RunResult): Promise<void>;
};

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

async function maybeCreateRunRow(args: {
  runId: string;
  projectId: string;
  userId?: string;
  model: string;
}): Promise<PersistHandle | null> {
  if (!supabaseConfigured() || !args.userId) return null;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data } = await supabase
      .from("runs")
      .insert({
        project_id: args.projectId,
        user_id: args.userId,
        status: "running",
        model: args.model,
      })
      .select("id")
      .single();
    const dbRunId = data?.id;
    if (!dbRunId) return null;

    return {
      async finish(status, r) {
        try {
          await supabase
            .from("runs")
            .update({
              status,
              input_tokens: r.inputTokens,
              output_tokens: r.outputTokens,
            })
            .eq("id", dbRunId);
        } catch {
          /* best-effort */
        }
      },
    };
  } catch {
    // Never let persistence failure crash a run.
    return null;
  }
}
