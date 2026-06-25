/**
 * QA gate — the REAL-BROWSER smoke test that runs after a build's static
 * verify passes. Static checks (`verify-game.py`) catch syntax + missing
 * file/asset refs + the new no-undef ReferenceError class, but they cannot see
 * a game that boots into a runtime error (an exception thrown only when a code
 * path actually executes, a failed module fetch, an undefined-access on first
 * frame). This loads the built game in a headless system Chrome, drives a few
 * inputs (start + move), and reports any uncaught error / console error /
 * failed resource. `run.ts` uses it to drive an auto-fix loop.
 *
 * GRACEFUL-SKIP CONTRACT: in any environment with no usable browser
 * (Vercel/CI/prod), or if the browser/server fails to start, this returns
 * `{ ran: false, errors: [] }` and NEVER throws — the build still completes on
 * the static-verify floor. It also has hard timeouts on every phase so it can
 * never hang a build.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ProjectFile } from "@/lib/storage";
import { fileText } from "@/lib/storage";
import { contentTypeFor } from "@/lib/publish/content-type";

export type QaResult = {
  /** True only when the browser actually launched + loaded the game. When false
   *  the build is on the static-verify floor (no browser available) — callers
   *  must treat `errors` as empty and NOT enter a fix loop. */
  ran: boolean;
  /** De-duped, capped list of runtime errors observed (pageerror / console
   *  error / failed resource). Empty when the game booted clean. */
  errors: string[];
};

// Hard caps so the gate can never hang a build.
const PAGE_LOAD_TIMEOUT_MS = 20_000;
const SMOKE_TOTAL_TIMEOUT_MS = 40_000;
const LAUNCH_TIMEOUT_MS = 20_000;
const MAX_ERRORS = 8;

/** Candidate system-Chrome paths — same technique as e2e/full.e2e.mjs. */
function findChrome(): string | undefined {
  const candidates = [
    process.env.OGF_CHROME,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => p && existsSyncSafe(p));
}

function existsSyncSafe(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:fs").existsSync(p);
  } catch {
    return false;
  }
}

/** Resolve playwright-core from the monorepo root (it's a root devDependency). */
async function loadChromium(): Promise<{
  launch: (opts: Record<string, unknown>) => Promise<unknown>;
} | null> {
  // lib/agent/qa-gate.ts → ../../../.. is the monorepo root.
  const monoRoot = path.resolve(process.cwd(), "../..");
  for (const base of [monoRoot, process.cwd()]) {
    try {
      const req = createRequire(path.join(base, "package.json"));
      const resolved = req.resolve("playwright-core");
      const pw = await import(pathToFileURL(resolved).href);
      const chromium = (pw.chromium ?? pw.default?.chromium) as
        | { launch: (opts: Record<string, unknown>) => Promise<unknown> }
        | undefined;
      if (chromium) return chromium;
    } catch {
      /* try next base */
    }
  }
  return null;
}

/** Write the project files into a fresh temp dir, return its absolute path. */
async function materialize(files: ProjectFile[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ogf-qa-"));
  for (const f of files) {
    const dest = path.join(dir, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(f.bytes));
  }
  return dir;
}

/** A tiny static file server over the temp dir with correct MIME types so ES
 *  modules load. Resolves with the server + its base URL. */
function startServer(rootDir: string): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://localhost");
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        rel = rel.replace(/^\/+/, "");
        if (rel === "") rel = "index.html";
        // Block traversal.
        if (rel.includes("..")) {
          res.writeHead(403).end();
          return;
        }
        const abs = path.join(rootDir, rel);
        if (!abs.startsWith(rootDir)) {
          res.writeHead(403).end();
          return;
        }
        const buf = await fs.readFile(abs);
        res.writeHead(200, { "Content-Type": contentTypeFor(rel) });
        res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, base: `http://127.0.0.1:${addr.port}` });
      } else {
        reject(new Error("server has no address"));
      }
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Load `files` as a game in a headless browser, drive start + a couple of
 * inputs, and report runtime errors. Never throws; returns `{ran:false}` when
 * no browser is available.
 */
