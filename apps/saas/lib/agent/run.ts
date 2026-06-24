import { getSandbox, sandboxDriverName } from "@/lib/sandbox";
import { getStorage, storageDriverName } from "@/lib/storage";
import type { RunEvent } from "./events";
import { runLoop, modelDriverName } from "./loop";
import { resolveModelId } from "./model";
import { copyAgentTools } from "./agent-tools";
import { chargeRun } from "@/lib/billing/credits";

export type RunResult = {
  runId: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  files: string[];
  /** Count of image-gen tool calls (0 today; image_gen deferred, §3). */
  images: number;
  /** Wall time the sandbox was alive, in milliseconds (metering, §5). */
  sandboxMs: number;
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
  /** Optional selected model id (P5). Validated against the enabled catalog;
   *  falls back to the default when absent/disallowed. This id is recorded on
   *  the run and PRICED per-tier (pricing.ts keys by it). */
  model?: string;
}): AsyncGenerator<RunEvent, RunResult, void> {
  const storage = getStorage();
  // Mark the wall clock just before the sandbox spins up — sandbox_ms is the
  // billable compute window (hydrate → loop → push → teardown).
  const sandboxStart = Date.now();
  const sandbox = await getSandbox();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // The resolved model ID drives metering + pricing (per-tier). The driver name
  // (deepseek/mock) is separate — which backend served the call.
  const modelId = resolveModelId(args.model);
  const driver = modelDriverName();

  const persist = await maybeCreateRunRow({
    runId,
    projectId: args.projectId,
    userId: args.userId,
    model: modelId,
  });

  yield {
    type: "run_start",
    runId,
    sandboxId: sandbox.id,
    model: modelId,
    driver: { sandbox: sandboxDriverName(), storage: storageDriverName(), model: driver },
  };

  let result: RunResult = {
    runId,
    inputTokens: 0,
    outputTokens: 0,
    steps: 0,
    files: [],
    images: 0,
    sandboxMs: 0,
  };
  // Count image-gen tool calls as we forward loop events (metering, §5). 0 today.
  let images = 0;

  try {
    // (a) hydrate: project files + the agent-tools (so run_shell can invoke them).
    const existing = await storage.getProjectFiles(args.projectId);
    if (existing.length) await sandbox.writeFiles(existing);
    await copyAgentTools(sandbox);

    // (b) drive the loop, forwarding every event.
    const loop = runLoop({ sandbox, prompt: args.prompt, modelId });
    let next = await loop.next();
    while (!next.done) {
      if (next.value.type === "tool_call" && next.value.name === "image_gen") images += 1;
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
      images,
      sandboxMs: Date.now() - sandboxStart,
    };

    yield {
      type: "done",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      steps: result.steps,
      files: result.files,
    };

    // (c2) Meter + charge: compute credits and, when Supabase is configured,
    // settle the ledger atomically. Local dev computes + logs without crashing.
    const charge = await chargeRun({
      dbRunId: persist?.dbRunId ?? null,
      userId: args.userId,
      usage: {
        model: modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        images: result.images,
        sandboxMs: result.sandboxMs,
      },
    });
    yield { type: "charge", credits: charge.credits, balanceAfter: charge.balanceAfter };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
    result.sandboxMs = Date.now() - sandboxStart;
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
  /** The runs.id created in Supabase — passed to record_run_charge on success. */
  dbRunId: string;
  /** Mark a run failed (the success path settles via record_run_charge). */
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
      dbRunId,
      async finish(status, r) {
        // Success is settled atomically by record_run_charge (status + metering
        // + ledger). This path only records terminal failure metering.
        try {
          await supabase
            .from("runs")
            .update({
              status,
              input_tokens: r.inputTokens,
              output_tokens: r.outputTokens,
              images: r.images,
              sandbox_ms: r.sandboxMs,
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
