import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Scissors } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  imageDataUrl,
  saveSliceMetadata,
  type SliceMetadata,
} from '@/lib/assets';
import { useT } from '@/lib/i18n';

export type { SliceMetadata };

interface SpriteSlicerModalProps {
  projectPath: string;
  imageRelPath: string;
  /** Optional preloaded metadata (read from the sidecar JSON before opening). */
  initial?: Partial<SliceMetadata>;
  onClose: () => void;
  onSaved?: (m: SliceMetadata) => void;
  /** Optional: "Save + ask the agent to apply this slicing" affordance. */
  onAskAgent?: (m: SliceMetadata) => void;
}

const ANCHORS: SliceMetadata['anchor'][] = [
  'top',
  'center',
  'bottom',
  'feet',
  'left',
  'right',
];

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
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
    </div>
  );
}

/**
 * Chroma-free grid slicer: load a sprite sheet, set columns/rows/padding/offset
 * and an anchor, preview the resulting animation, and save the layout as a
 * `<image>.ogf-slice.json` sidecar the engine reads.
 *
 * (Subset note: this mirrors apps/web's grid slicer — the visual frame
 * editor + sidecar metadata. The web version uses an <img> + overlay rather
 * than a literal <canvas>; we keep that proven approach. A chroma-key
 * background-removal pass is not part of the web flow either, so it is not
 * ported.)
 */
