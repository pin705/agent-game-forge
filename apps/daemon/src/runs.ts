import type { ChildProcess } from 'node:child_process';
import { spawn as spawnProcess } from 'node:child_process';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, RunStatus } from '@ogf/contracts';

export interface RunEventRecord {
  id: number;
  event: 'start' | 'agent' | 'stdout' | 'stderr' | 'error' | 'end';
  data: unknown;
}

export interface Run {
  id: string;
  /** Conversation this run belongs to. Used for dedupe (only one active
   *  run per conversation at a time) and for /api/conversations/:id/active-run. */
  conversationId: string;
  status: RunStatus;
  events: RunEventRecord[];
  clients: Set<Response>;
  child?: ChildProcess;
  createdAt: number;
  /** Timestamp of last stdout activity from codex. Updated on every line
   *  the parser receives. Stall watchdog uses this to detect dead runs. */
  lastActivity: number;
  /** When set, the run was killed by the stall watchdog. Distinguishes
   *  intentional cancel from forced termination. */
  killReason?: 'stalled' | 'manual';
  /** Set when finish() is called. Used by the GC sweep to evict the run
   *  from memory after FINISHED_RUN_TTL_MS. */
  finishedAt?: number;
  meta: {
    agentId: string;
    bin: string;
    cwd: string;
    model?: string;
    reasoning?: string;
  };
}

const MAX_EVENTS = 2000;
/** A run is considered stalled if its last stdout activity is older
 *  than this. 5 min is generous enough for image_gen + skill processing
 *  while still catching genuinely dead runs in a reasonable time. */
const STALL_THRESHOLD_MS = 5 * 60 * 1000;
/** How often the watchdog scans for stalled runs. */
const STALL_CHECK_INTERVAL_MS = 30 * 1000;
/** How long to keep a finished run's events around before evicting from
 *  the in-memory Map. The frontend re-attaches via /events?after=N for
 *  refresh-resume; once the run is finished and end has been delivered,
 *  there's no client value in keeping the events past a short grace
 *  period. Without this the daemon's heap grows unbounded — every
 *  past run's tool_use payloads (incl. base64 image_gen blobs) sit
 *  forever and eventually OOM the daemon (502 from web side). */
const FINISHED_RUN_TTL_MS = 5 * 60 * 1000;
/** How often to scan for finished runs to evict. */
const GC_INTERVAL_MS = 60 * 1000;

export class RunManager {
  private runs = new Map<string, Run>();
  private watchdog: NodeJS.Timeout | null = null;
  private gcTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start stall watchdog on first instantiation. Per-Run because the
    // map is per-RunManager. Doesn't keep the process alive (unref'd).
    this.watchdog = setInterval(() => this.scanForStalls(), STALL_CHECK_INTERVAL_MS);
    this.watchdog.unref?.();
    // GC pass — drop finished runs after a TTL so the daemon's heap
    // doesn't grow unbounded over a long session. Without this, every
    // past run's events (including base64 image_gen tool_results) sit
    // forever and the daemon eventually OOMs (502 from web side).
    this.gcTimer = setInterval(() => this.gcFinishedRuns(), GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  create(meta: Run['meta'], conversationId: string): Run {
    const run: Run = {
      id: randomUUID(),
      conversationId,
      status: 'queued',
      events: [],
      clients: new Set(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      meta,
    };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** Find the active (still running) run for a conversation, if any.
   *  Used by /api/runs to dedupe spawn requests and by
   *  /api/conversations/:id/active-run for refresh-resume. */
  activeRunForConversation(conversationId: string): Run | undefined {
    for (const run of this.runs.values()) {
      if (run.conversationId !== conversationId) continue;
      if (run.status === 'queued' || run.status === 'running') return run;
    }
    return undefined;
  }

  /** Touch the run — called on every parsed stdout line. Resets the stall
   *  timer. Cheap (just updates a timestamp). */
  touch(run: Run): void {
    run.lastActivity = Date.now();
  }

  emit(run: Run, event: RunEventRecord['event'], data: unknown) {
    const rec: RunEventRecord = { id: run.events.length, event, data };
    run.events.push(rec);
    if (run.events.length > MAX_EVENTS) run.events.shift();

    // Iterate over a snapshot — writeSseSafe may delete a dead client
    // from the set mid-loop. Without the snapshot we mutate the live
    // Set during iteration which is undefined behavior for some
    // patterns (and skips real clients). With the snapshot, dead
    // clients get pruned, live ones continue to receive events.
    for (const client of [...run.clients]) {
      writeSseSafe(run, client, rec);
    }
  }

  emitAgent(run: Run, ev: AgentEvent) {
    this.emit(run, 'agent', ev);
  }

  attach(run: Run, res: Response, after?: number) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const rec of run.events) {
      if (after !== undefined && rec.id <= after) continue;
      writeSseSafe(run, res, rec);
    }

    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      try { res.end(); } catch { /* client already gone */ }
      return;
    }

    run.clients.add(res);
    // Listen for BOTH 'close' (graceful disconnect) and 'error' (socket
    // ECONNRESET / EOF) — without an 'error' listener Node would throw
    // an unhandled 'error' event the next time emit() tries to write
    // to this socket, which CRASHED THE WHOLE DAEMON. Symmetric with
    // writeSseSafe below.
    const cleanup = () => run.clients.delete(res);
    res.on('close', cleanup);
    res.on('error', cleanup);
    res.socket?.on('error', cleanup);
  }

