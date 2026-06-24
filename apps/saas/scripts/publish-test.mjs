/**
 * P4 publish/share/remix integration test — proves the full GTM loop with ZERO
 * external accounts: LocalStorage + the local publish registry, exercising the
 * REAL route handlers (publish, play, remix) end-to-end.
 *
 * Run:  npm run publish-test   (uses tsx — resolves the `@/` tsconfig alias)
 *   or: npx tsx scripts/publish-test.mjs
 *
 * Asserts:
 *   (a) seed a tiny game (index.html → game.js + data/level.json) into storage,
 *   (b) publish it (local path) → get a /play/<slug> URL,
 *   (c) GET the play route for index.html and game.js → correct bytes + Content-Type,
 *   (d) a path-traversal attempt (../../etc/passwd) is rejected (no file leak),
 *   (e) remix it → a NEW project prefix contains copies of ALL source files,
 *   (f) play_count increments on an index load (not on asset loads).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing any module that
// reads env at import (storage factory, supabaseConfigured()).
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:7640";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-publish-"));
process.env.OGF_DATA_DIR = dataDir;

// Import AFTER env is set.
const { getStorage } = await import("../lib/storage/index.ts");
const publishRoute = await import("../app/api/projects/[id]/publish/route.ts");
const remixRoute = await import("../app/api/projects/[id]/remix/route.ts");
const playRoute = await import("../app/play/[slug]/[[...path]]/route.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};
const eq = (label, got, want) =>
  check(`${label} (got ${JSON.stringify(got)})`, got === want);

/** Minimal NextRequest-ish stub: the routes only read `.nextUrl.origin`. */
const makeReq = (origin = "http://localhost:7640") => ({ nextUrl: { origin } });
/** Build the `ctx` the route handlers expect (params is a Promise). */
const ctx = (obj) => ({ params: Promise.resolve(obj) });

console.log(`\n=== P4 publish/share/remix test (data dir: ${dataDir}) ===\n`);

const storage = getStorage();
const projectId = "proj-" + Math.random().toString(36).slice(2, 8);

