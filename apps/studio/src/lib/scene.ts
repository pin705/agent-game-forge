// Typed client for the OGF daemon's 2D scene routes, proxied at /api → :7621.
// Mirrors apps/web/src/lib/api.ts (fetchScene / applySceneOps) and the daemon's
// scene contract (packages/contracts/src/scene.ts). The studio app does NOT
// depend on @ogf/contracts — like lib/runs.ts, the wire types are re-declared
// locally so the new shadcn studio reuses the backend untouched.
//
// A web project's "scene" is a JSON level file (e.g. data/level1.json) carrying
// `mapSize` + background/layers/props/colliders/zones/paths. The daemon
// translates it into the engine-agnostic SceneModel below.

// ---------- Geometry ----------

export interface Vec2 {
  x: number;
  y: number;
}

// ---------- Scene model (mirror of @ogf/contracts SceneModel) ----------

export interface SceneBackground {
  /** Project-relative PNG used as the backdrop. */
  relPath: string;
  /** Declared mapSize (px). The daemon passes mapSize through so editor coords
   *  align with the runtime even when the PNG's natural size differs. */
  width?: number;
  height?: number;
  /** 'tile' = small repeating tile drawn across the whole map via modulo wrap.
   *  Everything else = a single image stretched to width×height. */
  source: 'image' | 'tilemap-preview' | 'placeholder' | 'tile';
  tileW?: number;
  tileH?: number;
}

export interface SceneLayer {
  id: string;
  relPath: string;
  /** Render order — lower draws first (further back). */
  zIndex: number;
  parallax?: number;
  width?: number;
  height?: number;
  /** When true, tile the PNG horizontally via modulo wrap (parallax strip). */
  repeatX?: boolean;
  tileW?: number;
  tileH?: number;
}

export interface SceneProp {
  /** Stable id within this scene ("section/id"). */
  nodePath: string;
  name: string;
  /** What the user drags — written back as the prop's position. */
  position: Vec2;
  /** Render offset from `position`. For web props the loader sets this so the
   *  visual bounding-box center = position + spriteOffset. */
  spriteOffset: Vec2;
  scale: Vec2;
  /** Project-relative PNG, or null when the entry is collision-only. */
  texture: string | null;
  metadata: Record<string, string>;
  /** Fixed render size for web props (overrides naturalSize × scale). */
  displaySize?: Vec2;
  /** Godot Sprite2D centered attribute. Web props are bbox-centered, so the
   *  loader leaves this undefined → treated as centered. */
  centered?: boolean;
  /** Render order. Lower draws first (further back). Default 0. */
  zIndex?: number;
  /** Write-back location for JSON-backed (web) props. */
  ref?: ColliderRef;
}

export type ColliderShape =
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'circle'; r: number }
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'point' };

/** Where a collider/marker/prop lives + how to address it for writes. The web
 *  loader only ever emits the 'json' backend; 'tscn' is included for parity. */
export type ColliderRef =
  | {
      backend: 'tscn';
      nodePath: string;
      subResourceId: string;
      markerSizeProperty?: string;
      markerRadiusProperty?: string;
    }
  | {
      backend: 'json';
      relPath: string;
      section: string;
      id: string;
      singleField?: boolean;
    };

export interface SceneCollider {
  uid: string;
  ref: ColliderRef;
  name: string;
  kind: string;
  position: Vec2;
  shape: ColliderShape;
  editable: boolean;
}

export type ZoneKind = 'encounter' | 'exit' | 'spawn' | 'marker' | 'unknown';

export interface SceneZone {
  uid: string;
  ref: ColliderRef;
  name: string;
  zoneKind: ZoneKind;
  position: Vec2;
  shape: ColliderShape;
  fields: Record<string, string | number>;
  editable: boolean;
}

export interface ScenePath {
  uid: string;
  ref: ColliderRef;
  name: string;
  origin: Vec2;
  points: Vec2[];
  hasBezierHandles: boolean;
  editable: boolean;
}

export interface SceneModel {
  scenePath: string;
  rootName: string;
  background: SceneBackground | null;
  layers?: SceneLayer[];
  props: SceneProp[];
  colliders: SceneCollider[];
  collidersJsonPath: string | null;
  zones: SceneZone[];
  zonesJsonPath: string | null;
  paths: ScenePath[];
  notes: string[];
}