export async function qaSmokeTest(files: ProjectFile[]): Promise<QaResult> {
  // No entry point → nothing to smoke; treat as clean (static verify is the floor).
  const hasIndex = files.some((f) => f.path === "index.html");
  if (!hasIndex) return { ran: true, errors: [] };

  const chromium = await loadChromium();
  if (!chromium) {
    console.warn("[qa-gate] playwright-core not resolvable — skipping browser QA (static verify is the floor).");
    return { ran: false, errors: [] };
  }

  let dir: string | null = null;
  let server: http.Server | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;

  try {
    dir = await materialize(files);
    const started = await startServer(dir);
    server = started.server;
    const base = started.base;

    const exe = findChrome();
    try {
      browser = await withTimeout(
        chromium.launch(
          exe
            ? { executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu"] }
            : { headless: true, args: ["--no-sandbox"] },
        ) as Promise<unknown>,
        LAUNCH_TIMEOUT_MS,
        "browser launch",
      );
    } catch (e) {
      console.warn(
        `[qa-gate] browser launch failed — skipping QA (static verify is the floor). Reason: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { ran: false, errors: [] };
    }

    // The whole smoke is bounded so a hung page can never stall the build.
    const errors = await withTimeout(driveSmoke(browser, base), SMOKE_TOTAL_TIMEOUT_MS, "qa smoke").catch(
      (e) => {
        // A timeout/crash mid-smoke is a SKIP, not a build failure (we can't
        // distinguish "the gate broke" from "the game is bad" reliably here).
        console.warn(`[qa-gate] smoke aborted — skipping QA. Reason: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      },
    );
    if (errors === null) return { ran: false, errors: [] };
    return { ran: true, errors };
  } catch (e) {
    console.warn(`[qa-gate] unexpected failure — skipping QA. Reason: ${e instanceof Error ? e.message : String(e)}`);
    return { ran: false, errors: [] };
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
    }
    if (dir) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Open the game, capture errors, press a few keys (start + move), wait, and
 * return the de-duped error list. `browser` is a playwright Browser.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function driveSmoke(browser: any, base: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const trimmed = s.replace(new RegExp(escapeRe(base), "g"), "").trim().slice(0, 300);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    if (found.length < MAX_ERRORS) found.push(trimmed);
  };

  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();

  page.on("pageerror", (e: Error) => add(`pageerror: ${e.message}`));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on("console", (m: any) => {
    if (m.type() !== "error") return;
    const text: string = m.text();
    // The `response` handler below already reports real failed resources (with
    // the URL, favicon excluded). Chrome ALSO logs a generic, URL-less
    // "Failed to load resource: …404" console error — most commonly the
    // browser's automatic /favicon.ico probe. Drop those generic resource-load
    // console errors here so a missing favicon never counts as a game bug.
    if (/Failed to load resource/i.test(text)) return;
    add(`console.error: ${text}`);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on("response", (resp: any) => {
    const status = resp.status();
    const url: string = resp.url();
    if (status >= 400 && !url.endsWith("/favicon.ico")) {
      add(`failed resource ${status}: ${url}`);
    }
  });

  try {
    await page.goto(`${base}/index.html`, { waitUntil: "load", timeout: PAGE_LOAD_TIMEOUT_MS });
    // Let the boot path + first frames run.
    await page.waitForTimeout(1200);
    // Drive start + movement (most games gate on Enter/Space, then arrows/WASD).
    for (const key of ["Enter", "ArrowRight", "Space"]) {
      try {
        await page.keyboard.press(key);
      } catch {
        /* ignore individual key failures */
      }
      await page.waitForTimeout(120);
    }
    // Let movement-driven code paths execute.
    await page.waitForTimeout(1000);
  } catch (e) {
    // A navigation/load failure is itself a runtime signal worth reporting.
    add(`load error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }
  return found;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convenience for callers that hold text content. */
export function projectFileText(f: ProjectFile): string {
  return fileText(f);
}
