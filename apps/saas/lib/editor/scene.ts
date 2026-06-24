// Pure scene model + web-level (de)serialization — the hosted-model port of the
// studio's scene editor data layer.
//
// The studio's SceneEditor loaded scenes through a DAEMON endpoint
// (/api/scenes/load) that parsed a web level + Godot .tscn into a rich
// SceneModel (colliders, zones, paths, base64 images). The SaaS has no daemon —
// only a byte-accurate file API + the draft-preview route. So we port the
// self-contained, client-renderable slice that the generated vanilla-Canvas
// games actually use: a `data/<level>.json` web level whose `props[]` array
// carries `{ id, image, x, y, w, h, sortY? }` rects (see apps/daemon/src/
// web-scene.ts — `isWebLevelJson` / the props schema). Props are TOP-LEFT {x,y}
// + w/h; images live under assets/ and are served by the draft-preview route.
//
// We faithfully keep the studio's edit semantics (the `props` array is the
// editable layer; add/duplicate/delete/move operate on it) and write changes
// straight back into the level JSON's `props` array, preserving every other
// field + the on-disk EOL. Godot .tscn write-back, collider/zone editing,
// catalog-array editing, and parallax-layer editing are out of scope here
// (they were daemon-coupled in the studio too) — see the report.

import { detectEol, type Eol } from "./data-table";

export interface Vec2 {
  x: number;
  y: number;
}

/** A scene prop as surfaced to the editor. Mirrors the on-disk web-level
 *  `props[]` entry; (x, y) is the TOP-LEFT corner of a w×h rect. */
export interface SceneProp {
  /** Stable id from the on-disk entry (used as the React key + write address). */
  id: string;
  image: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sortY?: number;
}

export interface SceneBackground {
  /** assets/ path of the background image, or null when none/object form. */
  relPath: string | null;
  width: number;
  height: number;
}

/** The parsed, editable scene. `root` holds the full JSON so non-prop fields
 *  round-trip untouched on save. */
export interface SceneModel {
  relPath: string;
  background: SceneBackground;
  props: SceneProp[];
  /** Full parsed JSON document, mutated on save. */
  root: Record<string, unknown>;
  eol: Eol;
  /** First note/description field, if any, for a context hint. */
  note?: string;
}

export interface LevelFile {
  relPath: string;
  name: string;
}

interface RawProp {
  id?: unknown;
  image?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  sortY?: unknown;
  [k: string]: unknown;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Is this JSON a renderable web LEVEL (vs. a catalog/config/collision sidecar)?
 * Mirrors apps/daemon/src/web-scene.ts `isWebLevelJson`: `mapSize.{width,height}`
 * is necessary but not sufficient (sidecars carry it too) — a real level ALSO
 * has at least one visible-content field (background / layers / props).
 */
export function isWebLevelJson(content: string): boolean {
  try {
    const data = JSON.parse(content);
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const obj = data as Record<string, unknown>;
    const sz = obj.mapSize as { width?: unknown; height?: unknown } | undefined;
    if (!sz || typeof sz.width !== "number" || typeof sz.height !== "number") return false;
    const hasBackground =
      typeof obj.background === "string" ||
      (!!obj.background && typeof obj.background === "object");
    const hasLayers = Array.isArray(obj.layers) && obj.layers.length > 0;
    const hasProps = Array.isArray(obj.props) && obj.props.length > 0;
    return hasBackground || hasLayers || hasProps;
  } catch {
    return false;
  }
}

/** Background `assets/...` path from a level's `background` field (string or
 *  `{ image | src | path }` object). null when absent or unrecognized. */
function backgroundPath(obj: Record<string, unknown>): string | null {
  const bg = obj.background;
  if (typeof bg === "string") return bg;
  if (bg && typeof bg === "object") {
    const o = bg as Record<string, unknown>;
    for (const k of ["image", "src", "path", "relPath"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return null;
}

/** Parse a level JSON file's text into an editable SceneModel. Throws with a
 *  clear message when the file isn't a renderable web level. */
export function parseScene(relPath: string, content: string): SceneModel {
  const eol = detectEol(content);
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch (err) {
    throw new Error(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("Not a web level (expected a JSON object).");
  }
  const obj = root as Record<string, unknown>;
  const sz = (obj.mapSize ?? {}) as { width?: unknown; height?: unknown };
  const rawProps = Array.isArray(obj.props) ? (obj.props as RawProp[]) : [];

  const props: SceneProp[] = rawProps
    .filter((p) => p && typeof p === "object" && !Array.isArray(p))
    .map((p, idx) => ({
      id: typeof p.id === "string" && p.id ? p.id : `prop_${idx}`,
      image: typeof p.image === "string" ? p.image : "",
      x: num(p.x),
      y: num(p.y),
      w: num(p.w),
      h: num(p.h),
      ...(p.sortY !== undefined && Number.isFinite(Number(p.sortY))
        ? { sortY: Number(p.sortY) }
        : {}),
    }));

  const note =
    (typeof obj.note === "string" && obj.note) ||
    (typeof obj.description === "string" && obj.description) ||
    undefined;

  return {
    relPath,
    background: {
      relPath: backgroundPath(obj),
      width: num(sz.width),
      height: num(sz.height),
    },
    props,
    root: obj,
    eol,
    note: note || undefined,
  };
}

/**
 * Serialize an edited prop list back into the level's JSON, preserving every
 * other field and the on-disk EOL (+ trailing newline). Only the `props` array
 * is replaced; entries keep `id/image/x/y/w/h` and an optional `sortY` exactly
 * as the generated games expect. Pure — returns the text to PUT.
 */
export function serializeScene(model: SceneModel, props: SceneProp[]): string {
  const nextProps = props.map((p) => {
    const entry: Record<string, unknown> = {
      id: p.id,
      image: p.image,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
    };
    if (p.sortY !== undefined && Number.isFinite(p.sortY)) entry.sortY = p.sortY;
    return entry;
  });
  const nextRoot = { ...model.root, props: nextProps };
  return JSON.stringify(nextRoot, null, 2).replace(/\n/g, model.eol) + model.eol;
}

/** Allocate a `props`-unique id from a stem (e.g. "object" → object_a1b2c3). */
export function uniquePropId(props: SceneProp[], stem: string): string {
  const used = new Set(props.map((p) => p.id));
  const clean =
    stem.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "object";
  let id = "";
  do {
    id = `${clean}_${Math.random().toString(36).slice(2, 8)}`;
  } while (used.has(id));
  return id;
}

/**
 * Discover level files from a flat project file list. Mirrors the studio's
 * `listLevelFiles` ranking: real levels (path contains "level" or "levels/")
 * first, then other data/*.json, then collision-map sidecars last; alphabetical
 * within a rank. (We can't open-and-test every file here — opening surfaces the
 * "not a web level" error if the user picks a non-level.)
 */
export function listLevelFiles(files: string[]): LevelFile[] {
  const rank = (rel: string): number => {
    const low = rel.toLowerCase();
    if (low.includes("collision")) return 2;
    if (low.includes("level")) return 0;
    return 1;
  };
  return files
    .filter((f) => f.startsWith("data/") && f.toLowerCase().endsWith(".json"))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((relPath) => ({ relPath, name: relPath.replace(/^data\//, "") }));
}

/**
 * Build the byte-accurate URL for a project asset, served by the owner-scoped
 * draft-preview route. Used as the <img>/canvas image source for backgrounds +
 * prop textures so the scene renders the project's CURRENT files.
 */
export function assetPreviewUrl(projectId: string, relPath: string): string {
  return `/build/${projectId}/preview/${relPath.replace(/\\/g, "/")}`;
}
