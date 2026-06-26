/**
 * P1 smoke test — proves the full agent run end-to-end with ZERO external
 * accounts: MockModel + LocalSandbox + LocalStorage.
 *
 * Run:  npm run smoke   (uses tsx — resolves the `@/` tsconfig path alias)
 *   or:  npx tsx scripts/smoke-run.mjs
 *
 * Asserts:
 *   (a) the loop ran tool calls,
 *   (b) expected files (index.html, game.js, data/level.json) exist in LocalStorage,
 *   (c) events streamed (run_start … done),
 *   (d) token counts were recorded,
 *   (e) run_shell executed a real shell command (python agent-tool) end-to-end,
 *   (f) the SELECTED model id (P5 multi-model) is plumbed prompt → run → pricing:
 *       it appears on run_start AND is what the run charge is priced against.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers (belt-and-suspenders: no prod env should be set in a smoke run).
delete process.env.E2B_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.R2_ACCOUNT_ID;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-smoke-"));
process.env.OGF_DATA_DIR = dataDir;

// Import after env is set so the factories read the right values.
const { runAgent } = await import("../lib/agent/run.ts");
const { getStorage } = await import("../lib/storage/index.ts");
const { creditsForRun } = await import("../lib/billing/pricing.ts");

// P5: pick a NON-default working model id so we can prove the selection is
// plumbed all the way to the run + pricing (default would also pass but wouldn't
// prove the param actually flows).
const SELECTED_MODEL = "deepseek-v4-flash";

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

const projectId = "smoke-" + Math.random().toString(36).slice(2, 8);
const events = [];
let result;

console.log(`\n=== P1 smoke run (data dir: ${dataDir}) ===\n`);

const gen = runAgent({
  projectId,
  prompt: "Build a tiny canvas platformer: a player on two platforms, data-driven.",
  model: SELECTED_MODEL,
});
let next = await gen.next();
while (!next.done) {
  events.push(next.value);
  const e = next.value;
  if (e.type === "run_start") console.log(`  drivers: ${JSON.stringify(e.driver)}`);
  if (e.type === "text_delta") console.log(`  model: ${e.text.slice(0, 70)}`);
  if (e.type === "tool_call") console.log(`  → tool_call: ${e.name}(${Object.keys(e.args).join(", ")})`);
  if (e.type === "shell") console.log(`  $ ${e.cmd.slice(0, 60)} → exit ${e.code} :: ${e.stdoutPreview.slice(0, 60).replace(/\n/g, " ")}`);
  if (e.type === "file_write") console.log(`  + wrote ${e.path} (${e.bytes}b)`);
  if (e.type === "done") console.log(`  done: ${e.steps} steps, ${e.inputTokens}+${e.outputTokens} tokens, files: ${e.files.join(", ")}`);
  if (e.type === "error") console.log(`  ERROR: ${e.message}`);
  next = await gen.next();
}
result = next.value;

console.log("\n--- assertions ---");

// (c) events streamed
const types = events.map((e) => e.type);
check("events streamed (run_start present)", types.includes("run_start"));
check("events streamed (done present)", types.includes("done"));

// (a) loop ran tool calls
const toolCalls = events.filter((e) => e.type === "tool_call");
check(`loop ran tool calls (${toolCalls.length} calls)`, toolCalls.length >= 3);

// (e) run_shell executed a real command end-to-end (exit 0)
const shell = events.find((e) => e.type === "shell");
check("run_shell executed end-to-end (exit 0)", !!shell && shell.code === 0);

// (b) expected files exist in LocalStorage
const storage = getStorage();
const stored = await storage.listProjectFiles(projectId);
console.log(`  stored files: ${stored.join(", ")}`);
for (const f of ["index.html", "game.js", "data/level.json"]) {
  check(`LocalStorage has ${f}`, stored.includes(f));
}
const html = await storage.readProjectFileText(projectId, "index.html");
check("index.html has real content", !!html && html.includes("<canvas"));
check("agent-tools NOT leaked into project storage", !stored.some((p) => p.startsWith("agent-tools/")));

// (d) token counts recorded
check(`token counts recorded (in=${result.inputTokens} out=${result.outputTokens})`, result.inputTokens > 0 && result.outputTokens > 0);

// (f) selected model id plumbed prompt → run → pricing
const runStart = events.find((e) => e.type === "run_start");
check(`run_start carries the SELECTED model id (${runStart?.model})`, runStart?.model === SELECTED_MODEL);

const charge = events.find((e) => e.type === "charge");
check("charge event present", !!charge);
// The run was priced against the SELECTED model's rate (not the default tier).
// Recompute the expected credits with the selected id and compare to what was
// charged — proving the chosen id reached the pricing layer.
const expectedCredits = creditsForRun({
  model: SELECTED_MODEL,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  images: result.images,
  sandboxMs: result.sandboxMs,
});
check(
  `run priced against selected model (charged ${charge?.credits}, expected ${expectedCredits} for ${SELECTED_MODEL})`,
  charge?.credits === expectedCredits,
);
// Sanity: pricing is genuinely model-sensitive — the selected flash tier costs
// less (raw USD) than the default pro tier for the SAME usage, proving the
// chosen id (not a hardcoded default) drives the rate lookup.
{
  const { rawCostUSD } = await import("../lib/billing/pricing.ts");
  const usage = {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    images: result.images,
    sandboxMs: result.sandboxMs,
  };
  const flashCost = rawCostUSD({ ...usage, model: SELECTED_MODEL });
  const proCost = rawCostUSD({ ...usage, model: "deepseek-v4-pro" });
  check(`flash raw cost < pro raw cost (${flashCost.toFixed(6)} < ${proCost.toFixed(6)})`, flashCost < proCost);
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "SMOKE TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
