/**
 * P5 Item 1 — BINARY-AWARE STORAGE + FILE TRANSFER gate (the non-negotiable
 * correctness test). Proves that binary game assets survive the FULL round-trip
 *
 *     storage  →  sandbox (hydrate)  →  storage (push-back)  →  serve (play route)
 *
 * BYTE-FOR-BYTE, with ZERO external accounts (LocalStorage + LocalSandbox).
 *
 * Run:  npm run binary-test   (uses tsx — resolves the `@/` tsconfig alias)
 *   or: npx tsx scripts/binary-test.mjs
 *
 * Asserts:
 *   (a) a real 1×1 PNG (contains non-UTF8 bytes) put into a project via storage
 *       reads back from storage byte-identical,
 *   (b) hydrating a sandbox from that project (writeFiles) and reading the file
 *       back (readFile) is byte-identical (the asset survives the FS hop),
 *   (c) pushing the sandbox files back to storage (readFiles → putProjectFiles)
 *       and re-reading from storage is byte-identical (the broker-download path),
 *   (d) serveProjectFile returns the identical bytes + Content-Type image/png,
 *   (e) a normal text file (index.html) still round-trips as correct text,
 *   (f) a UTF-8 mangle of the PNG (the OLD text-only behaviour) would CORRUPT it
 *       — i.e. this test would actually catch a regression.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing any module that
// reads env at import (storage factory, supabaseConfigured()).
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
delete process.env.E2B_API_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:7640";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-binary-"));
process.env.OGF_DATA_DIR = dataDir;

// Import AFTER env is set.
const { getStorage, textFile } = await import("../lib/storage/index.ts");
const { LocalSandboxFactory } = await import("../lib/sandbox/local.ts");
const { publishProject, serveProjectFile } = await import("../lib/publish/core.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

const sha = (u8) => createHash("sha256").update(Buffer.from(u8)).digest("hex");
const eqBytes = (a, b) =>
  a instanceof Uint8Array &&
  b instanceof Uint8Array &&
  a.length === b.length &&
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/**
 * A real 1×1 transparent PNG (the canonical 68-byte blob). Hardcoded as a raw
 * byte array — deliberately NOT decoded from base64 — so this is the unambiguous
 * source of truth. It begins with the 8-byte PNG signature
 * [137,80,78,71,13,10,26,10] and contains bytes (e.g. 137, 26, 218, 99…) that
 * are INVALID as standalone UTF-8, which is exactly what corrupts under a
 * text-only (utf-8) storage layer.
 */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x63, 0x60, 0xf8, 0x5f,
  0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb, 0x47, 0x7a, 0x92, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const INDEX_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Art Game</title></head>
