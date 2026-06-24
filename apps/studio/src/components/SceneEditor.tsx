// 2D scene editor — a focused port of apps/web/src/components/SceneEditor.tsx
// (~5200 lines) into the new shadcn studio. Scope kept deliberately tight so it
// compiles under strict tsc:
//
//   PORTED:  load a web level (data/<level>.json → SceneModel), render
//            background / parallax layers / props on a <canvas>, camera
//            pan + wheel-zoom-toward-cursor, drag-move a prop with
//            save-on-drop (move-prop op → applySceneOps).
//   EDITING: properties panel (live x/y edit), add / duplicate / delete
//            object tools, and snapshot-based undo/redo (Ctrl/Cmd+Z,
//            Ctrl/Cmd+Shift+Z). All mutations persist through the SAME
//            applySceneOps path: a move emits move-prop, while add/delete
//            emit add-prop / remove-prop (the daemon route already accepts
//            both — only lib/scene.ts's SceneOp type is narrower, so the
//            extra op shapes are declared locally here). Limited to the
//            JSON-backed `props` array — gameplay arrays (platforms/hazards)
//            and Godot .tscn nodes stay move-only.
//   READ-ONLY EXTRAS: colliders + zones drawn as dim outlines for context.
//   TRIMMED (vs the original — see TODOs): prop scaling/resize handles,
//            collider/zone/path editing, multi-select, comments, minimap,
//            live scene-context push.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  Minus,
  Plus,
  Scan,
  Loader2,
  ChevronDown,
  AlertCircle,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  PlusSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  applySceneOps,
  fetchScene,
  listLevels,
  type ColliderRef,
  type LevelFile,
  type SceneModel,
  type SceneProp,
  type Vec2,
} from '@/lib/scene';
import { useT } from '@/lib/i18n';

type Camera = { scale: number; panX: number; panY: number };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type DragState =
  | { kind: 'pan'; startClient: Vec2; startPan: Vec2 }
  | { kind: 'prop'; nodePath: string; startWorld: Vec2; startPos: Vec2 };

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const MAX_UNDO = 100;
/** Default size (px) for a freshly added object. */
const DEFAULT_PROP_SIZE = 64;
/** Placeholder texture path for newly-added objects. Deliberately a path that
 *  may not exist on disk: the web-level loader requires props[] entries to
 *  carry a non-empty `image` (it skips blank ones on reload), while both the
 *  studio canvas and the game runtimes fall back gracefully when the file is
 *  absent — so the object round-trips without ever showing a broken image. */
const PLACEHOLDER_TEXTURE = 'assets/placeholder.png';

// ---- Edit ops not yet surfaced in lib/scene.ts's narrow SceneOp union ----
//
// lib/scene.ts intentionally types `SceneOp = MovePropOp` (the only op the
// original port emitted). The daemon's /api/scenes/save route, however, has
// always accepted add-prop / remove-prop for JSON-backed levels
// (apps/daemon/src/scenes.ts). Since this file may only edit SceneEditor.tsx,
// the extra op shapes are declared locally and routed through the SAME
// applySceneOps() helper (so its in-flight-write serialization still guards
// against save/reload races); the array is cast to the lib type at the call
// site. These mirror @ogf/contracts AddPropOp / RemovePropOp exactly.
interface AddPropOpLocal {
  kind: 'add-prop';
  relPath: string;
  section?: string;
  entry: { id: string; image: string; x: number; y: number; w: number; h: number; sortY?: number };
}
interface RemovePropOpLocal {
  kind: 'remove-prop';
  relPath: string;
  section?: string;
  id: string;
}
interface MovePropOpLocal {
  kind: 'move-prop';
  nodePath: string;
  position: Vec2;
  ref?: ColliderRef;
}
type EditOp = AddPropOpLocal | RemovePropOpLocal | MovePropOpLocal;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Reconstruct the on-disk JSON entry for a prop so it can be re-added.
 *  Mirrors apps/web's deleteSelection entry shape (image + x/y/w/h + sortY). */
function propToEntry(p: SceneProp): AddPropOpLocal['entry'] {
  const sortY = p.metadata.sortY ? Number(p.metadata.sortY) : undefined;
  return {
    id: refId(p),
    image: p.texture ?? '',
    x: p.position.x,
    y: p.position.y,
    w: p.displaySize?.x ?? 0,
    h: p.displaySize?.y ?? 0,
    ...(sortY !== undefined && Number.isFinite(sortY) ? { sortY } : {}),
  };
}