export function SpriteSlicerModal(props: SpriteSlicerModalProps) {
  const t = useT();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  const [cols, setCols] = useState(props.initial?.cols ?? 4);
  const [rows, setRows] = useState(props.initial?.rows ?? 4);
  const [pad, setPad] = useState(props.initial?.padding ?? 0);
  const [offX, setOffX] = useState(props.initial?.offsetX ?? 0);
  const [offY, setOffY] = useState(props.initial?.offsetY ?? 0);
  const [anchor, setAnchor] = useState<SliceMetadata['anchor']>(
    props.initial?.anchor ?? 'center',
  );
  const [fps, setFps] = useState(props.initial?.fps ?? 8);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load image as a data URL (works for staged + live files, avoids CORS).
  useEffect(() => {
    let cancelled = false;
    setImgError(null);
    setImgUrl(null);
    imageDataUrl(props.projectPath, props.imageRelPath)
      .then((url) => {
        if (cancelled) return;
        if (!url) setImgError(t('slicer.notImage'));
        else setImgUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setImgError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.imageRelPath, t]);

  const fW = naturalW > 0 ? naturalW / cols : 0;
  const fH = naturalH > 0 ? naturalH / rows : 0;
  const totalFrames = cols * rows;

  // Animation preview frame index.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (totalFrames === 0) return;
    const id = setInterval(
      () => setFrame((f) => (f + 1) % totalFrames),
      1000 / fps,
    );
    return () => clearInterval(id);
  }, [fps, totalFrames]);
  useEffect(() => setFrame(0), [cols, rows]);

  // Display scale: fit the preview area.
  const canvasMaxW = 560;
  const canvasMaxH = 420;
  const displayScale =
    naturalW > 0 ? Math.min(canvasMaxW / naturalW, canvasMaxH / naturalH, 4) : 1;
  const displayW = naturalW * displayScale;
  const displayH = naturalH * displayScale;

  const frameCol = frame % cols;
  const frameRow = Math.floor(frame / cols);

  // One-frame preview (CSS background crop).
  const previewSize = 88;
  const previewScale = previewSize / Math.max(fW, fH || 1);
  const previewBgW = naturalW * previewScale;
  const previewBgH = naturalH * previewScale;

  const metadata = useMemo<SliceMetadata>(
    () => ({
      cols,
      rows,
      padding: pad,
      offsetX: offX,
      offsetY: offY,
      anchor,
      fps,
      source: props.imageRelPath,
      frameW: Math.round(fW),
      frameH: Math.round(fH),
    }),
    [cols, rows, pad, offX, offY, anchor, fps, props.imageRelPath, fW, fH],
  );

  async function save(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      await saveSliceMetadata(props.projectPath, props.imageRelPath, metadata);
      setSavedAt(Date.now());
      props.onSaved?.(metadata);
      return true;
    } catch (err) {
      toast.error(
        t('slicer.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-4" />
            {t('slicer.title')}
          </DialogTitle>
          <DialogDescription className="font-mono">
            {props.imageRelPath}
            {naturalW > 0 && ` · ${naturalW}×${naturalH}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          {/* Preview area */}
          <div className="flex min-h-[280px] items-center justify-center overflow-auto rounded-lg border bg-muted/20 p-3">
            {imgError && (
              <div className="text-sm text-destructive">{imgError}</div>
            )}
            {!imgUrl && !imgError && (
              <div className="text-sm text-muted-foreground">{t('slicer.loadingImage')}</div>
            )}
            {imgUrl && (
              <div
                className="relative"
                style={{
                  width: displayW || naturalW || 1,
                  height: displayH || naturalH || 1,
                }}
              >
                <img
                  src={imgUrl}
                  alt={props.imageRelPath}
                  onLoad={(e) => {
                    setNaturalW(e.currentTarget.naturalWidth);
                    setNaturalH(e.currentTarget.naturalHeight);
                  }}
                  style={{
                    display: 'block',
                    width: displayW || 'auto',
                    height: displayH || 'auto',
                    imageRendering: 'pixelated',
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
                    {/* current frame highlight */}
                    <div
                      className="absolute border-2 border-primary shadow-[0_0_0_2px_oklch(0_0_0/0.5)]"
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

          {/* Controls */}
          <div className="space-y-4">
            <div className="space-y-3">
              <Field label={t('slicer.columns')} value={cols} min={1} max={16} onChange={setCols} />
              <Field label={t('slicer.rows')} value={rows} min={1} max={16} onChange={setRows} />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border px-2 py-1.5">
                  <div className="text-muted-foreground">{t('slicer.frameW')}</div>
                  <div className="font-mono font-medium">{Math.round(fW)}px</div>
                </div>
                <div className="rounded-md border px-2 py-1.5">
                  <div className="text-muted-foreground">{t('slicer.frameH')}</div>
                  <div className="font-mono font-medium">{Math.round(fH)}px</div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Field label={t('slicer.padding')} value={pad} min={0} max={16} onChange={setPad} />
              <Field label={t('slicer.offsetX')} value={offX} min={-32} max={32} onChange={setOffX} />
              <Field label={t('slicer.offsetY')} value={offY} min={-32} max={32} onChange={setOffY} />
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">{t('slicer.anchor')}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {ANCHORS.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={anchor === a ? 'default' : 'outline'}
                    className={cn('h-7 px-2 text-xs capitalize')}
                    onClick={() => setAnchor(a)}
                  >
                    {a}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">{t('slicer.preview')}</div>
              <div className="flex items-center gap-3">
                <div
                  className="relative shrink-0 overflow-hidden rounded-md border bg-[length:12px_12px]"
                  style={{
                    width: previewSize,
                    height: previewSize,
                    backgroundColor: 'var(--muted)',
                    backgroundImage:
                      'linear-gradient(45deg,oklch(0 0 0/0.06) 25%,transparent 25%),linear-gradient(-45deg,oklch(0 0 0/0.06) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,oklch(0 0 0/0.06) 75%),linear-gradient(-45deg,transparent 75%,oklch(0 0 0/0.06) 75%)',
                    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                  }}
                >
                  {imgUrl && fW > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        width: previewBgW,
                        height: previewBgH,
                        left: -((frameCol * fW + offX + pad) * previewScale),
                        top: -((frameRow * fH + offY + pad) * previewScale),
                        backgroundImage: `url(${imgUrl})`,
                        backgroundSize: `${previewBgW}px ${previewBgH}px`,
                        imageRendering: 'pixelated',
                      }}
                    />
                  )}
                </div>
                <div className="flex-1">
                  <Field label={t('slicer.fps')} value={fps} min={1} max={24} onChange={setFps} />
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {t('slicer.frameOf', { frame, total: Math.max(totalFrames - 1, 0) })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {t('slicer.summary', { frames: totalFrames, w: Math.round(fW), h: Math.round(fH), anchor })}
            {savedAt && <span className="ml-2 text-success">✓ {t('slicer.saved')}</span>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant={props.onAskAgent ? 'outline' : 'default'}
              disabled={saving || !naturalW}
              onClick={() => void save()}
            >
              {saving ? t('slicer.saving') : t('slicer.saveMetadata')}
            </Button>
            {props.onAskAgent && (
              <Button
                size="sm"
                disabled={saving || !naturalW}
                title={t('slicer.askAgentTitle')}
                onClick={async () => {
                  const ok = await save();
                  if (!ok) return;
                  props.onAskAgent?.(metadata);
                  props.onClose();
                }}
              >
                {t('slicer.saveApply')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
