"use client";

// Visual scene editor — the hosted-model port of apps/studio's SceneEditor +
// EntityInspector. Loads a data/<level>.json web level (parsed client-side; see
// lib/editor/scene.ts), renders the background + props on a <canvas>, and lets
// you select / add / duplicate / delete / drag-move objects with a properties
// panel and snapshot undo/redo — faithfully keeping the studio's interaction
// model + keyboard shortcuts (Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Shift+drag
// disables pixel-snap, wheel zooms toward the cursor, drag empty space pans).
//
// ADAPTED for the cloud model: the studio loaded scenes through a daemon parser
// that returned a rich SceneModel + base64 images and saved via /api/scenes
// ops; here there's only the byte-accurate file API + draft-preview route, so we
// edit the self-contained `props[]` array of the level JSON directly (the layer
// the generated vanilla-Canvas games use) and PUT the whole file back, every
// other field preserved. Collider/zone/path editing + Godot .tscn write-back
// were daemon-coupled in the studio and stay out of scope here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Layers,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  Redo2,
  Scan,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";
import {
  assetPreviewUrl,
  listLevelFiles,
  parseScene,
  serializeScene,
  uniquePropId,
  type LevelFile,
  type SceneModel,
  type SceneProp,
  type Vec2,
} from "@/lib/editor/scene";

type Camera = { scale: number; panX: number; panY: number };
type SaveState = "idle" | "saving" | "saved" | "error";

type DragState =
  | { kind: "pan"; startClient: Vec2; startPan: Vec2 }
  | { kind: "prop"; id: string; startWorld: Vec2; startPos: Vec2 };

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const MAX_UNDO = 100;
const DEFAULT_PROP_SIZE = 64;
/** Placeholder image for a fresh object: a non-empty path round-trips (the
 *  loader keeps the entry) while staying graceful if the file is absent — the
 *  canvas just draws an outlined rect. Re-texture via the Assets tab later. */
const PLACEHOLDER_TEXTURE = "assets/placeholder.png";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** World-space AABB for a prop. Web props are TOP-LEFT {x,y} + w×h. */
function propBounds(p: SceneProp): { x: number; y: number; w: number; h: number } {
  return { x: p.x, y: p.y, w: p.w, h: p.h };
}

