import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  applyPack as apiApplyPack,
  discardPack as apiDiscardPack,
  buildCodeUpdatePrompt,
  fetchFileContent,
  fetchPendingPacks,
  layoutDiffers,
  type PackLayout,
  type PendingPack,
} from '@/lib/review';

export interface PackReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  /** Called after a pack is applied or discarded so the host can re-poll. */
  onResolved?: () => void;
  /** Optional: when a pack whose layout changed is applied, hand the
   *  follow-up code-update prompt to the chat. When absent, the prompt is
   *  copied to the clipboard instead. */
  onRequestCodeUpdate?: (prompt: string) => void;
}

interface PackPreview {
  liveSheetUrl: string | null;
  stagingSheetUrl: string | null;
  loading: boolean;
}

export function PackReviewModal(props: PackReviewModalProps) {
  const { open, onOpenChange, projectPath, onResolved, onRequestCodeUpdate } = props;
  const [packs, setPacks] = useState<PendingPack[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState<'apply' | 'discard' | null>(null);
  const [autoCodeUpdate, setAutoCodeUpdate] = useState(true);
  const [preview, setPreview] = useState<PackPreview>({
    liveSheetUrl: null,
    stagingSheetUrl: null,
    loading: false,
  });

  const load = useCallback(async () => {
    try {
      const r = await fetchPendingPacks(projectPath);
      setPacks(r.packs);
      setActiveIdx((i) => Math.min(i, Math.max(0, r.packs.length - 1)));
    } catch (err) {
      toast.error('Failed to load pending packs', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const active = packs[activeIdx] ?? null;

  // Lazy-load sheet.png previews for the active pack. We don't cache across
  // packs — each preview is two base64 sheets (potentially hundreds of KB);
  // caching would accumulate megabytes. Refetch is cheap.
  useEffect(() => {
    if (!open || !active) return;
    let cancelled = false;
    setPreview({ liveSheetUrl: null, stagingSheetUrl: null, loading: true });
    (async () => {
      const livePath = `${active.packDir}/sheet.png`;
      const stagingPath = `.ogf/regen/${active.packDir}/sheet.png`;
      const toUrl = async (relPath: string) => {
        try {
          const r = await fetchFileContent(projectPath, relPath);
          if (r.kind !== 'image' || !r.base64) return null;
          return `data:image/png;base64,${r.base64}`;
        } catch {
          return null;
        }
      };
      const [live, stage] = await Promise.all([toUrl(livePath), toUrl(stagingPath)]);
      if (cancelled) return;
      setPreview({ liveSheetUrl: live, stagingSheetUrl: stage, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, active, projectPath]);

  function advanceOrClose() {
    onResolved?.();
    if (packs.length > 1) {
      setActiveIdx((i) => Math.min(i, packs.length - 2));
      void load();
    } else {
      onOpenChange(false);
    }
  }

  async function doApply() {
    if (!active || busy) return;
    const layoutChanged = layoutDiffers(active.liveLayout, active.stagingLayout);
    setBusy('apply');
    try {
      const r = await apiApplyPack(projectPath, active.packDir);
      if (r.failed.length > 0) {
        toast.warning('Some files failed to apply', {
          description: r.failed
            .slice(0, 5)
            .map((f) => `${f.relPath}: ${f.err}`)
            .join('\n'),
        });
      } else {
        toast.success(`Applied ${r.applied.length} file${r.applied.length === 1 ? '' : 's'}`);
      }
      if (autoCodeUpdate && layoutChanged) {
        const prompt = buildCodeUpdatePrompt(active);
        if (onRequestCodeUpdate) {
          onRequestCodeUpdate(prompt);
        } else {
          await navigator.clipboard.writeText(prompt).catch(() => {});
          toast.info('Layout changed — code-update prompt copied', {
            description: 'Paste it into the agent chat to patch slicing in code/data.',
          });
        }
      }
      advanceOrClose();
    } catch (err) {
      toast.error('Apply failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  async function doDiscard() {
    if (!active || busy) return;
    setBusy('discard');
    try {
      await apiDiscardPack(projectPath, active.packDir);
      toast.success('Pack discarded', { description: 'The live folder was untouched.' });
      advanceOrClose();
    } catch (err) {
      toast.error('Discard failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  // Parse entity / action from packDir like "assets/sprites/scout/idle".
  const segs = active?.packDir.split('/') ?? [];
  const action = segs[segs.length - 1] ?? '';
  const entity = segs[segs.length - 2] ?? '';
  const layoutChanged = active
    ? layoutDiffers(active.liveLayout, active.stagingLayout)
    : false;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-4 text-primary" />
            {active ? (
              <>
                Review pack: {entity} / {action}
              </>
            ) : (
              'Review pack'
            )}
          </DialogTitle>
          <DialogDescription>
            {packs.length > 1 && <>{activeIdx + 1} of {packs.length} pending · </>}
            {active ? `${active.fileCount} files` : 'No pending packs.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!active && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending packs.
            </p>
          )}

          {active && (
            <>
              {/* Pack switcher when multiple are pending */}
              {packs.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {packs.map((p, i) => (
                    <Button
                      key={p.packDir}
                      variant={i === activeIdx ? 'default' : 'outline'}
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setActiveIdx(i)}
                    >
                      {p.packDir.split('/').slice(-2).join(' / ')}
                    </Button>
                  ))}
                </div>
              )}

              {/* Sheet diff side-by-side */}
              <div className="grid grid-cols-2 gap-4">
                <SheetFigure
                  caption="Original"
                  url={preview.liveSheetUrl}
                  loading={preview.loading}
                  emptyLabel="no live sheet"
                />
                <SheetFigure
                  caption="New"
                  url={preview.stagingSheetUrl}
                  loading={preview.loading}
                  emptyLabel="no staging sheet"
                />
              </div>

              {/* Layout diff table */}
              <div className="mt-4 rounded-lg border">
                <div className="grid grid-cols-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span />
                  <span>Original</span>
                  <span>New</span>
                </div>
                <LayoutRow
                  label="Frames"
                  live={active.liveLayout?.frames}
                  stage={active.stagingLayout?.frames}
                />
                <LayoutRow
                  label="Grid"
                  live={fmtGrid(active.liveLayout)}
                  stage={fmtGrid(active.stagingLayout)}
                  isString
                />
                <LayoutRow
                  label="Cell size"
                  live={active.liveLayout?.cellSize}
                  stage={active.stagingLayout?.cellSize}
                  suffix="px"
                />
                <LayoutRow
                  label="FPS"
                  live={active.liveLayout?.fps}
                  stage={active.stagingLayout?.fps}
                />
                <LayoutRow
                  label="Anchor"
                  live={active.liveLayout?.anchor}
                  stage={active.stagingLayout?.anchor}
                  isString
                />
              </div>

              {layoutChanged && (
                <Label className="mt-4 flex items-start gap-2 text-sm font-normal">
                  <Checkbox
                    checked={autoCodeUpdate}
                    onCheckedChange={(c) => setAutoCodeUpdate(c === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Layout changed — auto-fire a follow-up turn to patch slicing in
                    code/data after apply
                  </span>
                </Label>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={doDiscard}
            disabled={!active || busy !== null}
          >
            {busy === 'discard' ? 'Discarding…' : 'Discard pack'}
          </Button>
          <span className="grow" />
          <Button size="sm" onClick={doApply} disabled={!active || busy !== null}>
            {busy === 'apply'
              ? 'Applying…'
              : active
                ? `Apply pack (${active.fileCount} files)`
                : 'Apply pack'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetFigure(props: {
  caption: string;
  url: string | null;
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <figure className="flex flex-col items-center gap-2 rounded-lg border bg-muted/30 p-3">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {props.caption}
      </figcaption>
      {props.loading ? (
        <span className="py-6 font-mono text-xs text-muted-foreground">loading…</span>
      ) : props.url ? (
        <img
          src={props.url}
          alt={props.caption}
          className="max-h-48 w-auto"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className="py-6 font-mono text-xs text-muted-foreground">
          {props.emptyLabel}
        </span>
      )}
    </figure>
  );
}

function LayoutRow(props: {
  label: string;
  live: number | string | null | undefined;
  stage: number | string | null | undefined;
  suffix?: string;
  isString?: boolean;
}) {
  const { label, live, stage, suffix = '', isString = false } = props;
  const liveStr =
    live === null || live === undefined ? '—' : isString ? String(live) : `${live}${suffix}`;
  const stageStr =
    stage === null || stage === undefined ? '—' : isString ? String(stage) : `${stage}${suffix}`;
  const changed = liveStr !== stageStr && liveStr !== '—' && stageStr !== '—';
  return (
    <div
      className={cn(
        'grid grid-cols-3 items-center px-3 py-1.5 text-sm',
        changed && 'bg-primary/5',
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{liveStr}</span>
      <span className="flex items-center gap-2 font-mono">
        {stageStr}
        {changed && <Badge variant="secondary">changed</Badge>}
      </span>
    </div>
  );
}

function fmtGrid(layout: PackLayout | null): string | null {
  if (!layout || !layout.cols || !layout.rows) return null;
  return `${layout.cols}×${layout.rows}`;
}