  finish(run: Run, status: RunStatus, code: number | null, signal: NodeJS.Signals | null) {
    run.status = status;
    this.emit(run, 'end', {
      code,
      signal,
      status,
      // Pass through the kill reason if any, so frontend can show
      // 'Stalled' instead of generic 'Failed'.
      reason: run.killReason,
    });
    for (const client of run.clients) client.end();
    run.clients.clear();
    run.child = undefined;
    run.finishedAt = Date.now();
    // Strip large base64 payloads from finished events. The frontend
    // already received them via SSE; refresh-resume re-attaches via
    // /events?after=N which would resend everything — but tool_use
    // results with image_gen base64 can be 100KB-1MB each. Keep the
    // event shape but drop heavy fields.
    for (const rec of run.events) {
      if (rec.event !== 'agent') continue;
      const ev = rec.data as { type?: string; result?: unknown };
      if (ev?.type === 'tool_result' && typeof ev.result === 'string' && ev.result.length > 4096) {
        ev.result = `[stripped ${ev.result.length} chars after run finished — full content available in transcript]`;
      }
    }
  }

  /** Evict finished runs whose TTL has expired. Called periodically. */
  private gcFinishedRuns(): void {
    const now = Date.now();
    for (const [id, run] of this.runs) {
      if (!run.finishedAt) continue;
      if (now - run.finishedAt < FINISHED_RUN_TTL_MS) continue;
      // Belt-and-suspenders: kill any lingering clients (refresh-resume
      // shouldn't hold past TTL but if a misbehaving client is still
      // attached, drop it now).
      for (const client of run.clients) client.end();
      run.clients.clear();
      this.runs.delete(id);
    }
  }

  /** Watchdog pass: kill runs whose lastActivity is older than threshold.
   *  Codex CLI sometimes hangs silently — image_gen request stuck on
   *  OpenAI side, network blip never recovered, etc. — without ever
   *  exiting on its own. Without this watchdog the run sits forever
   *  and the user can't tell anything is wrong. */
  private scanForStalls(): void {
    const now = Date.now();
    for (const run of this.runs.values()) {
      if (run.status !== 'queued' && run.status !== 'running') continue;
      if (!run.child || run.child.killed) continue;
      if (now - run.lastActivity < STALL_THRESHOLD_MS) continue;

      run.killReason = 'stalled';
      this.emit(run, 'error', {
        message: `Stalled — no codex output for ${Math.floor((now - run.lastActivity) / 1000)}s. Killing.`,
        reason: 'stalled',
      });
      this.killProcessTree(run.child);
      // Don't call finish() here — the child's own close handler in
      // server.ts will fire when taskkill walks the tree. That handler
      // calls runs.finish() with the actual exit code.
    }
  }

  /** Kill a child + every grandchild it spawned. Same logic as
   *  server.ts killProcessTree, duplicated here to avoid a circular
   *  import. Win32-only path — POSIX kill doesn't walk descendants. */
  private killProcessTree(child: ChildProcess | undefined): void {
    if (!child || child.killed || !child.pid) return;
    if (process.platform === 'win32') {
      spawnProcess('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      child.kill();
    }
  }
}

function writeSse(res: Response, rec: RunEventRecord) {
  res.write(`id: ${rec.id}\n`);
  res.write(`event: ${rec.event}\n`);
  res.write(`data: ${JSON.stringify(rec.data)}\n\n`);
}

/** Safe wrapper around writeSse: if the client socket is already dead
 *  (ECONNRESET / write EOF when the browser closed the SSE before the
 *  daemon flushed), catch the error and prune the client from the run.
 *  Without this, ONE dropped SSE socket throws an unhandled 'error'
 *  event from inside res.write() and crashes the whole daemon — which
 *  is the bug that took the server offline mid-session. */
function writeSseSafe(run: Run, res: Response, rec: RunEventRecord): void {
  // Cheap pre-check — if the response/socket are obviously gone, skip
  // the write attempt entirely.
  if (res.writableEnded || res.destroyed) {
    run.clients.delete(res);
    return;
  }
  try {
    writeSse(res, rec);
  } catch {
    run.clients.delete(res);
    try { res.end(); } catch { /* already dead */ }
  }
}
