import { getSandbox, sandboxDriverName } from "@/lib/sandbox";
import { getStorage, storageDriverName } from "@/lib/storage";
import type { RunEvent } from "./events";
import { runLoop, modelDriverName } from "./loop";
import { resolveModelId } from "./model";
import { seedSandbox, isSeededPath } from "./seed-sandbox";
import { qaSmokeTest } from "./qa-gate";
import { chargeRun } from "@/lib/billing/credits";
import * as conversations from "@/lib/conversations/store";

/** Hard cap on auto-fix rounds (bounds cost: each round is a full model loop). */
const MAX_QA_FIX_ROUNDS = 2;

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
  /** The conversation this run was persisted to (created on demand). Null when
   *  persistence is unavailable (no userId in prod). */
  conversationId: string | null;
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
  /** Bind this run to an existing conversation; when absent, one is created for
   *  the project (Batch 2 chat history). */
  conversationId?: string;
  /** Project-relative reference-image paths the user attached to this message
   *  (Batch 2 attachments). Surfaced to the agent as context. */
  refImagePaths?: string[];
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

  // ── Conversation + message persistence (Batch 2) ───────────────────────────
  // Resolve (or create) the conversation, then persist the user prompt as a
  // `messages` row. Best-effort: a persistence failure NEVER crashes the run.
  let conversationId: string | null = args.conversationId ?? null;
  try {
    if (!conversationId) {
      const conv = await conversations.createConversation(args.projectId, {
        userId: args.userId,
        title: args.prompt.slice(0, 60),
      });
      conversationId = conv?.id ?? null;
    }
    if (conversationId) {
      await conversations.appendMessage({
        conversationId,
        role: "user",
        content: args.prompt,
        // Record the attached references on the user turn so they replay in history.
        events: args.refImagePaths?.length
          ? [{ type: "refs", paths: args.refImagePaths }]
          : null,
      });
    }
  } catch {
    /* best-effort persistence — never crash the run */
  }

  // Reference images: surface their project-relative paths to the agent as
  // context text. (DeepSeek's chat tier is text-only; the agent can read the
  // files via read_file / list the refs prefix. This matches studio's intent:
  // the agent KNOWS about the uploaded reference images.)
  const effectivePrompt =
    args.refImagePaths && args.refImagePaths.length
      ? `${args.prompt}\n\n---\nReference images attached by the user (project-relative paths):\n${args.refImagePaths
          .map((p) => `- ${p}`)
          .join("\n")}\nInspect them with read_file if helpful.`
      : args.prompt;

  // Collect streamed events so the assistant turn can be persisted verbatim
  // (the `events` jsonb column → replayed by the client to rebuild the turn).
  const collected: RunEvent[] = [];

  yield {
    type: "run_start",
    runId,
    sandboxId: sandbox.id,
    model: modelId,
    conversationId,
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
    conversationId,
  };
  // Count image-gen tool calls as we forward loop events (metering, §5). 0 today.
  let images = 0;

  try {
    // (a) hydrate: project files + the agent-tools (so run_shell can invoke
    //     them) + the build corpus (conventions / pipeline manifest / recipes /
    //     foundation seeds / skills) at the daemon-equivalent paths, so the
    //     prompt's reads and the Python tools' lookups resolve like a local build.
    const existing = await storage.getProjectFiles(args.projectId);
    if (existing.length) await sandbox.writeFiles(existing);
    await seedSandbox(sandbox);

    // (b) drive the loop, forwarding every event (and collecting them for the
    //     persisted assistant turn).
    const loop = runLoop({ sandbox, prompt: effectivePrompt, modelId });
    let next = await loop.next();
    while (!next.done) {
      if (next.value.type === "tool_call" && next.value.name === "image_gen") images += 1;
      collected.push(next.value);
      yield next.value;
      next = await loop.next();
    }
    const totals = next.value;
    // Accumulate token totals across the build loop AND any QA fix rounds.
    let inputTokens = totals.inputTokens;
    let outputTokens = totals.outputTokens;
    let steps = totals.steps;

    // ── (b2) QA GATE: real-browser smoke test + bounded auto-fix loop ─────────
    // Static verify (verify-game.py) is the floor; this catches RUNTIME errors
    // (uncaught exceptions, failed module fetches, undefined access on first
    // frame) that only surface when the game actually boots + plays. We load
    // the built game in headless Chrome, drive start + movement, and if it
    // throws we run a focused fix round (≤2). The MockModel can't fix anything,
    // so we run QA for SIGNAL only (no fix loop) when the driver is the mock —
    // its scripted game is QA-clean, so the e2e stays green with 0 fix rounds.
    // The gate gracefully SKIPS (no browser → ran:false) in prod/CI so a build
    // never blocks on infra; static verify still gates those.
    {
      const readCurrent = async () =>
        (await sandbox.readFiles(["**/*"])).filter((f) => !isSeededPath(f.path));

      let qa = await qaSmokeTest(await readCurrent());

      if (!qa.ran) {
        yield { type: "qa", phase: "skipped", errors: [] };
      } else if (qa.errors.length === 0) {
        yield { type: "qa", phase: "clean", errors: [] };
      } else if (driver === "mock") {
        // Signal only — the mock can't perform a fix. (In practice the mock's
        // game is clean so this branch shouldn't trigger; we surface it anyway.)
        yield { type: "qa", phase: "remain", errors: qa.errors };
      } else {
        // Auto-fix loop: feed the runtime errors back to the SAME sandbox so the
        // model edits the SAME files, re-verify, repeat up to the cap.
        for (let round = 1; round <= MAX_QA_FIX_ROUNDS && qa.ran && qa.errors.length; round++) {
          yield { type: "qa", phase: "found", errors: qa.errors, round };

          const fixPrompt = qaFixPrompt(qa.errors);
          const fixLoop = runLoop({ sandbox, prompt: fixPrompt, modelId });
          let fixNext = await fixLoop.next();
          while (!fixNext.done) {
            if (fixNext.value.type === "tool_call" && fixNext.value.name === "image_gen") images += 1;
            collected.push(fixNext.value);
            yield fixNext.value;
            fixNext = await fixLoop.next();
          }
          inputTokens += fixNext.value.inputTokens;
          outputTokens += fixNext.value.outputTokens;
          steps += fixNext.value.steps;

          qa = await qaSmokeTest(await readCurrent());
        }

        if (!qa.ran) {
          yield { type: "qa", phase: "skipped", errors: [] };
        } else if (qa.errors.length === 0) {
          yield { type: "qa", phase: "clean", errors: [] };
        } else {
          yield { type: "qa", phase: "remain", errors: qa.errors };
        }
      }
    }

    // (c) push changed files back (exclude everything WE seeded — the Python
    //     agent-tools + the build corpus + its scratch state — so storage holds
    //     only the agent's actual project output, never the injected guidance).
    const after = await sandbox.readFiles(["**/*"]);
    const projectFiles = after.filter((f) => !isSeededPath(f.path));
    if (projectFiles.length) await storage.putProjectFiles(args.projectId, projectFiles);

    result = {
      runId,
      inputTokens,
      outputTokens,
      steps,
      files: projectFiles.map((f) => f.path).sort(),
      images,
      sandboxMs: Date.now() - sandboxStart,
      conversationId,
    };

    const doneEvent: RunEvent = {
      type: "done",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      steps: result.steps,
      files: result.files,
      status: totals.awaitingInput ? "awaiting_input" : "complete",
    };
    collected.push(doneEvent);
    yield doneEvent;

    // Persist the assistant turn: its final text + the full event stream (so the
    // client can rebuild markdown, tool chips, and any question form on reload).
    if (conversationId) {
      const finalText = collected
        .filter((e): e is Extract<RunEvent, { type: "text_delta" }> => e.type === "text_delta")
        .map((e) => e.text)
        .join("");
      try {
        await conversations.appendMessage({
          conversationId,
          role: "assistant",
          content: finalText || null,
          events: collected,
        });
      } catch {
        /* best-effort */
      }
    }

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
/* QA auto-fix prompt                                                         */
/* -------------------------------------------------------------------------- */

/** The focused fix prompt handed to a QA fix round. Lists the runtime errors
 *  verbatim and tells the agent to fix the specific cause — NOT rewrite working
 *  code — then re-run the static verifier. */
function qaFixPrompt(errors: string[]): string {
  const list = errors.map((e) => `- ${e}`).join("\n");
  return [
    "The built game FAILS when loaded in a real browser. These are the runtime",
    "errors captured while loading and playing it (uncaught exceptions, failed",
    "resource loads, console errors):",
    "",
    list,
    "",
    "Read the relevant files and FIX them so the game boots and plays with NO",
    "console/runtime errors. Do NOT rewrite working code — fix the SPECIFIC cause:",
    "a missing or typo'd function/global (define it or import it), a bad asset/data",
    "path (a 404), wrong <script> load order, or an undefined property access.",
    "A 'ReferenceError: X is not defined' means X is called but never defined or",
    "imported — define it or correct the name. When done, re-run the verifier:",
    "`python agent-tools/verify-game.py` and confirm it is clean.",
  ].join("\n");
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
