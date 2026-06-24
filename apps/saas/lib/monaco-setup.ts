/**
 * Monaco setup for Next.js (App Router) — adapted from the studio's Vite setup.
 *
 * The studio self-hosts Monaco by importing the editor + its language workers
 * with Vite's `?worker` suffix. That syntax is Vite-only; webpack/Next does not
 * understand it, and wiring webpack worker chunks for Monaco is fragile and
 * easy to break across Next minor versions.
 *
 * Hosted-model tradeoff (Batch 1): we use `@monaco-editor/react`'s default
 * loader, which fetches the editor from a CDN AT RUNTIME, IN THE BROWSER ONLY.
 * Crucially this never runs during `next build`/prerender:
 *   • this module is imported only from a Client Component that is itself loaded
 *     via `next/dynamic(..., { ssr: false })`, so it executes after hydration;
 *   • `setupMonaco()` early-returns on the server (`typeof window` guard), so no
 *     `self` / `window` access happens during SSR;
 *   • nothing here is evaluated at module-import time on the server.
 * Result: zero build-time network, no SSR window access, production build safe.
 *
 * What this does on the client:
 *   1. Pins the loader to a specific monaco version on the CDN (deterministic).
 *   2. Defines `MonacoEnvironment.getWorkerUrl` so Monaco's language services
 *      (JSON/CSS/HTML/TS + the generic editor worker) load from the SAME CDN
 *      version via a tiny same-origin worker shim (avoids cross-origin worker
 *      restrictions). Falls back gracefully — if a worker can't start, Monaco
 *      still edits text, just without rich language services.
 *
 * Call `setupMonaco()` once before the first <Editor> mounts (the code panel
 * calls it from a mount effect). It is idempotent.
 */
import { loader } from "@monaco-editor/react";

// Keep in lockstep with the `monaco-editor` dependency in package.json so the
// loaded assets match the editor API the app links against.
const MONACO_VERSION = "0.55.1";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;

let configured = false;

export function setupMonaco(): void {
  // Client-only: never touch `window`/`self` during SSR or build.
  if (typeof window === "undefined") return;
  if (configured) return;
  configured = true;

  // Workers must be same-origin; load the CDN worker through a Blob shim that
  // sets the base path and imports the real worker bundle from the CDN.
  type MonacoWindow = Window & {
    MonacoEnvironment?: { getWorkerUrl: (moduleId: string, label: string) => string };
  };
  const shim = `self.MonacoEnvironment = { baseUrl: '${CDN_BASE}/' };
importScripts('${CDN_BASE}/vs/base/worker/workerMain.js');`;
  const workerUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(shim)}`;
  (window as MonacoWindow).MonacoEnvironment = {
    // Monaco calls this with (moduleId, label); every language worker uses the
    // same CDN shim, so we ignore both and return one URL.
    getWorkerUrl: () => workerUrl,
  };

  // Point the React loader at the pinned CDN build (runtime fetch, browser only).
  loader.config({ paths: { vs: `${CDN_BASE}/vs` } });
}

/** Map a file's extension to a Monaco language id (same table as the studio). */
export function languageOf(relPath: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    cs: "csharp",
    go: "go",
    rs: "rust",
    rb: "ruby",
    lua: "lua",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    sh: "shell",
    bash: "shell",
    ps1: "powershell",
    xml: "xml",
    svg: "xml",
    gd: "python",
    tscn: "ini",
    tres: "ini",
    godot: "ini",
    cfg: "ini",
  };
  return map[ext] ?? "plaintext";
}
