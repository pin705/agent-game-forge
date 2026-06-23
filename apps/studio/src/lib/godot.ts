// Thin client for the OGF daemon's Godot runner (proxied at /api → :7621).
//
// Mirrors the daemon routes in apps/daemon/src/server.ts:
//   GET  /api/godot/detect              → GodotInfo
//   POST /api/godot/run                 → { runId }
//   GET  /api/godot/runs/:id/events     → SSE (start|stdout|stderr|error|end)
//   POST /api/godot/runs/:id/stop       → { ok }
//   GET  /api/godot/active?projectPath  → { runId: string | null }
//
// The studio's PlayPane only covers WEB-engine games (iframe preview). This
// client + GodotPlayPane cover the GODOT branch: run/stop a Godot project and
// stream its console output.

export interface GodotInfo {
  available: boolean;
  /** Resolved absolute path to the binary, if found. */
  path?: string;
  /** First line of `--version` output. */
  version?: string;
  source?: 'env' | 'path';
}

export interface GodotStartRequest {
  projectPath: string;
  /** Optional explicit binary path; daemon auto-detects when omitted. */
  godotPath?: string;
  /** Optional scene; daemon falls back to project.godot's main_scene. */
  mainScene?: string;
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** Detect a usable Godot binary on the daemon host. */
export const detectGodot = () => jget<GodotInfo>('/api/godot/detect');

/** Start a Godot run; returns the runId to subscribe to. */
export async function startGodot(req: GodotStartRequest): Promise<{ runId: string }> {
  const r = await fetch('/api/godot/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    // The daemon returns a JSON { error } body for the 400 cases (no binary,
    // not a Godot project, ...). Surface that message to the caller.
    let detail = `${r.status}`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON body — keep status code */
    }
    throw new Error(detail);
  }
  return r.json() as Promise<{ runId: string }>;
}

/** Stop a running Godot instance. Best-effort; resolves even if already gone. */
export async function stopGodot(runId: string): Promise<void> {
  await fetch(`/api/godot/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}

/** Active run for a project (for reconnecting after a remount/reload). */
export const fetchActiveGodotRun = (projectPath: string) =>
  jget<{ runId: string | null }>(
    `/api/godot/active?projectPath=${encodeURIComponent(projectPath)}`,
  );

export type GodotStreamEvent =
  | { type: 'start'; data: { bin?: string; args?: string[]; mainScene?: string } & Record<string, unknown> }
  | { type: 'stdout'; data: { chunk: string } }
  | { type: 'stderr'; data: { chunk: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'end'; data: { code: number | null; signal: string | null; status: string } };

/**
 * Subscribe to a Godot run's SSE stream. Returns an unsubscribe closer.
 * Closes the EventSource automatically on the terminal `end` event so callers
 * don't leak a source per run (the daemon ends the stream server-side too).
 */
export function subscribeGodotRun(
  runId: string,
  onEvent: (e: GodotStreamEvent) => void,
): () => void {
  const es = new EventSource(`/api/godot/runs/${encodeURIComponent(runId)}/events`);
  const types: GodotStreamEvent['type'][] = ['start', 'stdout', 'stderr', 'error', 'end'];
  for (const t of types) {
    es.addEventListener(t, (ev) => {
      const e = ev as MessageEvent;
      try {
        const data = JSON.parse(e.data);
        onEvent({ type: t, data } as GodotStreamEvent);
      } catch {
        /* ignore malformed frame */
      }
      if (t === 'end') es.close();
    });
  }
  es.onerror = () => es.close();
  return () => es.close();
}
