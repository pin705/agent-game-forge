"use client";

// Sprite slicer — a focused, self-contained port of apps/studio's
// SpriteSlicerModal. Loads a sprite sheet (via the byte-accurate draft-preview
// route), overlays a cols×rows grid with padding/offset, previews the resulting
// animation at FPS, and writes the layout as a `<image>.ogf-slice.json` sidecar
// the engine reads — the same sidecar shape + path the studio produced. The
// studio's daemon-only extras (regen staging, animation packs, "ask the agent")
// are not part of this self-contained flow and are omitted.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Scissors } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  assetThumbUrl,
  sliceSidecarPath,
  type SliceMetadata,
} from "@/lib/editor/assets";

const ANCHORS: SliceMetadata["anchor"][] = ["top", "center", "bottom", "feet", "left", "right"];

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{value}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={(v) => onChange(v[0] ?? value)} />
    </div>
  );
}

export function SpriteSlicerModal({
  projectId,
  imageRelPath,
  initial,
  onClose,
  onSaved,
}: {
  projectId: string;
  imageRelPath: string;
  initial?: Partial<SliceMetadata>;
  onClose: () => void;
  onSaved?: (m: SliceMetadata) => void;
}) {
  const t = useT();
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [imgError, setImgError] = useState(false);

  const [cols, setCols] = useState(initial?.cols ?? 4);
  const [rows, setRows] = useState(initial?.rows ?? 4);
  const [pad, setPad] = useState(initial?.padding ?? 0);
  const [offX, setOffX] = useState(initial?.offsetX ?? 0);
  const [offY, setOffY] = useState(initial?.offsetY ?? 0);
  const [anchor, setAnchor] = useState<SliceMetadata["anchor"]>(initial?.anchor ?? "center");
  const [fps, setFps] = useState(initial?.fps ?? 8);
  const [saving, setSaving] = useState(false);

  const src = assetThumbUrl(projectId, imageRelPath);
  const fW = naturalW > 0 ? naturalW / cols : 0;
  const fH = naturalH > 0 ? naturalH / rows : 0;
  const totalFrames = cols * rows;

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (totalFrames === 0) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % totalFrames), 1000 / fps);
    return () => clearInterval(id);
  }, [fps, totalFrames]);
  useEffect(() => setFrame(0), [cols, rows]);

  const canvasMaxW = 560;
  const canvasMaxH = 420;
  const displayScale = naturalW > 0 ? Math.min(canvasMaxW / naturalW, canvasMaxH / naturalH, 4) : 1;
  const displayW = naturalW * displayScale;
  const displayH = naturalH * displayScale;
  const frameCol = frame % cols;
  const frameRow = Math.floor(frame / cols);

  const metadata = useMemo<SliceMetadata>(
    () => ({
      cols,
      rows,
      padding: pad,
      offsetX: offX,
      offsetY: offY,
      anchor,
      fps,
      source: imageRelPath,
      frameW: Math.round(fW),
      frameH: Math.round(fH),
    }),
    [cols, rows, pad, offX, offY, anchor, fps, imageRelPath, fW, fH],
  );

  const sidecar = sliceSidecarPath(imageRelPath);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sidecar, content: JSON.stringify(metadata, null, 2) + "\n" }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `${r.status}`);
      }
      toast.success(t("slicer.saved", { file: sidecar.split("/").pop() ?? sidecar }));
      onSaved?.(metadata);
    } catch (err) {
      toast.error(t("slicer.saveFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-4" />
            {t("slicer.title")}
          </DialogTitle>
          <DialogDescription className="font-mono">
            {imageRelPath}
            {naturalW > 0 && ` · ${naturalW}×${naturalH}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="flex min-h-[280px] items-center justify-center overflow-auto rounded-lg border bg-muted/20 p-3">
            {imgError ? (
              <div className="text-sm text-destructive">{t("slicer.notImage")}</div>
            ) : (
              <div className="relative" style={{ width: displayW || naturalW || 1, height: displayH || naturalH || 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={imageRelPath}
                  onLoad={(e) => {
                    setNaturalW(e.currentTarget.naturalWidth);
                    setNaturalH(e.currentTarget.naturalHeight);
                  }}
                  onError={() => setImgError(true)}
                  style={{
                    display: "block",
                    width: displayW || "auto",
                    height: displayH || "auto",
                    imageRendering: "pixelated",
                  }}
                />
                {fW > 0 && (
                  <div className="pointer-events-none absolute inset-0">
                    {Array.from({ length: cols - 1 }).map((_, c) => (
                      <div
                        key={`v${c}`}
                        className="absolute bottom-0 top-0 w-px bg-primary/50"
                        style={{ left: ((c + 1) * fW + offX) * displayScale }}
                      />
                    ))}
                    {Array.from({ length: rows - 1 }).map((_, r) => (
                      <div
                        key={`h${r}`}
                        className="absolute left-0 right-0 h-px bg-primary/50"
                        style={{ top: ((r + 1) * fH + offY) * displayScale }}
                      />
                    ))}
                    <div
                      className="absolute border-2 border-primary"
                      style={{
                        left: (frameCol * fW + offX + pad) * displayScale,
                        top: (frameRow * fH + offY + pad) * displayScale,
                        width: (fW - pad * 2) * displayScale,
                        height: (fH - pad * 2) * displayScale,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <Field label={t("slicer.columns")} value={cols} min={1} max={16} onChange={setCols} />
              <Field label={t("slicer.rows")} value={rows} min={1} max={16} onChange={setRows} />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border px-2 py-1.5">
                  <div className="text-muted-foreground">{t("slicer.frameW")}</div>
                  <div className="font-mono font-medium">{Math.round(fW)}px</div>
                </div>
                <div className="rounded-md border px-2 py-1.5">
                  <div className="text-muted-foreground">{t("slicer.frameH")}</div>
                  <div className="font-mono font-medium">{Math.round(fH)}px</div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Field label={t("slicer.padding")} value={pad} min={0} max={16} onChange={setPad} />
              <Field label={t("slicer.offsetX")} value={offX} min={-32} max={32} onChange={setOffX} />
              <Field label={t("slicer.offsetY")} value={offY} min={-32} max={32} onChange={setOffY} />
              <Field label={t("slicer.fps")} value={fps} min={1} max={24} onChange={setFps} />
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">{t("slicer.anchor")}</div>
              <div className="flex flex-wrap gap-1">
                {ANCHORS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAnchor(a)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs capitalize transition-colors",
                      a === anchor
                        ? "border-input bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("slicer.sidecarNote", { file: sidecar.split("/").pop() ?? sidecar })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving || fW === 0}>
              <Scissors className="size-4" />
              {saving ? t("common.saving") : t("slicer.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
