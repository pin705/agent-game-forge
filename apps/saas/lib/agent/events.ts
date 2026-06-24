/**
 * Run events — streamed out of the agent loop (async generator) and piped to
 * the client as SSE by the API route. One discriminated union for everything
 * the UI needs to render a live build.
 */
export type RunEvent =
  | { type: "run_start"; runId: string; sandboxId: string; model: string; driver: { sandbox: string; storage: string; model: string } }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "file_write"; path: string; bytes: number }
  | { type: "shell"; cmd: string; code: number; stdoutPreview: string }
  | { type: "question"; id: string; payload: Record<string, unknown> }
  | { type: "step"; index: number; inputTokens: number; outputTokens: number }
  | { type: "done"; inputTokens: number; outputTokens: number; steps: number; files: string[] }
  | { type: "error"; message: string };