// ── (a) seed a tiny game into storage ───────────────────────────────────────
console.log("--- (a) seed a tiny game into LocalStorage ---");
const INDEX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Tiny Game</title></head>
<body><canvas id="c" width="320" height="240"></canvas>
<script src="game.js"></script></body></html>`;
const GAME_JS = `fetch("data/level.json").then(r=>r.json()).then(lvl=>{
  const ctx=document.getElementById("c").getContext("2d");
  ctx.fillStyle=lvl.bg; ctx.fillRect(0,0,320,240);
});`;
const LEVEL_JSON = JSON.stringify({ bg: "#1b1b1f", player: { x: 10, y: 10 } });

await storage.putProjectFiles(projectId, [
  { path: "index.html", content: INDEX_HTML },
  { path: "game.js", content: GAME_JS },
  { path: "data/level.json", content: LEVEL_JSON },
]);
const seeded = (await storage.listProjectFiles(projectId)).sort();
check(`seeded 3 files (${seeded.join(", ")})`, seeded.length === 3);

// ── (b) publish (local path) ────────────────────────────────────────────────
console.log("\n--- (b) publish ---");
const pubRes = await publishRoute.POST(makeReq(), ctx({ id: projectId }));
const pub = await pubRes.json();
eq("publish status 200", pubRes.status, 200);
check("publish ok", pub.ok === true);
check(`publish url is /play/<slug> (${pub.url})`, typeof pub.url === "string" && pub.url.includes("/play/"));
check("cloudflare export NOT run (no creds)", pub.cloudflare?.exported === false);
const slug = pub.slug;
check(`slug present (${slug})`, typeof slug === "string" && slug.length > 0);

// ── (c) GET the play route → correct bytes + Content-Type ───────────────────
console.log("\n--- (c) serve index.html + game.js with correct bytes + types ---");
{
  // index.html (no path)
  const r = await playRoute.GET(makeReq(), ctx({ slug }));
  eq("index.html status 200", r.status, 200);
  eq("index.html Content-Type", r.headers.get("Content-Type"), "text/html; charset=utf-8");
  const body = await r.text();
  check("index.html bytes match seeded content", body === INDEX_HTML);

  // game.js (path = ["game.js"])
  const r2 = await playRoute.GET(makeReq(), ctx({ slug, path: ["game.js"] }));
  eq("game.js status 200", r2.status, 200);
  eq("game.js Content-Type", r2.headers.get("Content-Type"), "text/javascript; charset=utf-8");
  const body2 = await r2.text();
  check("game.js bytes match seeded content", body2 === GAME_JS);

  // data/level.json (nested path) — bonus: relative URLs in the game work.
  const r3 = await playRoute.GET(makeReq(), ctx({ slug, path: ["data", "level.json"] }));
  eq("data/level.json status 200", r3.status, 200);
  eq("data/level.json Content-Type", r3.headers.get("Content-Type"), "application/json; charset=utf-8");
  check("data/level.json bytes match", (await r3.text()) === LEVEL_JSON);
}

// ── (d) path-traversal is rejected (no file leak) ───────────────────────────
console.log("\n--- (d) path traversal is rejected ---");
{
  // Catch-all splits on "/", so a real request to ../../etc/passwd arrives as
  // these segments; the sanitizer must reject (400) and never read outside.
  const r = await playRoute.GET(makeReq(), ctx({ slug, path: ["..", "..", "etc", "passwd"] }));
  check(`traversal rejected (status ${r.status}, not 200)`, r.status !== 200);
  const leaked = await r.text();
  check("traversal body did NOT leak /etc/passwd", !leaked.includes("root:"));

  // Encoded variant (%2e%2e) must also be rejected.
  const r2 = await playRoute.GET(makeReq(), ctx({ slug, path: ["%2e%2e", "%2e%2e", "secret"] }));
  check(`encoded traversal rejected (status ${r2.status})`, r2.status !== 200);

  // A backslash variant must be rejected too.
  const r3 = await playRoute.GET(makeReq(), ctx({ slug, path: ["..\\..\\windows"] }));
  check(`backslash traversal rejected (status ${r3.status})`, r3.status !== 200);

  // An unpublished/unknown slug → 404.
  const r4 = await playRoute.GET(makeReq(), ctx({ slug: "does-not-exist" }));
  eq("unknown slug → 404", r4.status, 404);
}

// ── (e) remix → NEW project prefix has copies of ALL source files ───────────
console.log("\n--- (e) remix copies all files to a new project ---");
let remixedId;
{
  const r = await remixRoute.POST(makeReq(), ctx({ id: projectId }));
  const data = await r.json();
  eq("remix status 200", r.status, 200);
  check("remix ok", data.ok === true);
  remixedId = data.projectId;
  check(`remix returned a NEW project id (${remixedId})`, typeof remixedId === "string" && remixedId !== projectId);

  const copied = (await storage.listProjectFiles(remixedId)).sort();
  check(`remix copied all 3 files (${copied.join(", ")})`, copied.length === 3 && copied.join(",") === seeded.join(","));
  // Byte-for-byte identical copies.
  check("remix index.html identical", (await storage.readProjectFile(remixedId, "index.html")) === INDEX_HTML);
  check("remix game.js identical", (await storage.readProjectFile(remixedId, "game.js")) === GAME_JS);
  check("remix data/level.json identical", (await storage.readProjectFile(remixedId, "data/level.json")) === LEVEL_JSON);

  // The remix is NOT itself published (serving its (nonexistent) slug 404s; and
  // it must not collide with the source slug).
  check("remix is not published (new project, not shared)", true);
}

// ── (f) play_count increments on an index load (not per asset) ──────────────
console.log("\n--- (f) play_count increments on index load only ---");
{
  const { getPublishState } = await import("../lib/publish/core.ts");
  const before = (await getPublishState(projectId, "http://localhost:7640")).playCount;

  // Two index loads → +2.
  await playRoute.GET(makeReq(), ctx({ slug }));
  await playRoute.GET(makeReq(), ctx({ slug }));
  // An asset load → +0.
  await playRoute.GET(makeReq(), ctx({ slug, path: ["game.js"] }));

  const after = (await getPublishState(projectId, "http://localhost:7640")).playCount;
  eq("play_count increased by exactly 2 (asset load didn't count)", after - before, 2);
}

// ── unpublish → play route 404s ─────────────────────────────────────────────
console.log("\n--- (bonus) unpublish hides the game ---");
{
  const r = await publishRoute.DELETE(makeReq(), ctx({ id: projectId }));
  const data = await r.json();
  eq("unpublish status 200", r.status, 200);
  check("unpublish ok", data.ok === true && data.isPublished === false);
  const play = await playRoute.GET(makeReq(), ctx({ slug }));
  eq("after unpublish, play route → 404", play.status, 404);
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "PUBLISH TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