<body><canvas id="c" width="64" height="64"></canvas>
<script src="game.js"></script></body></html>`;
const GAME_JS = `const img=new Image();img.src="assets/sprite.png";`;

const PNG_PATH = "assets/sprite.png";
const ORIGIN_SHA = sha(PNG_BYTES);

console.log(`\n=== P5 binary round-trip test (data dir: ${dataDir}) ===`);
console.log(`  PNG: ${PNG_BYTES.length} bytes, sha256=${ORIGIN_SHA.slice(0, 16)}…`);

// Sanity: the blob really is a PNG and really contains non-UTF8 bytes.
{
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const sigOk = SIG.every((b, i) => PNG_BYTES[i] === b);
  check("fixture is a real PNG (8-byte signature)", sigOk);
  // A UTF-8 decode→encode is NOT a no-op for this blob (it has invalid byte
  // sequences). This is the corruption the byte path must avoid.
  const mangled = new TextEncoder().encode(new TextDecoder().decode(PNG_BYTES));
  check("fixture contains non-UTF8 bytes (text encoding WOULD corrupt it)", !eqBytes(mangled, PNG_BYTES));
}

const storage = getStorage();
const projectId = "bin-" + Math.random().toString(36).slice(2, 8);

// ── (a) put the PNG into a project via storage; read back byte-identical ─────
console.log("\n--- (a) storage put → read back (byte-identical) ---");
await storage.putProjectFiles(projectId, [
  textFile("index.html", INDEX_HTML),
  textFile("game.js", GAME_JS),
  { path: PNG_PATH, bytes: PNG_BYTES },
]);
{
  const back = await storage.readProjectFile(projectId, PNG_PATH);
  check("storage returned bytes (Uint8Array)", back instanceof Uint8Array);
  check(`storage round-trip byte-identical (len ${back?.length}, sha ${back ? sha(back).slice(0, 12) : "—"})`, eqBytes(back, PNG_BYTES));
}

// ── (b) hydrate a sandbox from the project; read the file back identical ─────
console.log("\n--- (b) hydrate sandbox (writeFiles) → readFile (byte-identical) ---");
const sandbox = await new LocalSandboxFactory().createSandbox();
{
  const projectFiles = await storage.getProjectFiles(projectId);
  await sandbox.writeFiles(projectFiles); // exactly what run.ts does to hydrate
  const inSandbox = await sandbox.readFile(PNG_PATH);
  check("sandbox readFile returned bytes", inSandbox instanceof Uint8Array);
  check(`sandbox round-trip byte-identical (sha ${inSandbox ? sha(inSandbox).slice(0, 12) : "—"})`, eqBytes(inSandbox, PNG_BYTES));
  // text file decodes correctly via the model-facing text read
  const html = await sandbox.readFileText("index.html");
  check("sandbox text readFileText decodes index.html correctly", html === INDEX_HTML);
}

// ── (c) push the sandbox files back to storage; re-read identical ────────────
// Mirrors run.ts push-back: readFiles(**/*) → filter → putProjectFiles. Use a
// NEW project id so we prove the bytes survived the sandbox→storage hop (not
// just that the original is still there).
console.log("\n--- (c) push-back to storage (readFiles → putProjectFiles) → re-read identical ---");
const projectId2 = "bin2-" + Math.random().toString(36).slice(2, 8);
{
  const after = await sandbox.readFiles(["**/*"]);
  check("sandbox.readFiles returned the PNG", after.some((f) => f.path === PNG_PATH));
  await storage.putProjectFiles(projectId2, after);
  const back = await storage.readProjectFile(projectId2, PNG_PATH);
  check(`push-back byte-identical (sha ${back ? sha(back).slice(0, 12) : "—"})`, eqBytes(back, PNG_BYTES));
}
await sandbox.destroy();

// ── (d) serveProjectFile returns identical bytes + Content-Type image/png ────
console.log("\n--- (d) publish + serveProjectFile (byte-identical + image/png) ---");
{
  // publish projectId2 so it resolves by slug for the public play route.
  const pub = await publishProject({
    projectId: projectId2,
    origin: "http://localhost:7640",
    fallbackName: "Art Game",
  });
  const served = await serveProjectFile(pub.slug, [PNG_PATH]);
  check("serveProjectFile did not error", !("error" in served));
  if (!("error" in served)) {
    check(`served Content-Type is image/png (got ${served.contentType})`, served.contentType === "image/png");
    const servedBytes = new Uint8Array(served.body.buffer, served.body.byteOffset, served.body.byteLength);
    check(`served bytes byte-identical (sha ${sha(servedBytes).slice(0, 12)})`, eqBytes(servedBytes, PNG_BYTES));
  }

  // ── (e) the text entry still serves as correct text + Content-Type ──
  const servedHtml = await serveProjectFile(pub.slug, undefined); // index.html
  check("serveProjectFile index.html did not error", !("error" in servedHtml));
  if (!("error" in servedHtml)) {
    check(`index.html Content-Type text/html (got ${servedHtml.contentType})`, servedHtml.contentType === "text/html; charset=utf-8");
    check("index.html bytes decode back to the exact source text", servedHtml.body.toString("utf8") === INDEX_HTML);
  }
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL CHECKS PASSED (byte-exact)" : "BINARY TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