/** Image bytes returned alongside the model so the canvas renders in one trip. */
export interface SceneImagePayload {
  relPath: string;
  base64: string;
  width: number;
  height: number;
}

export interface LoadSceneResponse {
  scene: SceneModel;
  images: SceneImagePayload[];
}

// ---------- Edit ops (subset — this editor only emits move-prop) ----------

/** Move a prop's parent node to a new position. For web scenes `ref` (json
 *  backend) tells the daemon which JSON entry to patch. */
export interface MovePropOp {
  kind: 'move-prop';
  nodePath: string;
  position: Vec2;
  ref?: ColliderRef;
}

// The daemon's SceneOp union is larger (scale/collider/zone/path/add/remove);
// this editor only produces move-prop. Widen here if more editing lands.
export type SceneOp = MovePropOp;

export interface ApplySceneOpsRequest {
  projectPath: string;
  relPath: string;
  ops: SceneOp[];
}

export interface ApplySceneOpsResponse {
  ok: true;
  /** Updated bytes-on-disk size. */
  size: number;
}

// ---------- File tree (mirror of @ogf/contracts FileNode) ----------

export interface FileNode {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  children?: FileNode[];
}

export interface FileTreeResponse {
  tree: FileNode;
}

// ---------- HTTP helpers ----------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

// ---------- Level discovery ----------

/** A level the editor can open. */
export interface LevelFile {
  /** Project-relative POSIX path, e.g. "data/level1.json". */
  relPath: string;
  /** Display label, e.g. "level1.json". */
  name: string;
}

/** Flatten a FileNode tree into the list of `.json` files under `data/`. We
 *  can't tell a real level from a collision-map sidecar by name alone (both end
 *  in .json), so we surface every data/*.json and let fetchScene reject the
 *  non-levels (the daemon throws "not a level (missing mapSize)" for sidecars).
 *  Sidecars are de-prioritised by sorting obvious *-collision-map.json last. */
export function listLevelFiles(tree: FileNode): LevelFile[] {
  const out: LevelFile[] = [];
  const visit = (node: FileNode) => {
    if (node.kind === 'file') {
      const rel = node.relPath;
      if (rel.startsWith('data/') && rel.toLowerCase().endsWith('.json')) {
        out.push({ relPath: rel, name: node.name });
      }
      return;
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(tree);
  // Levels before sidecars/catalogs; then alphabetical for stability.
  const rank = (l: LevelFile) => {
    const r = l.relPath.toLowerCase();
    if (r.includes('collision-map') || r.includes('-collision')) return 2;
    // Catalog files (data/hazards.json etc.) aren't levels — push them down.
    if (!r.includes('/level') && !r.includes('/levels/')) return 1;
    return 0;
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.relPath.localeCompare(b.relPath));
}

/** List candidate level files for a project (walks /api/files/tree). */
export async function listLevels(projectPath: string): Promise<LevelFile[]> {
  const r = await jget<FileTreeResponse>(
    `/api/files/tree?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return listLevelFiles(r.tree);
}

// ---------- Scene load / save ----------

// Serialize writes to the same scene so a save and a follow-up read don't race
// the daemon's filesystem write order — mirrors apps/web/src/lib/api.ts.
const inFlightSceneWrites = new Map<string, Promise<unknown>>();
const sceneKey = (projectPath: string, relPath: string) => `${projectPath}::${relPath}`;

export async function fetchScene(
  projectPath: string,
  relPath: string,
): Promise<LoadSceneResponse> {
  const pending = inFlightSceneWrites.get(sceneKey(projectPath, relPath));
  if (pending) await pending.catch(() => {});
  return jget<LoadSceneResponse>(
    `/api/scenes/load?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );
}

export async function applySceneOps(
  req: ApplySceneOpsRequest,
): Promise<ApplySceneOpsResponse> {
  const key = sceneKey(req.projectPath, req.relPath);
  const prev = inFlightSceneWrites.get(key);
  const run = async (): Promise<ApplySceneOpsResponse> => {
    if (prev) await prev.catch(() => {});
    return jpost<ApplySceneOpsResponse>('/api/scenes/save', req);
  };
  const promise = run();
  inFlightSceneWrites.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightSceneWrites.get(key) === promise) inFlightSceneWrites.delete(key);
  }
}
