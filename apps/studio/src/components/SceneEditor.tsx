// 2D scene editor — a focused port of apps/web/src/components/SceneEditor.tsx
// (~5200 lines) into the new shadcn studio. Scope kept deliberately tight so it
// compiles under strict tsc:
//
//   PORTED:  load a web level (data/<level>.json → SceneModel), render
//            background / parallax layers / props on a <canvas>, camera
//            pan + wheel-zoom-toward-cursor, drag-move a prop with
//            save-on-drop (move-prop op → applySceneOps).
//   READ-ONLY EXTRAS: colliders + zones drawn as dim outlines for context.
//   TRIMMED (vs the original — see TODOs): prop scaling/resize handles,
//            collider/zone/path editing, add/remove tools, multi-select,
//            undo/redo, comments, minimap, properties panel, live
//            scene-context push. Re-introduce by widening lib/scene.ts's
//            SceneOp union and adding the matching tools here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Minus, Plus, Scan, Loader2, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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
  const savedTimer = useRef<number | undefined>(undefined);

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

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragRef.current;
      dragRef.current = null;
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
      setSaveState('saving');
      setError(null);
      applySceneOps({
        projectPath,
        relPath,
        ops: [{ kind: 'move-prop', nodePath: moved.nodePath, position: moved.position, ref: moved.ref }],
      })
        .then(() => flashSaved())
        .catch((err) => {
          setSaveState('error');
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [scene, relPath, projectPath, flashSaved],
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
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
            <div className="flex items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-sm text-muted-foreground">
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
          <div className="pointer-events-none absolute bottom-3 right-3 max-w-xs rounded-md border bg-card/90 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {scene.notes[0]}
          </div>
        ) : null}

        {/* Hint */}
        {scene && !loading ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
            {t('scene.hint')}
          </div>
        ) : null}
      </div>
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
