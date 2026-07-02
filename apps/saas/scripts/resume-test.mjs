/**
 * Resumable-run gate — proves the background run executor decouples a run from
 * any client connection (Lovable-style F5/leave-and-return resume), with ZERO
 * external accounts (MockModel + LocalSandbox + LocalStorage, no Supabase).
 *
 * Asserts:
 *   (a) startRun() returns a runId and getActiveRun(conversationId) returns it
 *       WHILE running — WITHOUT anyone consuming the stream;
 *   (b) the run reaches status "done" ON ITS OWN (proves it survives a gone
 *       client — nothing ever consumed/tailed it);
 *   (c) getActiveRun is now null (no longer in-flight) and getRun().status==="done";
 *   (d) subscribe(runId, 0, …) replays the FULL event list incl. a `done` event
 *       (so a returning client gets the whole transcript);
 *   (e) the expected files (index.html, game.js) landed in LocalStorage;
 *   (f) abortRun() stops a running run (status leaves "running"; teardown ran).
 *
 * Run:  npm run resume-test
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing anything that
// reads env at import time.
delete process.env.E2B_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-resume-"));
process.env.OGF_DATA_DIR = dataDir;

const { startRun, getActiveRun, getRun, subscribe, abortRun } = await import(
  "../lib/agent/run-executor.ts"
);
const { getStorage } = await import("../lib/storage/index.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until getRun(runId).status !== "running" (or timeout). */
async function waitForTerminal(runId, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const s = getRun(runId);
    if (s && s.status !== "running") return s;
    if (Date.now() - start > timeoutMs) throw new Error("run did not terminate in time");
    await sleep(50);
  }
}

console.log(`\n=== Resumable-run gate (data dir: ${dataDir}) ===\n`);

// ── (a)+(b)+(c)+(d)+(e): a run survives a gone client and replays on return ──
console.log("--- (a) start a run; active lookup finds it WITHOUT consuming the stream ---");
const projectA = "resume-" + Math.random().toString(36).slice(2, 8);
{
  const { runId, conversationId } = startRun({
    projectId: projectA,
    prompt: "Build a tiny canvas platformer, data-driven.",
    conversationId: "conv-" + Math.random().toString(36).slice(2, 8),
  });
  check("startRun returned a runId", typeof runId === "string" && runId.length > 0);
  check("startRun returned the conversationId", typeof conversationId === "string");

  // Immediately (no stream consumption) the run is active for its conversation.
  const active = getActiveRun(conversationId);
  check("getActiveRun(conversationId) returns the in-flight run", active?.runId === runId);
  check("active run status is 'running'", active?.status === "running");

  console.log("\n--- (b) WITHOUT tailing, the run completes on its own (survives a gone client) ---");
  const terminal = await waitForTerminal(runId);
  check("run reached status 'done' on its own", terminal.status === "done");

  console.log("\n--- (c) the active pointer clears once the run ends ---");
  check("getActiveRun(conversationId) is now null", getActiveRun(conversationId) === null);
  check("getRun(runId).status === 'done'", getRun(runId)?.status === "done");

  console.log("\n--- (d) a returning client replays the FULL event list incl. `done` ---");
  const replayed = [];
  let ended = false;
  const unsub = subscribe(
    runId,
    0,
    (ev) => replayed.push(ev),
    () => {
      ended = true;
    },
  );
  check("subscribe() returned a handle (run still in grace window)", typeof unsub === "function");
  // The run already finished, so replay + end are synchronous.
  check("subscribe end-of-stream signalled", ended === true);
  check("replay includes run_start", replayed.some((e) => e.type === "run_start"));
  check("replay includes a done event", replayed.some((e) => e.type === "done"));
  check("replay includes file_write events", replayed.some((e) => e.type === "file_write"));
  unsub?.();

  console.log("\n--- (e) the built files landed in LocalStorage ---");
  const stored = await getStorage().listProjectFiles(projectA);
  check("index.html in storage", stored.includes("index.html"));
  check("game.js in storage", stored.includes("game.js"));
}

// ── (f): abortRun stops a running run ─────────────────────────────────────────
console.log("\n--- (f) abortRun() stops a running run ---");
const projectB = "resume-" + Math.random().toString(36).slice(2, 8);
{
  const { runId, conversationId } = startRun({
    projectId: projectB,
    prompt: "Build a tiny canvas platformer.",
    conversationId: "conv-" + Math.random().toString(36).slice(2, 8),
  });
  // Abort immediately (the run is still spinning up / in its first step).
  const ok = await abortRun(runId);
  check("abortRun returned ok", ok === true);
  // After abort the run must leave 'running' (done — gen.return ran finally).
  const start = Date.now();
  while (getRun(runId)?.status === "running" && Date.now() - start < 10000) await sleep(50);
  const s = getRun(runId);
  check("aborted run is no longer 'running'", s != null && s.status !== "running");
  check("aborted run dropped from active lookup", getActiveRun(conversationId) === null);
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "RESUME TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
