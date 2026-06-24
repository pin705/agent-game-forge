/**
 * Domain-editor data-layer gate (Batch 3).
 *
 * With ZERO accounts (LocalStorage, no Supabase), seed a project with a
 * data/level.json web level + a tiny PNG asset + an asset-credits ledger into
 * storage, then exercise the PURE parse/serialize/transform helpers the Data,
 * Scene, and Assets editors use — no DOM, no HTTP:
 *
 *   (Data)   parse JSON → table model → edit a cell → serialize → re-parse
 *            equals expected; add/delete/move rows; multi-block detection;
 *            EOL preserved on save.
 *   (Scene)  parse the level → props model → move + add a prop → serialize →
 *            re-parse round-trips, non-prop fields preserved, isWebLevelJson
 *            distinguishes a level from a sidecar.
 *   (Assets) list assets from the flat file list → image kept, audio kept,
 *            non-asset skipped; credit joined; thumbnail URL built correctly;
 *            license tone classified; sprite-slice sidecar path derived.
 *
 * Run:  npm run data-test   (tsx resolves the `@/` tsconfig alias)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing any module that
// reads env at import time.
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-data-"));
process.env.OGF_DATA_DIR = dataDir;

// Import AFTER env is set.
const { getStorage } = await import("../lib/storage/index.ts");
const dt = await import("../lib/editor/data-table.ts");
const scene = await import("../lib/editor/scene.ts");
const assets = await import("../lib/editor/assets.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

const storage = getStorage();
const projectId = "data-" + Math.random().toString(36).slice(2, 8);

// A real 1×1 transparent PNG (canonical 68-byte blob).
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const LEVEL = {
  background: "assets/maps/temple.png",
  mapSize: { width: 800, height: 600 },
  spawn: { x: 100, y: 200 },
  props: [
    { id: "rock_1", image: "assets/rock.png", x: 40, y: 60, w: 32, h: 32, sortY: 92 },
    { id: "tree_1", image: "assets/tree.png", x: 200, y: 100, w: 64, h: 128 },
  ],
};
const LEVEL_TEXT = JSON.stringify(LEVEL, null, 2) + "\n";

const ENEMIES = [
  { id: "slime", hp: 10, speed: 2, boss: false },
  { id: "bat", hp: 6, speed: 4, boss: false },
];
const ENEMIES_TEXT = JSON.stringify(ENEMIES, null, 2) + "\n";

const CREDITS = [
  { asset: "assets/rock.png", id: "r1", source: "OpenGameArt", license: "CC0", author: "alice" },
];

console.log(`\n=== Domain-editor data-layer (data dir: ${dataDir}) ===`);

// ── Seed the project via storage (exactly what a build / PUT would write). ──
const enc = (s) => new TextEncoder().encode(s);
await storage.writeProjectFile(projectId, "data/level.json", enc(LEVEL_TEXT));
await storage.writeProjectFile(projectId, "data/enemies.json", enc(ENEMIES_TEXT));
await storage.writeProjectFile(projectId, "data/asset-credits.json", enc(JSON.stringify(CREDITS, null, 2)));
await storage.writeProjectFile(projectId, "assets/rock.png", PNG_BYTES);
await storage.writeProjectFile(projectId, "assets/sfx/jump.wav", new Uint8Array([0x52, 0x49, 0x46, 0x46]));
await storage.writeProjectFile(projectId, "index.html", enc("<!doctype html>"));

const fileList = (await storage.listProjectFiles(projectId)).sort();

// ── (Data) parse → edit cell → serialize → re-parse equals expected ──────────
console.log("\n--- (Data) table model: parse → edit → serialize round-trip ---");
{
  const text = await storage.readProjectFileText(projectId, "data/enemies.json");
  const eol = dt.detectEol(text);
  check("enemies EOL detected as LF", eol === "\n");
  const doc = dt.parseDoc(text, eol);
  check("root array-of-objects → one block", doc.blocks.length === 1 && doc.blocks[0].path.length === 0);
  const cols = dt.columnsOf(doc.blocks[0].rows);
  check("columns in first-seen order", cols.map((c) => c.key).join(",") === "id,hp,speed,boss");
  check("hp typed number", cols.find((c) => c.key === "hp").type === "number");
  check("boss typed boolean", cols.find((c) => c.key === "boss").type === "boolean");
  check("id typed string", cols.find((c) => c.key === "id").type === "string");

  // Edit a cell: slime.hp 10 → 25.
  const edited = dt.commitToContent(text, eol, 0, (rows) =>
    rows.map((r, i) => (i === 0 ? { ...r, hp: 25 } : r)),
  );
  const reparsed = dt.parseDoc(edited, eol);
  check("edited cell persisted", reparsed.blocks[0].rows[0].hp === 25);
  check("other cell untouched", reparsed.blocks[0].rows[1].hp === 6);

  // Add a row with type defaults.
  const blank = {};
  for (const c of cols) blank[c.key] = dt.defaultValueForType(c.type);
  const added = dt.commitToContent(edited, eol, 0, (rows) => [...rows, blank]);
  const addedDoc = dt.parseDoc(added, eol);
  check("add row appended with defaults", addedDoc.blocks[0].rows.length === 3 && addedDoc.blocks[0].rows[2].hp === 0 && addedDoc.blocks[0].rows[2].boss === false);

  // Delete the new row, then move rows.
  const deleted = dt.commitToContent(added, eol, 0, (rows) => rows.filter((_, i) => i !== 2));
  check("delete row removes it", dt.parseDoc(deleted, eol).blocks[0].rows.length === 2);
  const moved = dt.commitToContent(deleted, eol, 0, (rows) => {
    const n = [...rows];
    const [r] = n.splice(0, 1);
    n.splice(1, 0, r);
    return n;
  });
  check("move row swaps order", dt.parseDoc(moved, eol).blocks[0].rows[0].id === "bat");

  // Serialize with CRLF preservation + trailing newline.
  const crlf = dt.serializeDoc(edited.replace(/\n/g, "\r\n"), "\r\n");
  check("CRLF serialize uses CRLF + trailing newline", crlf.includes("\r\n") && crlf.endsWith("\r\n"));
  check("CRLF serialize re-parses to same data", dt.parseDoc(crlf, "\r\n").blocks[0].rows[0].hp === 25);
}

// ── (Data) multi-block + not-a-table detection ───────────────────────────────
console.log("\n--- (Data) multi-block + non-table detection ---");
{
  const multi = JSON.stringify({ wild: [{ id: "a" }], marsh: [{ id: "b" }, { id: "c" }] }, null, 2);
  const doc = dt.parseDoc(multi, "\n");
  check("nested arrays → two blocks", doc.blocks.length === 2);
  check("block labels are the field names", doc.blocks.map((b) => b.label).join(",") === "wild,marsh");
  check("block path addresses the field", doc.blocks[1].path[0] === "marsh");

  const notTable = dt.parseDoc(JSON.stringify({ musicGain: 0.5 }), "\n");
  check("scalar object → not a table (reason set)", notTable.blocks.length === 0 && !!notTable.reason);
  const bad = dt.parseDoc("{ not json", "\n");
  check("invalid JSON → reason set", bad.blocks.length === 0 && /parse error/i.test(bad.reason));
}

// ── (Scene) parse level → move + add prop → serialize round-trip ─────────────
console.log("\n--- (Scene) web-level loader: parse → edit → serialize round-trip ---");
{
  const text = await storage.readProjectFileText(projectId, "data/level.json");
  check("isWebLevelJson true for a real level", scene.isWebLevelJson(text));
  const sidecar = JSON.stringify({ mapSize: { width: 800, height: 600 }, blockers: [{ id: "b", x: 0, y: 0, w: 10, h: 10 }] });
  check("isWebLevelJson false for a collision sidecar", !scene.isWebLevelJson(sidecar));

  const model = scene.parseScene("data/level.json", text);
  check("background path parsed", model.background.relPath === "assets/maps/temple.png");
  check("mapSize parsed", model.background.width === 800 && model.background.height === 600);
  check("two props parsed", model.props.length === 2);
  check("prop fields parsed (top-left x/y + w/h)", model.props[0].id === "rock_1" && model.props[0].x === 40 && model.props[0].w === 32);
  check("optional sortY preserved on parse", model.props[0].sortY === 92);

  // Move rock_1 and add a new prop.
  const id = scene.uniquePropId(model.props, "object");
  check("uniquePropId avoids collisions + has stem", id.startsWith("object_") && !model.props.some((p) => p.id === id));
  const nextProps = [
    ...model.props.map((p) => (p.id === "rock_1" ? { ...p, x: 999, y: 111 } : p)),
    { id, image: "assets/placeholder.png", x: 10, y: 20, w: 64, h: 64 },
  ];
  const out = scene.serializeScene(model, nextProps);
  check("serialized scene ends with the level's EOL + newline", out.endsWith("\n"));
  const reloaded = scene.parseScene("data/level.json", out);
  check("moved prop persisted", reloaded.props[0].x === 999 && reloaded.props[0].y === 111);
  check("added prop persisted with id", reloaded.props.length === 3 && reloaded.props[2].id === id);
  check("sortY round-trips only where present", reloaded.props[0].sortY === 92 && reloaded.props[2].sortY === undefined);

  // Non-prop fields must be preserved verbatim.
  const rootBack = JSON.parse(out);
  check("background field preserved", rootBack.background === "assets/maps/temple.png");
  check("spawn field preserved", rootBack.spawn && rootBack.spawn.x === 100 && rootBack.spawn.y === 200);
  check("mapSize field preserved", rootBack.mapSize.width === 800);

  // Level discovery + asset preview URL.
  const lvls = scene.listLevelFiles(fileList);
  check("listLevelFiles finds data/level.json", lvls.some((l) => l.relPath === "data/level.json"));
  check("level name strips data/ prefix", lvls.find((l) => l.relPath === "data/level.json").name === "level.json");
  check("assetPreviewUrl built from draft-preview route", scene.assetPreviewUrl(projectId, "assets/rock.png") === `/build/${projectId}/preview/assets/rock.png`);
}

// ── (Assets) listing + thumbnail + credits + license + slice sidecar ─────────
console.log("\n--- (Assets) listing + thumbnail URL + credits + license tone ---");
{
  const text = await storage.readProjectFileText(projectId, "data/asset-credits.json");
  const credits = assets.parseAssetCredits(text);
  check("credits ledger parsed by asset path", credits.get("assets/rock.png")?.license === "CC0");

  const list = assets.listAssets(fileList, credits);
  const paths = list.map((a) => a.relPath);
  check("image asset listed", paths.includes("assets/rock.png"));
  check("audio asset listed", paths.includes("assets/sfx/jump.wav"));
  check("non-asset (data/index) excluded", !paths.includes("data/level.json") && !paths.includes("index.html"));
  check("media kind classified", list.find((a) => a.relPath === "assets/rock.png").mediaKind === "image" && list.find((a) => a.relPath === "assets/sfx/jump.wav").mediaKind === "audio");
  check("credit joined onto the image", list.find((a) => a.relPath === "assets/rock.png").credit?.author === "alice");
  check("sorted by relPath", paths[0] <= paths[paths.length - 1]);

  check("thumbnail URL built from draft-preview route", assets.assetThumbUrl(projectId, "assets/rock.png") === `/build/${projectId}/preview/assets/rock.png`);
  check("license tone: CC0", assets.licenseTone("CC0") === "cc0");
  check("license tone: CC-BY", assets.licenseTone("CC-BY 4.0") === "cc-by");
  check("license tone: unknown", assets.licenseTone(null) === "unknown");
  check("slice sidecar path derived", assets.sliceSidecarPath("assets/sprites/walk.png") === "assets/sprites/walk.ogf-slice.json");
  check("asset reference normalizes slashes", assets.assetReference("assets\\rock.png") === "assets/rock.png");
}

// ── Storage delete (assets panel) is reflected in the listing ────────────────
console.log("\n--- (Assets) delete via storage drops it from the list ---");
{
  await storage.deleteProjectFile(projectId, "assets/rock.png");
  const after = (await storage.listProjectFiles(projectId)).sort();
  check("deleted asset gone from storage", !after.includes("assets/rock.png"));
  const list = assets.listAssets(after, new Map());
  check("deleted asset gone from listing", !list.some((a) => a.relPath === "assets/rock.png"));
  await storage.deleteProjectFile(projectId, "assets/rock.png"); // idempotent
  check("delete is idempotent (no throw on missing)", true);
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL DATA-EDITOR CHECKS PASSED" : "DATA TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
