/**
 * Editor data-layer round-trip gate (Batch 1).
 *
 * Proves the read/write path the editor API routes use actually round-trips
 * through the storage layer in local-dev (LocalStorage, ZERO external accounts),
 * and that the supporting helpers behave:
 *
 *   (a) PUT-shaped write (text → bytes → storage.writeProjectFile) then
 *       GET-shaped read (storage.readProjectFileText) returns the EXACT text.
 *   (b) An overwrite (second PUT) is reflected on the next read (manual edit).
 *   (c) sanitizeFilePath() rejects traversal / empty / dir paths and accepts a
 *       normal nested path — the guard the file route applies before storage.
 *   (d) serveDraftFile() (the draft-preview route's core) serves the file's
 *       bytes verbatim with the right Content-Type, defaults to index.html, and
 *       reports bad_path / not_found correctly.
 *
 * Run:  npm run editor-test   (uses tsx — resolves the `@/` tsconfig alias)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing any module that
// reads env at import time (storage factory, supabaseConfigured()).
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-editor-"));
process.env.OGF_DATA_DIR = dataDir;

// Import AFTER env is set.
const { getStorage } = await import("../lib/storage/index.ts");
const { sanitizeFilePath, serveDraftFile } = await import("../lib/editor/access.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

const storage = getStorage();
const projectId = "edit-" + Math.random().toString(36).slice(2, 8);
const FILE = "src/game.js";
const TEXT_V1 = "const speed = 5;\nconsole.log('hello');\n";
const TEXT_V2 = "const speed = 9;\n// edited in the code panel\n";

console.log(`\n=== Editor data-layer round-trip (data dir: ${dataDir}) ===`);

// ── (a) PUT write → GET read returns identical text ──────────────────────────
console.log("\n--- (a) write (PUT) → read (GET) byte-for-byte text ---");
{
  // Exactly what PUT /api/projects/:id/file does:
  await storage.writeProjectFile(projectId, FILE, new TextEncoder().encode(TEXT_V1));
  // Exactly what GET /api/projects/:id/file?path= does:
  const back = await storage.readProjectFileText(projectId, FILE);
  check(`GET returned the file (not null)`, back !== null);
  check(`text round-trip identical`, back === TEXT_V1);
}

// ── (b) overwrite is reflected on next read ──────────────────────────────────
console.log("\n--- (b) overwrite (second PUT) reflected on next read ---");
{
  await storage.writeProjectFile(projectId, FILE, new TextEncoder().encode(TEXT_V2));
  const back = await storage.readProjectFileText(projectId, FILE);
  check(`edited content persisted`, back === TEXT_V2);
}

// ── (c) sanitizeFilePath guards ──────────────────────────────────────────────
console.log("\n--- (c) sanitizeFilePath guards ---");
{
  check(`accepts a normal nested path`, sanitizeFilePath("src/game.js") === "src/game.js");
  check(`strips leading slash`, sanitizeFilePath("/index.html") === "index.html");
  check(`rejects empty`, sanitizeFilePath("") === null);
  check(`rejects "/"`, sanitizeFilePath("/") === null);
  check(`rejects trailing-slash dir`, sanitizeFilePath("assets/") === null);
  check(`rejects ../ traversal`, sanitizeFilePath("../secret") === null);
  check(`rejects nested ../ traversal`, sanitizeFilePath("a/../../etc/passwd") === null);
  check(`rejects backslash`, sanitizeFilePath("a\\b") === null);
  check(`rejects null/undefined`, sanitizeFilePath(null) === null && sanitizeFilePath(undefined) === null);
}

// ── (d) serveDraftFile (draft-preview route core) ────────────────────────────
console.log("\n--- (d) serveDraftFile serves bytes + Content-Type, defaults to index.html ---");
{
  const INDEX = "<!doctype html><title>draft</title><script src=\"src/game.js\"></script>";
  await storage.writeProjectFile(projectId, "index.html", new TextEncoder().encode(INDEX));

  // Explicit file:
  const js = await serveDraftFile(projectId, ["src", "game.js"]);
  check(`serveDraftFile did not error for src/game.js`, !("error" in js));
  if (!("error" in js)) {
    check(`Content-Type is javascript (got ${js.contentType})`, js.contentType.startsWith("text/javascript"));
    check(`served text matches latest edit`, js.body.toString("utf8") === TEXT_V2);
    check(`isIndex false for a non-index file`, js.isIndex === false);
  }

  // Default (no path) → index.html:
  const idx = await serveDraftFile(projectId, undefined);
  check(`default path resolved (no error)`, !("error" in idx));
  if (!("error" in idx)) {
    check(`default served index.html as text/html (got ${idx.contentType})`, idx.contentType === "text/html; charset=utf-8");
    check(`default isIndex true`, idx.isIndex === true);
    check(`index bytes decode to source`, idx.body.toString("utf8") === INDEX);
  }

  // Missing file → not_found; traversal → bad_path:
  const missing = await serveDraftFile(projectId, "nope.js");
  check(`missing file → not_found`, "error" in missing && missing.error === "not_found");
  const evil = await serveDraftFile(projectId, "../../etc/passwd");
  check(`traversal → bad_path`, "error" in evil && evil.error === "bad_path");
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL EDITOR CHECKS PASSED" : "EDITOR TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