export function ScenePanel({
  projectId,
  files,
  onSaved,
}: {
  projectId: string;
  files: string[];
  onSaved?: () => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const levels = useMemo<LevelFile[]>(() => listLevelFiles(files), [files]);
  const [relPath, setRelPath] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneModel | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [camera, setCamera] = useState<Camera>({ scale: 1, panX: 0, panY: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const dragRef = useRef<DragState | null>(null);
  const dragSnapshotRef = useRef<SceneProp[] | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  const undoStackRef = useRef<SceneProp[][]>([]);
  const redoStackRef = useRef<SceneProp[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  // Default to the first level once the list resolves; keep selection across
  // agent runs if it still exists.
  useEffect(() => {
    setRelPath((cur) => (cur && levels.some((l) => l.relPath === cur) ? cur : (levels[0]?.relPath ?? null)));
  }, [levels]);

  // ---- Load images referenced by the scene from the draft-preview route. ----
  const loadImages = useCallback(
    (model: SceneModel): Promise<Map<string, HTMLImageElement>> => {
      const paths = new Set<string>();
      if (model.background.relPath) paths.add(model.background.relPath);
      for (const p of model.props) if (p.image) paths.add(p.image);
      return Promise.all(
        Array.from(paths).map(
          (rel) =>
            new Promise<[string, HTMLImageElement] | null>((resolve) => {
              const img = new Image();
              img.onload = () => resolve([rel, img]);
              img.onerror = () => resolve(null);
              img.src = assetPreviewUrl(projectId, rel);
            }),
        ),
      ).then((pairs) => {
        const map = new Map<string, HTMLImageElement>();
        for (const p of pairs) if (p) map.set(p[0], p[1]);
        return map;
      });
    },
    [projectId],
  );

  // ---- Scene load (on level change / file refresh). ----
  useEffect(() => {
    if (!relPath) {
      setScene(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setScene(null);
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent(relPath)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status}`);
        }
        const { content } = (await res.json()) as { content: string };
        const model = parseScene(relPath, content);
        const bank = await loadImages(model);
        if (!alive) return;
        setScene(model);
        setImages(bank);
        setSelected(null);
        undoStackRef.current = [];
        redoStackRef.current = [];
        syncHistoryFlags();
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, relPath, loadImages, syncHistoryFlags]);

  const fitToView = useCallback(() => {
    const cont = containerRef.current;
    if (!cont || !scene) return;
    const rect = cont.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let w = scene.background.width;
    let h = scene.background.height;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

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

  // ---- Canvas draw ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const cont = containerRef.current;
    if (!canvas || !cont) return;
    const ctx = canvas.getContext("2d");
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
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!scene) return;

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.panX, -camera.panY);

    const mapW = scene.background.width;
    const mapH = scene.background.height;
    if (mapW && mapH) {
      ctx.fillStyle = "#15161a";
      ctx.fillRect(0, 0, mapW, mapH);
    }

    if (scene.background.relPath) {
      const img = images.get(scene.background.relPath);
      if (img) ctx.drawImage(img, 0, 0, mapW || img.width, mapH || img.height);
    }

    for (const p of scene.props) {
      const b = propBounds(p);
      const img = p.image ? images.get(p.image) : undefined;
      if (img && b.w > 0 && b.h > 0) {
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
        ctx.fillStyle = "rgba(220, 90, 60, 0.12)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "rgba(220, 90, 60, 0.7)";
        ctx.lineWidth = 1 / camera.scale;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        if (camera.scale > 0.25) {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.font = `${Math.max(9, 11 / camera.scale)}px ui-sans-serif, system-ui`;
          ctx.fillText(p.id, b.x + 3 / camera.scale, b.y + 13 / camera.scale);
        }
      }
      if (p.id === selected) {
        ctx.strokeStyle = "#e2603c";
        ctx.lineWidth = 2 / camera.scale;
        ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
  }, [scene, images, camera, selected]);

  // Redraw on container resize.
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const ro = new ResizeObserver(() => setCamera((c) => ({ ...c })));
    ro.observe(cont);
    return () => ro.disconnect();
  }, []);

  const findPropAt = useCallback(
    (world: Vec2): SceneProp | null => {
      if (!scene) return null;
      for (let i = scene.props.length - 1; i >= 0; i--) {
        const p = scene.props[i];
        const b = propBounds(p);
        if (b.w <= 0 || b.h <= 0) continue;
        if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) return p;
      }
      return null;
    },
    [scene],
  );

  const flashSaved = useCallback(() => {
    setSaveState("saved");
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1500);
  }, []);

  // ---- Persist: serialize the props back into the level JSON + PUT it. ----
  const persistProps = useCallback(
    (props: SceneProp[]) => {
      if (!scene || !relPath) return;
      setSaveState("saving");
      setError(null);
      const text = serializeScene(scene, props);
      fetch(`/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relPath, content: text }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.error ?? `${r.status}`);
          }
          flashSaved();
          onSaved?.();
        })
        .catch((err) => {
          setSaveState("error");
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [scene, relPath, projectId, flashSaved, onSaved],
  );

  // Single funnel for every mutating action: snapshot for undo, swap props, save.
  const commitProps = useCallback(
    (nextProps: SceneProp[], nextSelected?: string | null) => {
      if (!scene) return;
      undoStackRef.current.push(scene.props);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
      redoStackRef.current = [];
      syncHistoryFlags();
      setScene({ ...scene, props: nextProps });
      if (nextSelected !== undefined) setSelected(nextSelected);
      persistProps(nextProps);
    },
    [scene, persistProps, syncHistoryFlags],
  );

  // ---- Pointer handlers ----
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!scene) return;
      const world = clientToWorld(e.clientX, e.clientY);
      const hit = e.button === 0 ? findPropAt(world) : null;
      if (hit) {
        setSelected(hit.id);
        dragRef.current = { kind: "prop", id: hit.id, startWorld: world, startPos: { x: hit.x, y: hit.y } };
        dragSnapshotRef.current = scene.props;
      } else {
        if (e.button === 0) setSelected(null);
        dragRef.current = {
          kind: "pan",
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
      if (ds.kind === "pan") {
        const dx = (e.clientX - ds.startClient.x) / camera.scale;
        const dy = (e.clientY - ds.startClient.y) / camera.scale;
        setCamera((c) => ({ ...c, panX: ds.startPan.x - dx, panY: ds.startPan.y - dy }));
        return;
      }
      const world = clientToWorld(e.clientX, e.clientY);
      let nx = ds.startPos.x + (world.x - ds.startWorld.x);
      let ny = ds.startPos.y + (world.y - ds.startWorld.y);
      if (!e.shiftKey) {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      setScene((s) =>
        s ? { ...s, props: s.props.map((p) => (p.id === ds.id ? { ...p, x: nx, y: ny } : p)) } : s,
      );
    },
    [camera, clientToWorld],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragRef.current;
      dragRef.current = null;
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (!ds || ds.kind !== "prop" || !scene) return;
      const moved = scene.props.find((p) => p.id === ds.id);
      if (!moved) return;
      if (moved.x === ds.startPos.x && moved.y === ds.startPos.y) return;
      // The moved position is already mirrored into `scene`; record the pre-drag
      // snapshot for undo, then persist.
      if (snapshot) {
        undoStackRef.current.push(snapshot);
        if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
        redoStackRef.current = [];
        syncHistoryFlags();
      }
      persistProps(scene.props);
    },
    [scene, persistProps, syncHistoryFlags],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    const cont = containerRef.current;
    if (!cont) return;
    const r = cont.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setCamera((c) => {
      const next = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = sx / c.scale + c.panX;
      const worldY = sy / c.scale + c.panY;
      return { scale: next, panX: worldX - sx / next, panY: worldY - sy / next };
    });
  }, []);

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
    () => levels.find((l) => l.relPath === relPath)?.name ?? relPath ?? "—",
    [levels, relPath],
  );
  const selectedProp = useMemo(
    () => scene?.props.find((p) => p.id === selected) ?? null,
    [scene, selected],
  );

  const viewCenterWorld = useCallback((): Vec2 => {
    const cont = containerRef.current;
    if (!cont) return { x: 0, y: 0 };
    const r = cont.getBoundingClientRect();
    return {
      x: Math.round(r.width / 2 / camera.scale + camera.panX),
      y: Math.round(r.height / 2 / camera.scale + camera.panY),
    };
  }, [camera]);

  const addObject = useCallback(() => {
    if (!scene) return;
    const center = viewCenterWorld();
    const id = uniquePropId(scene.props, "object");
    const w = DEFAULT_PROP_SIZE;
    const h = DEFAULT_PROP_SIZE;
    const newProp: SceneProp = {
      id,
      image: PLACEHOLDER_TEXTURE,
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
    };
    commitProps([...scene.props, newProp], newProp.id);
  }, [scene, viewCenterWorld, commitProps]);

  const duplicateSelected = useCallback(() => {
    if (!scene || !selectedProp) return;
    const id = uniquePropId(scene.props, selectedProp.id);
    const off = 24;
    const clone: SceneProp = { ...selectedProp, id, x: selectedProp.x + off, y: selectedProp.y + off };
    commitProps([...scene.props, clone], clone.id);
  }, [scene, selectedProp, commitProps]);

  const deleteSelected = useCallback(() => {
    if (!scene || !selectedProp) return;
    commitProps(scene.props.filter((p) => p.id !== selectedProp.id), null);
  }, [scene, selectedProp, commitProps]);

  const updateSelectedField = useCallback(
    (field: "x" | "y" | "w" | "h", value: number) => {
      if (!scene || !selectedProp || !Number.isFinite(value)) return;
      const next = scene.props.map((p) => (p.id === selectedProp.id ? { ...p, [field]: value } : p));
      commitProps(next);
    },
    [scene, selectedProp, commitProps],
  );

  const undo = useCallback(() => {
    if (!scene) return;
    const prev = undoStackRef.current.pop();
    if (prev === undefined) return;
    redoStackRef.current.push(scene.props);
    syncHistoryFlags();
    setScene({ ...scene, props: prev });
    setSelected((sel) => (prev.some((p) => p.id === sel) ? sel : null));
    persistProps(prev);
  }, [scene, persistProps, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (!scene) return;
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    undoStackRef.current.push(scene.props);
    syncHistoryFlags();
    setScene({ ...scene, props: next });
    setSelected((sel) => (next.some((p) => p.id === sel) ? sel : null));
    persistProps(next);
  }, [scene, persistProps, syncHistoryFlags]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  if (!loading && levels.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <div className="mb-1 grid size-9 place-items-center rounded-md bg-muted">
              <Layers className="size-5 text-muted-foreground" />
            </div>
            <CardTitle>{t("scene.empty.title")}</CardTitle>
            <CardDescription>
              {error ? t("scene.readFailed", { error }) : t("scene.empty.body")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
            <DropdownMenuLabel>{t("scene.levels")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {levels.map((l) => (
              <DropdownMenuItem
                key={l.relPath}
                onSelect={() => setRelPath(l.relPath)}
                className={cn(l.relPath === relPath && "bg-accent")}
              >
                <span className="truncate">{l.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="icon" className="size-8" onClick={() => zoomBy(1 / 1.2)} title={t("scene.zoomOut")}>
          <Minus className="size-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(camera.scale * 100)}%
        </span>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => zoomBy(1.2)} title={t("scene.zoomIn")}>
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={fitToView} title={t("scene.fit")}>
          <Scan className="size-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={addObject} disabled={!scene} title={t("scene.add")}>
          <PlusSquare className="size-4" />
          <span className="hidden sm:inline">{t("scene.add")}</span>
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={duplicateSelected} disabled={!selectedProp} title={t("scene.duplicate")}>
          <Copy className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={deleteSelected} disabled={!selectedProp} title={t("scene.delete")}>
          <Trash2 className="size-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="icon" className="size-8" onClick={undo} disabled={!canUndo} title={t("scene.undo")}>
          <Undo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={redo} disabled={!canRedo} title={t("scene.redo")}>
          <Redo2 className="size-4" />
        </Button>

        <div className="flex-1" />

        {scene ? (
          <span className="text-xs text-muted-foreground">
            {scene.props.length} {scene.props.length === 1 ? t("scene.object") : t("scene.objects")}
          </span>
        ) : null}
        {saveState === "saving" ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" /> {t("scene.saving")}
          </Badge>
        ) : saveState === "saved" ? (
          <Badge variant="secondary" className="text-emerald-500">
            {t("scene.saved")}
          </Badge>
        ) : saveState === "error" ? (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="size-3" /> {t("scene.saveFailed")}
          </Badge>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 touch-none overflow-hidden bg-[#0b0b0d]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          style={{ cursor: dragRef.current?.kind === "prop" ? "grabbing" : "default" }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>

        {loading ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-2 rounded-md bg-card/90 px-3 py-2 text-sm text-muted-foreground shadow-md">
              <Loader2 className="size-4 animate-spin" /> {t("scene.loading")}
            </div>
          </div>
        ) : null}

        {error && !loading ? (
          <div className="absolute bottom-3 left-3 right-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}

        {scene && scene.note && !loading ? (
          <div className="pointer-events-none absolute bottom-3 right-3 max-w-xs rounded-md bg-card/90 px-3 py-2 text-[11px] leading-snug text-muted-foreground shadow-md">
            {scene.note}
          </div>
        ) : null}

        {scene && !loading ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-card/70 px-2 py-1 text-[11px] text-muted-foreground">
            {t("scene.hint")}
          </div>
        ) : null}

        {scene && !loading ? (
          <div className="absolute right-3 top-3 w-60 rounded-lg bg-card/95 p-3 text-foreground shadow-lg ring-1 ring-black/5 backdrop-blur-sm">
            <PropertiesPanel prop={selectedProp} onChange={updateSelectedField} t={t} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** EntityInspector-style properties panel: edits the selected prop's scalar
 *  fields (x/y/w/h) live; id is read-only context. */
function PropertiesPanel({
  prop,
  onChange,
  t,
}: {
  prop: SceneProp | null;
  onChange: (field: "x" | "y" | "w" | "h", value: number) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("scene.properties")}
      </div>
      {!prop ? (
        <p className="text-[13px] leading-snug text-muted-foreground">{t("scene.noSelection")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-2.5 py-2">
            <span className="truncate font-mono text-[12px] font-medium" title={prop.id}>
              {prop.id}
            </span>
            {prop.image ? (
              <span className="truncate font-mono text-[11px] text-muted-foreground" title={prop.image}>
                {prop.image}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={prop.x} onChange={(v) => onChange("x", v)} />
            <NumField label="Y" value={prop.y} onChange={(v) => onChange("y", v)} />
            <NumField label="W" value={prop.w} onChange={(v) => onChange("w", v)} />
            <NumField label="H" value={prop.h} onChange={(v) => onChange("h", v)} />
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input type="number" value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
