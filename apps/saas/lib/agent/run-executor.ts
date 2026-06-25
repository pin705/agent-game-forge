/**
 * Background run executor — decouples a game-build run from any client
 * connection so the run survives F5 / leaving the page (Lovable-style resume).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHY
 * ─────────────────────────────────────────────────────────────────────────────
 *  The old POST /api/runs drove `runAgent` INSIDE the response ReadableStream,
 *  so the run was tied to the request: a client disconnect (F5, navigate away)
 *  abandoned the generator. Its `finally { sandbox.destroy() }` only runs when
 *  the generator completes / throws / is `.return()`-ed — NOT when simply
 *  abandoned, so the sandbox was orphaned and the result never persisted.
 *
 *  Now: the run is owned by a module-level registry. A background async task
 *  (NOT awaited by the request) PUMPS the `runAgent` generator, pushing each
 *  yielded event into a per-run buffer and notifying subscribers. Clients TAIL
 *  the run (start and resume are the SAME path — open a tail for a runId). A
 *  client disconnect can never reach the generator, so the pump (and the run)
 *  keeps going to completion + persistence + teardown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SCOPE (MVP)
 * ─────────────────────────────────────────────────────────────────────────────
 *  In-memory registry on a single persistent Node host. A COMPLETED build shows
 *  up in history on return via the already-persisted final assistant message
 *  (runAgent persists it). An IN-PROGRESS build is re-attached via this
 *  registry. Cross-server-restart / multi-instance durability is DEFERRED — it
 *  needs a DB event log + a worker (see the report).
 */

import { runAgent } from "./run";
import type { RunEvent } from "./events";

/** How long a finished run lingers in the registry so a client returning right
 *  after completion can still replay it before eviction. */
const GRACE_MS = 5 * 60 * 1000;

export type RunStatus = "running" | "done" | "error";

type Subscriber = (ev: RunEvent) => void;

export type RunState = {
  runId: string;
  projectId: string;
  conversationId: string | null;
  userId?: string;
  /** Every event yielded so far (replay buffer for tail/resume). */
  events: RunEvent[];
  status: RunStatus;
  startedAt: number;
  /** Set when status === "error". */
  error?: string;
  /** Live subscribers notified as events arrive. */
  subscribers: Set<Subscriber>;
  /** The driving generator handle — used by abortRun to call `.return()` so
   *  runAgent's `finally` (sandbox teardown) runs. */
  gen?: AsyncGenerator<RunEvent, unknown, void>;
  /** Eviction timer handle (set once the run reaches a terminal status). */
  evictTimer?: ReturnType<typeof setTimeout>;
};

type StartArgs = {
  projectId: string;
  prompt: string;
  userId?: string;
  model?: string;
  conversationId?: string;
  refImagePaths?: string[];
};

/** runId → RunState. The live channel; no DB needed for the MVP. */
const runs = new Map<string, RunState>();
/** conversationId → the runId of its currently-running run (active lookup). */
const activeByConversation = new Map<string, string>();

function genRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function notify(state: RunState, ev: RunEvent) {
  for (const sub of state.subscribers) {
    try {
      sub(ev);
    } catch {
      /* a misbehaving subscriber must never break the pump */
    }
  }
}

/** Schedule eviction of a finished run after the grace period. */
function scheduleEviction(state: RunState) {
  if (state.evictTimer) clearTimeout(state.evictTimer);
  state.evictTimer = setTimeout(() => {
    runs.delete(state.runId);
    if (activeByConversation.get(state.conversationId ?? "") === state.runId) {
      activeByConversation.delete(state.conversationId ?? "");
    }
  }, GRACE_MS);
  // Don't keep the process alive just for eviction (no-op in the browser/edge).
  state.evictTimer?.unref?.();
}

/**
 * Start a run in the background and return its runId IMMEDIATELY.
 *
 * The pump task owns the generator and is NOT awaited — so a client disconnect
 * can never abandon it. The run drives to completion (or error), persists, and
 * tears down its sandbox regardless of whether anyone is listening.
 */
