/**
 * QA-gate unit test — proves the real-browser smoke test (lib/agent/qa-gate.ts)
 * actually CATCHES a runtime error and PASSES a clean game.
 *
 * Run:  npm run qa-test   (tsx — resolves the `@/` tsconfig path alias)
 *
 * Two cases:
 *   (a) a deliberately-broken game: index.html + a script that CALLS an
 *       undefined function on boot → expect ran:true + errors incl. "is not
 *       defined".
 *   (b) a clean minimal game: index.html + a script that draws to a canvas with
 *       no errors → expect ran:true + 0 errors.
 *
 * Browser availability: this repo's e2e harness launches system Chrome via the
 * SAME playwright-core technique, so a browser IS available here. If for some
 * reason it isn't (ran:false), the test SKIPS gracefully (the gate's
 * graceful-skip contract is itself the correct behavior in that environment).
 */
import { textFile } from "../lib/storage/types.ts";
import { qaSmokeTest } from "../lib/agent/qa-gate.ts";

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

const BROKEN_INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>Broken</title></head>
<body><canvas id="game" width="320" height="180"></canvas><script src="game.js"></script></body></html>`;
// Calls buildEnemyInstance() which is defined nowhere → ReferenceError on boot.
const BROKEN_JS = `const ctx = document.getElementById("game").getContext("2d");
const enemy = buildEnemyInstance({ hp: 10 });
ctx.fillRect(enemy.x, enemy.y, 10, 10);`;

const CLEAN_INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>Clean</title>
<style>html,body{margin:0;height:100%;background:#111}canvas{display:block;margin:auto}</style></head>
<body><canvas id="game" width="320" height="180"></canvas><script src="game.js"></script></body></html>`;
const CLEAN_JS = `const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let t = 0;
function frame() {
  t += 1;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e0794a";
  ctx.fillRect(16 + Math.sin(t / 20) * 6, 80, 12, 16);
  requestAnimationFrame(frame);
}
window.addEventListener("keydown", () => {});
frame();`;

console.log("\n=== QA-gate unit test ===\n");

console.log("(a) broken game (calls undefined fn on boot):");
const broken = await qaSmokeTest([
  textFile("index.html", BROKEN_INDEX),
  textFile("game.js", BROKEN_JS),
]);
if (!broken.ran) {
  console.log("  SKIP — no browser available in this environment (graceful-skip contract).");
} else {
  console.log(`  ran=${broken.ran}, errors=${JSON.stringify(broken.errors, null, 2)}`);
  check("broken: ran === true", broken.ran === true);
  check("broken: at least one error captured", broken.errors.length >= 1);
  check(
    "broken: error mentions 'is not defined' (ReferenceError)",
    broken.errors.some((e) => /is not defined/i.test(e)),
  );
}

console.log("\n(b) clean game (draws to canvas, no errors):");
const clean = await qaSmokeTest([
  textFile("index.html", CLEAN_INDEX),
  textFile("game.js", CLEAN_JS),
]);
if (!clean.ran) {
  console.log("  SKIP — no browser available in this environment (graceful-skip contract).");
} else {
  console.log(`  ran=${clean.ran}, errors=${JSON.stringify(clean.errors)}`);
  check("clean: ran === true", clean.ran === true);
  check("clean: 0 runtime errors", clean.errors.length === 0);
}

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "QA-TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