type JsonProp = SceneProp & { ref: Extract<ColliderRef, { backend: 'json' }> };

/** A JSON-backed prop's id from its ref (only json props are persistable —
 *  Godot .tscn write-back is out of scope). */
function refId(p: SceneProp): string {
  return p.ref?.backend === 'json' ? p.ref.id : p.nodePath;
}
function isJsonProp(p: SceneProp): p is JsonProp {
  return p.ref?.backend === 'json';
}
/** Add / duplicate / delete are limited to the `props` array. propToEntry only
 *  reproduces the image-rect shape `props[]` uses; reconstructing one for a
 *  gameplay array (platforms carry `tile`/`renderMode`, hazards carry `type`)
 *  would drop those fields and corrupt the entry, so those sections stay
 *  move-only (drag still works). */
function isEditableProp(p: SceneProp): p is JsonProp {
  return isJsonProp(p) && p.ref.section === 'props';
}

/** Diff two prop snapshots (keyed by nodePath) into the add/remove/move ops
 *  needed to turn `prev` (what's on disk) into `next`. Used by every mutating
 *  action and by undo/redo so the JSON file always matches on-canvas state.
 *  add/remove are restricted to `props`-section entries (see isEditableProp);
 *  any json prop (incl. gameplay arrays) can still be moved. */
function diffPropsToOps(prev: SceneProp[], next: SceneProp[]): EditOp[] {
  const ops: EditOp[] = [];
  const prevByPath = new Map(prev.map((p) => [p.nodePath, p]));
  const nextByPath = new Map(next.map((p) => [p.nodePath, p]));

  // Removed.
  for (const p of prev) {
    if (!nextByPath.has(p.nodePath) && isEditableProp(p)) {
      ops.push({ kind: 'remove-prop', relPath: p.ref.relPath, section: p.ref.section, id: p.ref.id });
    }
  }
  // Added or changed.
  for (const p of next) {
    if (!isJsonProp(p)) continue;
    const before = prevByPath.get(p.nodePath);
    if (!before) {
      if (isEditableProp(p)) {
        ops.push({ kind: 'add-prop', relPath: p.ref.relPath, section: p.ref.section, entry: propToEntry(p) });
      }
    } else if (before.position.x !== p.position.x || before.position.y !== p.position.y) {
      // Only x/y are editable here; persist via the same move-prop path the
      // drag-on-drop already uses.
      ops.push({ kind: 'move-prop', nodePath: p.nodePath, position: p.position, ref: p.ref });
    }
  }
  return ops;
}

/** Decode the base64 PNGs the daemon sent into an HTMLImageElement cache keyed
 *  by project-relative path. Resolves once every image has loaded (or errored —
 *  a missing texture shouldn't block the whole scene from drawing). */
function decodeImages(
  images: { relPath: string; base64: string }[],
): Promise<Map<string, HTMLImageElement>> {
  return Promise.all(
    images.map(
      (im) =>
        new Promise<[string, HTMLImageElement] | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve([im.relPath, img]);
          img.onerror = () => resolve(null);
          img.src = `data:image/png;base64,${im.base64}`;
        }),
    ),
  ).then((pairs) => {
    const map = new Map<string, HTMLImageElement>();
    for (const p of pairs) if (p) map.set(p[0], p[1]);
    return map;
  });
}

/** World-space axis-aligned bounding box for a prop. Web props are
 *  bbox-centered at `position + spriteOffset` (the loader sets spriteOffset so
 *  this holds for both bottom-center sprites and top-left gameplay rects). */