export function startRun(args: StartArgs): { runId: string; conversationId: string | null } {
  const runId = genRunId();
  // We don't yet know the conversationId runAgent will resolve/create — it's
  // reported in the run_start event. Until then `conversationId` is whatever the
  // caller passed (or null). We index activeByConversation under BOTH so an
  // `active?conversationId=` lookup works for a follow-up run on an existing
  // conversation immediately, and gets re-indexed once run_start resolves it.
  const initialConv = args.conversationId ?? null;
  const state: RunState = {
    runId,
    projectId: args.projectId,
    conversationId: initialConv,
    userId: args.userId,
    events: [],
    status: "running",
    startedAt: Date.now(),
    subscribers: new Set(),
  };
  runs.set(runId, state);
  if (initialConv) activeByConversation.set(initialConv, runId);

  // ── Background pump (NOT awaited) ───────────────────────────────────────────
  const gen = runAgent({
    projectId: args.projectId,
    prompt: args.prompt,
    userId: args.userId,
    model: args.model,
    conversationId: args.conversationId,
    refImagePaths: args.refImagePaths,
  });
  state.gen = gen;

  void (async () => {
    try {
      let next = await gen.next();
      while (!next.done) {
        const ev = next.value;
        state.events.push(ev);
        // Once runAgent resolves/creates the conversation, index the active run
        // under it (covers the brand-new-conversation case).
        if (ev.type === "run_start" && ev.conversationId) {
          state.conversationId = ev.conversationId;
          activeByConversation.set(ev.conversationId, runId);
        }
        notify(state, ev);
        next = await gen.next();
      }
      state.status = "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.status = "error";
      state.error = message;
      // Surface a terminal error event to any tail (so resuming clients see it).
      const ev: RunEvent = { type: "error", message };
      state.events.push(ev);
      notify(state, ev);
    } finally {
      // Clear the active pointer (the run is no longer in-flight) but keep the
      // RunState in `runs` for the grace period so a just-returning client can
      // still replay the full event list.
      if (state.conversationId && activeByConversation.get(state.conversationId) === runId) {
        activeByConversation.delete(state.conversationId);
      }
      // Wake any subscribers so they can close their stream now the run ended.
      for (const sub of state.subscribers) {
        try {
          sub({ type: "__end__" } as unknown as RunEvent);
        } catch {
          /* ignore */
        }
      }
      scheduleEviction(state);
    }
  })();

  return { runId, conversationId: initialConv };
}

/** The currently-running run for a conversation, or null. */
export function getActiveRun(conversationId: string): RunState | null {
  const runId = activeByConversation.get(conversationId);
  if (!runId) return null;
  const state = runs.get(runId);
  return state && state.status === "running" ? state : null;
}

/** Look up a run by id (running OR within its post-completion grace window). */
export function getRun(runId: string): RunState | null {
  return runs.get(runId) ?? null;
}

/**
 * Subscribe to a run's events, starting with a replay of everything since
 * `fromIndex`. Calls `onEvent` for each event; calls `onEnd` once the run has
 * reached a terminal status (so the caller can close its SSE). Returns an
 * unsubscribe function.
 *
 * The `__end__` sentinel (an internal pseudo-event the pump emits on terminal)
 * is intercepted here and translated into an `onEnd()` call — it is NEVER
 * forwarded to `onEvent`.
 */
export function subscribe(
  runId: string,
  fromIndex: number,
  onEvent: (ev: RunEvent) => void,
  onEnd: () => void,
): (() => void) | null {
  const state = runs.get(runId);
  if (!state) return null;

  let ended = false;
  let handler: Subscriber | null = null;
  const end = () => {
    if (ended) return;
    ended = true;
    if (handler) state.subscribers.delete(handler);
    onEnd();
  };

  // Replay the backlog first.
  const start = Math.max(0, fromIndex);
  for (let i = start; i < state.events.length; i++) {
    onEvent(state.events[i]);
  }

  // If the run already finished, there's nothing more to tail.
  if (state.status !== "running") {
    end();
    return () => {};
  }

  handler = (ev) => {
    if ((ev as { type: string }).type === "__end__") {
      end();
      return;
    }
    onEvent(ev);
  };
  state.subscribers.add(handler);

  return () => {
    if (handler) state.subscribers.delete(handler);
  };
}

/**
 * Cleanly abort a run. Calls `gen.return()` so `runAgent`'s `finally` runs
 * (sandbox destroyed). Note: the loop stops after the CURRENT in-flight step —
 * we can't interrupt a model/tool call mid-flight, but no further steps run.
 */
export async function abortRun(runId: string): Promise<boolean> {
  const state = runs.get(runId);
  if (!state) return false;
  if (state.status !== "running") return true;
  try {
    // gen.return() resumes the suspended generator at its current yield point
    // and runs the `finally` (teardown). The pump's while-loop then sees `done`.
    await state.gen?.return(undefined as never);
  } catch {
    /* best-effort cancel */
  }
  // The pump's finally handles status + active-pointer cleanup + subscriber
  // wake. If the generator was already settled, force a terminal state here.
  if (state.status === "running") {
    state.status = "done";
  }
  return true;
}

/** Test/diagnostic helper: number of live runs in the registry. */
export function _registrySize(): number {
  return runs.size;
}