function propBounds(p: SceneProp): { x: number; y: number; w: number; h: number } {
  const w = (p.displaySize?.x ?? 0) * (p.scale.x || 1);
  const h = (p.displaySize?.y ?? 0) * (p.scale.y || 1);
  const cx = p.position.x + p.spriteOffset.x;
  const cy = p.position.y + p.spriteOffset.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function SceneEditor({ projectPath }: { projectPath: string }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [levels, setLevels] = useState<LevelFile[]>([]);
  const [relPath, setRelPath] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneModel | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [camera, setCamera] = useState<Camera>({ scale: 1, panX: 0, panY: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Drag state lives in a ref — pointer math runs every mousemove and must not
  // chase stale React state. The dragged prop's live position is mirrored into
  // `scene` so the canvas redraws as it moves.
  const dragRef = useRef<DragState | null>(null);
  // Props array as it was when a prop-drag began — pushed onto the undo stack
  // on drop so a drag-move is undoable like every other mutation.
  const dragSnapshotRef = useRef<SceneProp[] | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  // ---- Undo/redo: snapshots of `props`. We push the PRE-mutation props array
  // before every mutating action; undo restores the previous snapshot (and
  // mirrors the change back to disk via diffPropsToOps). The two counters are
  // state-backed only to keep the toolbar button enabled/disabled in sync —
  // the snapshots themselves live in refs so they don't trigger redraws. ----
  const undoStackRef = useRef<SceneProp[][]>([]);
  const redoStackRef = useRef<SceneProp[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  // ---- Level discovery ----
  useEffect(() => {
    let alive = true;
    listLevels(projectPath)
      .then((ls) => {
        if (!alive) return;
        setLevels(ls);
        setRelPath((cur) => cur ?? ls[0]?.relPath ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [projectPath]);

  // ---- Scene load (on level change). Tries the picked level, and if it isn't
  // a real level (sidecar/catalog → daemon throws), falls back to the next
  // candidate so the user lands on something renderable. ----
  useEffect(() => {
    if (!relPath) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setScene(null);

    const candidates = [relPath, ...levels.map((l) => l.relPath).filter((r) => r !== relPath)];

    (async () => {
      let lastErr: unknown = null;
      for (const cand of candidates) {
        try {
          const res = await fetchScene(projectPath, cand);
          if (!alive) return;
          const bank = await decodeImages(res.images);
          if (!alive) return;
          setScene(res.scene);
          setImages(bank);
          setSelected(null);
          // Fresh level → drop edit history so undo can't reach into a level
          // that's no longer open.
          undoStackRef.current = [];
          redoStackRef.current = [];
          syncHistoryFlags();
          if (cand !== relPath) setRelPath(cand); // settle on the one that worked
          setLoading(false);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!alive) return;
      setLoading(false);
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'failed to load level'));
    })();

    return () => {
      alive = false;
    };
    // `levels` is intentionally excluded — we only re-load when the user picks
    // a level, not when the (stable) candidate list resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, relPath]);

  // ---- Fit camera to the scene's map extent when a new scene loads ----
  const fitToView = useCallback(() => {
    const cont = containerRef.current;
    if (!cont || !scene) return;
    const rect = cont.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Prefer the declared mapSize (background/layer width+height). Fall back to
    // the union of prop bounds so prop-only scenes still frame sensibly.
    let w = scene.background?.width ?? scene.layers?.[0]?.width ?? 0;
    let h = scene.background?.height ?? scene.layers?.[0]?.height ?? 0;
    if (!w || !h) {
      let maxX = 0;
      let maxY = 0;
      for (const p of scene.props) {
        const b = propBounds(p);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      w = maxX || 1280;
      h = maxY || 720;
    }
    const pad = 0.92;
    const scale = clamp(Math.min((rect.width / w) * pad, (rect.height / h) * pad), MIN_SCALE, MAX_SCALE);
    const panX = w / 2 - rect.width / 2 / scale;
    const panY = h / 2 - rect.height / 2 / scale;
    setCamera({ scale, panX, panY });
  }, [scene]);

  useEffect(() => {
    if (scene) fitToView();
    // Only refit on scene identity change, not on every fitToView identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // ---- Coordinate transforms ----
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const cont = containerRef.current;
      if (!cont) return { x: 0, y: 0 };
      const r = cont.getBoundingClientRect();
      const sx = clientX - r.left;
      const sy = clientY - r.top;
      return { x: sx / camera.scale + camera.panX, y: sy / camera.scale + camera.panY };
    },
    [camera],
  );

  const propsByZ = useMemo(() => {
    if (!scene) return [];
    return [...scene.props].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  }, [scene]);

  // ---- Canvas drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const cont = containerRef.current;
    if (!canvas || !cont) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = cont.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // Checkerboard-ish dark backdrop outside the map.
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, cssW, cssH);

    if (!scene) return;

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.panX, -camera.panY);

    const mapW = scene.background?.width ?? scene.layers?.[0]?.width ?? 0;
    const mapH = scene.background?.height ?? scene.layers?.[0]?.height ?? 0;

    // Map backdrop fill (so the world area reads as distinct from the void).
    if (mapW && mapH) {
      ctx.fillStyle = '#15161a';
      ctx.fillRect(0, 0, mapW, mapH);
    }

    // ---- Background ----
    const bg = scene.background;
    if (bg) {
      const img = images.get(bg.relPath);
      if (img) {
        if (bg.source === 'tile') {
          const tw = bg.tileW || img.width || 64;
          const th = bg.tileH || img.height || 64;
          const w = bg.width || mapW || tw;
          const h = bg.height || mapH || th;
          for (let y = 0; y < h; y += th) {
            for (let x = 0; x < w; x += tw) ctx.drawImage(img, x, y, tw, th);
          }
        } else {
          const w = bg.width || img.width;
          const h = bg.height || img.height;
          ctx.drawImage(img, 0, 0, w, h);
        }
      }
    }

    // ---- Parallax layers (z-sorted, no real parallax preview — just stacked) ----
    if (scene.layers) {
      for (const layer of [...scene.layers].sort((a, b) => a.zIndex - b.zIndex)) {
        const img = images.get(layer.relPath);
        if (!img) continue;
        const w = layer.width || mapW || img.width;
        const h = layer.height || mapH || img.height;
        if (layer.repeatX) {
          const tw = layer.tileW || img.width || w;
          for (let x = 0; x < w; x += tw) ctx.drawImage(img, x, 0, tw, h);
        } else {
          ctx.drawImage(img, 0, 0, w, h);
        }
      }
    }

    // ---- Props (z-sorted) ----
    for (const p of propsByZ) {
      const b = propBounds(p);
      const img = p.texture ? images.get(p.texture) : undefined;
      if (img && b.w > 0 && b.h > 0) {
        // Aspect-fit (letterbox) the sprite inside its display rect so it
        // matches the runtime's object-fit: contain draw.
        const ar = img.width / img.height;
        const br = b.w / b.h;
        let dw = b.w;
        let dh = b.h;
        if (ar > br) dh = b.w / ar;
        else dw = b.h * ar;
        const dx = b.x + (b.w - dw) / 2;
        const dy = b.y + (b.h - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else if (b.w > 0 && b.h > 0) {
        // No texture → outlined rect with a label (collision-only platforms).
        ctx.fillStyle = 'rgba(220, 90, 60, 0.12)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = 'rgba(220, 90, 60, 0.7)';
        ctx.lineWidth = 1 / camera.scale;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        const label = p.metadata.kind || p.metadata.type || p.name;
        if (label && camera.scale > 0.25) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = `${Math.max(9, 11 / camera.scale)}px ui-sans-serif, system-ui`;
          ctx.fillText(label, b.x + 3 / camera.scale, b.y + 13 / camera.scale);
        }
      }
      if (p.nodePath === selected) {
        ctx.strokeStyle = '#e2603c';
        ctx.lineWidth = 2 / camera.scale;
        ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
      }
    }

    // ---- Colliders (read-only context outlines) ----
    ctx.lineWidth = 1 / camera.scale;
    for (const c of scene.colliders) {
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
      drawShape(ctx, c.position, c.shape, camera.scale);
    }
    // ---- Zones (read-only context outlines) ----
    for (const z of scene.zones) {
      ctx.strokeStyle =
        z.zoneKind === 'spawn'
          ? 'rgba(74, 222, 128, 0.7)'
          : z.zoneKind === 'exit'
            ? 'rgba(250, 204, 21, 0.7)'
            : 'rgba(192, 132, 252, 0.6)';
      drawShape(ctx, z.position, z.shape, camera.scale);
    }

    ctx.restore();
  }, [scene, images, camera, selected, propsByZ]);

  // Redraw on container resize.
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const ro = new ResizeObserver(() => {
      // Bump camera reference identity to force the draw effect to re-run.
      setCamera((c) => ({ ...c }));
    });
    ro.observe(cont);
    return () => ro.disconnect();
  }, []);

  // ---- Hit-test: topmost prop under a world point ----
  const findPropAt = useCallback(
    (world: Vec2): SceneProp | null => {
      for (let i = propsByZ.length - 1; i >= 0; i--) {
        const p = propsByZ[i];
        const b = propBounds(p);
        if (b.w <= 0 || b.h <= 0) continue;
        if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) {
          return p;
        }
      }
      return null;
    },
    [propsByZ],
  );

  // ---- Pointer handlers ----
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!scene) return;
      const world = clientToWorld(e.clientX, e.clientY);
      const hit = e.button === 0 ? findPropAt(world) : null;
      if (hit) {
        setSelected(hit.nodePath);
        dragRef.current = {
          kind: 'prop',
          nodePath: hit.nodePath,
          startWorld: world,
          startPos: { ...hit.position },
        };
        dragSnapshotRef.current = scene.props;
      } else {
        if (e.button === 0) setSelected(null);
        dragRef.current = {
          kind: 'pan',
          startClient: { x: e.clientX, y: e.clientY },
          startPan: { x: camera.panX, y: camera.panY },
        };
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [scene, clientToWorld, findPropAt, camera],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.kind === 'pan') {
        const dx = (e.clientX - ds.startClient.x) / camera.scale;
        const dy = (e.clientY - ds.startClient.y) / camera.scale;
        setCamera((c) => ({ ...c, panX: ds.startPan.x - dx, panY: ds.startPan.y - dy }));
        return;
      }
      // Drag-move a prop. Snap to whole pixels unless Shift is held.
      const world = clientToWorld(e.clientX, e.clientY);
      let nx = ds.startPos.x + (world.x - ds.startWorld.x);
      let ny = ds.startPos.y + (world.y - ds.startWorld.y);
      if (!e.shiftKey) {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      setScene((s) =>
        s
          ? {
              ...s,
              props: s.props.map((p) =>
                p.nodePath === ds.nodePath ? { ...p, position: { x: nx, y: ny } } : p,
              ),
            }
          : s,
      );
    },
    [camera, clientToWorld],
  );

  const flashSaved = useCallback(() => {
    setSaveState('saved');
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaveState('idle'), 1500);
  }, []);

  // ---- Persistence: run a batch of ops through the EXISTING applySceneOps
  // helper (preserving its save/reload write-serialization), driving the same
  // save-state badge the drag-on-drop path uses. A no-op batch (e.g. a prop
  // with no json ref, or an edit that only touched non-persistable fields)
  // still flashes "saved" so the UI stays honest. ----
  const persistOps = useCallback(
    (ops: EditOp[]) => {
      if (!relPath) return;
      if (ops.length === 0) {
        flashSaved();
        return;
      }
      setSaveState('saving');
      setError(null);
      applySceneOps({
        projectPath,
        relPath,
        // applySceneOps types ops as the narrow lib SceneOp (= MovePropOp); the
        // daemon route accepts add/remove-prop too (see EditOp note above).
        ops: ops as unknown as Parameters<typeof applySceneOps>[0]['ops'],
      })
        .then(() => flashSaved())
        .catch((err) => {
          setSaveState('error');
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [projectPath, relPath, flashSaved],
  );

  // ---- The single funnel for every mutating action (add/duplicate/delete/
  // property-edit, and the drag-on-drop commit). Snapshots the current props
  // for undo, swaps in the next props, then persists only the diff. Reads
  // `scene` from closure (not a setScene updater) so the undo-push + save side
  // effects run exactly once, including under React StrictMode. ----
  const commitProps = useCallback(
    (nextProps: SceneProp[], nextSelected?: string | null) => {
      if (!scene) return;
      const prevProps = scene.props;
      undoStackRef.current.push(prevProps);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
      redoStackRef.current = [];
      syncHistoryFlags();
      setScene({ ...scene, props: nextProps });
      if (nextSelected !== undefined) setSelected(nextSelected);
      persistOps(diffPropsToOps(prevProps, nextProps));
    },
    [scene, persistOps, syncHistoryFlags],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragRef.current;
      dragRef.current = null;
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (!ds || ds.kind !== 'prop' || !scene || !relPath) return;

      const moved = scene.props.find((p) => p.nodePath === ds.nodePath);
      if (!moved) return;
      if (moved.position.x === ds.startPos.x && moved.position.y === ds.startPos.y) return;

      // Save: emit a move-prop op. Web props carry a json `ref`; the daemon
      // patches that JSON entry. Props without a ref can't be persisted in
      // this subset (Godot .tscn write-back is out of scope).
      if (!moved.ref) {
        setError('This object has no JSON ref — saving its position needs the .tscn writer (not ported).');
        return;
      }
      // Record the pre-drag props for undo (the moved position is already
      // mirrored into `scene`), then persist just the move.
      if (snapshot) {
        undoStackRef.current.push(snapshot);
        if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
        redoStackRef.current = [];
        syncHistoryFlags();
      }
      persistOps([{ kind: 'move-prop', nodePath: moved.nodePath, position: moved.position, ref: moved.ref }]);
    },
    [scene, relPath, persistOps, syncHistoryFlags],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const cont = containerRef.current;
      if (!cont) return;
      const r = cont.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setCamera((c) => {
        const next = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE);
        // Keep the world point under the cursor stationary.
        const worldX = sx / c.scale + c.panX;
        const worldY = sy / c.scale + c.panY;
        return { scale: next, panX: worldX - sx / next, panY: worldY - sy / next };
      });
    },
    [],
  );

  const zoomBy = useCallback((factor: number) => {
    const cont = containerRef.current;
    setCamera((c) => {
      const next = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE);
      if (!cont) return { ...c, scale: next };
      const r = cont.getBoundingClientRect();
      const sx = r.width / 2;
      const sy = r.height / 2;
      const worldX = sx / c.scale + c.panX;
      const worldY = sy / c.scale + c.panY;
      return { scale: next, panX: worldX - sx / next, panY: worldY - sy / next };
    });
  }, []);

  const currentLevelName = useMemo(
    () => levels.find((l) => l.relPath === relPath)?.name ?? relPath ?? '—',
    [levels, relPath],
  );

  // The currently selected prop (for the properties panel + enabling the
  // duplicate/delete buttons).
  const selectedProp = useMemo(
    () => scene?.props.find((p) => p.nodePath === selected) ?? null,
    [scene, selected],
  );

  /** World-space center of the current viewport (where new objects land). */
  const viewCenterWorld = useCallback((): Vec2 => {
    const cont = containerRef.current;
    if (!cont) return { x: 0, y: 0 };
    const r = cont.getBoundingClientRect();
    return {
      x: Math.round(r.width / 2 / camera.scale + camera.panX),
      y: Math.round(r.height / 2 / camera.scale + camera.panY),
    };
  }, [camera]);

  /** Allocate a section-unique JSON id from a stem (e.g. "object" → object_a1b2c3). */
  const uniquePropId = useCallback(
    (stem: string): string => {
      const used = new Set(scene?.props.map((p) => refId(p)) ?? []);
      const clean = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'object';
      let id = '';
      do {
        id = `${clean}_${Math.random().toString(36).slice(2, 8)}`;
      } while (used.has(id));
      return id;
    },
    [scene],
  );

  // ---- Add a new object at the view center. JSON-backed (section 'props')
  // with a sensible default size so it's draggable/selectable immediately.
  //
  // The new entry carries a placeholder `image` rather than an empty string:
  // the web-level loader skips props[] entries with no image (`if (!image)
  // continue`), so a blank-image add would persist but VANISH on the next
  // reload. A non-empty path round-trips; the placeholder file is allowed to
  // be missing — the studio draws the prop as an outlined rect (texture not in
  // the bank) and the runtimes substitute a generated fallback sprite, so no
  // broken image appears in-game. Re-texture via the asset workflow later. ----
  const addObject = useCallback(() => {
    if (!scene || !relPath) return;
    const center = viewCenterWorld();
    const id = uniquePropId('object');
    const w = DEFAULT_PROP_SIZE;
    const h = DEFAULT_PROP_SIZE;
    const ref: ColliderRef = { backend: 'json', relPath, section: 'props', id };
    const newProp: SceneProp = {
      nodePath: `props/${id}`,
      name: id,
      // Web prop convention: (x, y) is the feet/anchor; visual center sits at
      // anchor + spriteOffset. Place the anchor so the box centers on-screen.
      position: { x: center.x, y: center.y + h / 2 },
      spriteOffset: { x: 0, y: -h / 2 },
      scale: { x: 1, y: 1 },
      texture: PLACEHOLDER_TEXTURE,
      metadata: { sortY: String(center.y + h / 2) },
      displaySize: { x: w, y: h },
      ref,
    };
    commitProps([...scene.props, newProp], newProp.nodePath);
  }, [scene, relPath, viewCenterWorld, uniquePropId, commitProps]);

  // ---- Duplicate the selected prop, offset slightly so it's visible. ----
  const duplicateSelected = useCallback(() => {
    if (!scene || !selectedProp) return;
    if (!isEditableProp(selectedProp)) {
      setError(
        'Only props can be duplicated here — gameplay objects (platforms, hazards) and .tscn nodes need their own writer (not ported).',
      );
      return;
    }
    const id = uniquePropId(selectedProp.name || 'object');
    const off = 24;
    const clone: SceneProp = {
      ...selectedProp,
      nodePath: `${selectedProp.ref.section}/${id}`,
      name: id,
      position: { x: selectedProp.position.x + off, y: selectedProp.position.y + off },
      metadata: { ...selectedProp.metadata },
      ref: { ...selectedProp.ref, id },
    };
    commitProps([...scene.props, clone], clone.nodePath);
  }, [scene, selectedProp, uniquePropId, commitProps]);

  // ---- Delete the selected prop. ----
  const deleteSelected = useCallback(() => {
    if (!scene || !selectedProp) return;
    if (!isEditableProp(selectedProp)) {
      setError(
        'Only props can be deleted here — gameplay objects (platforms, hazards) and .tscn nodes need their own writer (not ported).',
      );
      return;
    }
    commitProps(
      scene.props.filter((p) => p.nodePath !== selectedProp.nodePath),
      null,
    );
  }, [scene, selectedProp, commitProps]);

  // ---- Edit a scalar field (x / y) of the selected prop from the panel.
  // Persists via the same move-prop path as drag-on-drop, so it works for any
  // json-backed prop (props + gameplay arrays). Non-json props can't be saved
  // (matches the drag guard), so surface that instead of a misleading flash. ----
  const updateSelectedPosition = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!scene || !selectedProp || !Number.isFinite(value)) return;
      if (!isJsonProp(selectedProp)) {
        setError('This object has no JSON ref — editing its position needs the .tscn writer (not ported).');
        return;
      }
      const next = scene.props.map((p) =>
        p.nodePath === selectedProp.nodePath
          ? { ...p, position: { ...p.position, [axis]: value } }
          : p,
      );
      commitProps(next);
    },
    [scene, selectedProp, commitProps],
  );

  // ---- Undo / redo: swap the live props for a stored snapshot, mirroring the
  // change back to disk (diff → ops) without recording it as new history.
  // Reads `scene` from closure so the snapshot push + save run once. ----
  const undo = useCallback(() => {
    if (!scene) return;
    const prev = undoStackRef.current.pop();
    if (prev === undefined) return;
    redoStackRef.current.push(scene.props);
    syncHistoryFlags();
    setScene({ ...scene, props: prev });
    // Drop selection if it pointed at a prop that no longer exists.
    setSelected((sel) => (prev.some((p) => p.nodePath === sel) ? sel : null));
    persistOps(diffPropsToOps(scene.props, prev));
  }, [scene, persistOps, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (!scene) return;
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    undoStackRef.current.push(scene.props);
    syncHistoryFlags();
    setScene({ ...scene, props: next });
    setSelected((sel) => (next.some((p) => p.nodePath === sel) ? sel : null));
    persistOps(diffPropsToOps(scene.props, next));
  }, [scene, persistOps, syncHistoryFlags]);

  // ---- Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo. Ignore while typing
  // in the properties-panel inputs so editing a field doesn't trigger undo. ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ---- Empty state ----
  if (!loading && levels.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <div className="mb-1 grid size-9 place-items-center rounded-md bg-muted">
              <Layers className="size-5 text-muted-foreground" />
            </div>
            <CardTitle>{t('scene.empty.title')}</CardTitle>
            <CardDescription>
              {error
                ? t('scene.readFailed', { error })
                : t('scene.empty.body')}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 bg-muted/30 px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Layers className="size-3.5" />
              <span className="max-w-[180px] truncate">{currentLevelName}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>{t('scene.levels')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {levels.map((l) => (
              <DropdownMenuItem
                key={l.relPath}
                onSelect={() => setRelPath(l.relPath)}
                className={cn(l.relPath === relPath && 'bg-accent')}
              >
                <span className="truncate">{l.relPath.replace(/^data\//, '')}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="icon" className="size-8" onClick={() => zoomBy(1 / 1.2)} title={t('scene.zoomOut')}>
          <Minus className="size-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(camera.scale * 100)}%
        </span>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => zoomBy(1.2)} title={t('scene.zoomIn')}>
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={fitToView} title={t('scene.fit')}>
          <Scan className="size-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* Object tools */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={addObject}
          disabled={!scene}
          title={t('scene.add')}
        >
          <PlusSquare className="size-4" />
          <span className="hidden sm:inline">{t('scene.add')}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={duplicateSelected}
          disabled={!selectedProp}
          title={t('scene.duplicate')}
        >
          <Copy className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={deleteSelected}
          disabled={!selectedProp}
          title={t('scene.delete')}
        >
          <Trash2 className="size-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* History */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={undo}
          disabled={!canUndo}
          title={t('scene.undo')}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={redo}
          disabled={!canRedo}
          title={t('scene.redo')}
        >
          <Redo2 className="size-4" />
        </Button>

        <div className="flex-1" />

        {scene ? (
          <span className="text-xs text-muted-foreground">
            {scene.props.length} {scene.props.length === 1 ? t('scene.object') : t('scene.objects')}
          </span>
        ) : null}
        {saveState === 'saving' ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" /> {t('scene.saving')}
          </Badge>
        ) : saveState === 'saved' ? (
          <Badge variant="secondary" className="text-emerald-500">
            {t('scene.saved')}
          </Badge>
        ) : saveState === 'error' ? (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="size-3" /> {t('scene.saveFailed')}
          </Badge>
        ) : null}
      </div>

      {/* Canvas surface */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 touch-none overflow-hidden bg-[#0b0b0d]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          style={{ cursor: dragRef.current?.kind === 'prop' ? 'grabbing' : 'default' }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>

        {loading ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-2 rounded-md bg-card/90 px-3 py-2 text-sm text-muted-foreground shadow-md">
              <Loader2 className="size-4 animate-spin" /> {t('scene.loading')}
            </div>
          </div>
        ) : null}

        {error && !loading ? (
          <div className="absolute bottom-3 left-3 right-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}

        {scene && scene.notes.length > 0 && !loading ? (
          <div className="pointer-events-none absolute bottom-3 right-3 max-w-xs rounded-md bg-card/90 px-3 py-2 text-[11px] leading-snug text-muted-foreground shadow-md">
            {scene.notes[0]}
          </div>
        ) : null}

        {/* Hint */}
        {scene && !loading ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
            {t('scene.hint')}
          </div>
        ) : null}

        {/* Properties panel — soft-elevated, borderless tone surface. */}
        {scene && !loading ? (
          <div className="absolute right-3 top-3 w-60 rounded-lg bg-card/95 p-3 text-foreground shadow-lg ring-1 ring-black/5 backdrop-blur-sm">
            <PropertiesPanel
              prop={selectedProp}
              onChangePosition={updateSelectedPosition}
              t={t}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Right-side properties panel: edits the selected prop's scalar fields. x / y
 *  are live number inputs (commit on change → updates canvas + saves); name and
 *  id are read-only context. Empty selection shows the noSelection hint. */
function PropertiesPanel({
  prop,
  onChangePosition,
  t,
}: {
  prop: SceneProp | null;
  onChangePosition: (axis: 'x' | 'y', value: number) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('scene.properties')}
      </div>

      {!prop ? (
        <p className="text-[13px] leading-snug text-muted-foreground">{t('scene.noSelection')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Identity (read-only) */}
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-2.5 py-2">
            <span className="truncate text-[13px] font-medium" title={prop.name}>
              {prop.name}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground" title={prop.nodePath}>
              {prop.nodePath}
            </span>
          </div>

          {/* Position */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">X</span>
              <Input
                type="number"
                value={Math.round(prop.position.x)}
                onChange={(e) => onChangePosition('x', Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Y</span>
              <Input
                type="number"
                value={Math.round(prop.position.y)}
                onChange={(e) => onChangePosition('y', Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stroke a collider/zone shape in world space (used for read-only context).
 *  Rects use top-left = center − size/2; circles use center + radius; polygons
 *  connect their points; points draw a small crosshair. */
function drawShape(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  shape:
    | { kind: 'rect'; w: number; h: number }
    | { kind: 'circle'; r: number }
    | { kind: 'polygon'; points: Vec2[] }
    | { kind: 'point' },
  scale: number,
): void {
  if (shape.kind === 'rect') {
    ctx.strokeRect(pos.x - shape.w / 2, pos.y - shape.h / 2, shape.w, shape.h);
  } else if (shape.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, shape.r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === 'polygon') {
    if (shape.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
    ctx.closePath();
    ctx.stroke();
  } else {
    const r = 6 / scale;
    ctx.beginPath();
    ctx.moveTo(pos.x - r, pos.y);
    ctx.lineTo(pos.x + r, pos.y);
    ctx.moveTo(pos.x, pos.y - r);
    ctx.lineTo(pos.x, pos.y + r);
    ctx.stroke();
  }
}

export default SceneEditor;
