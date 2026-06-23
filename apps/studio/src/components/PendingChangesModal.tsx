import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Scissors, Sparkles } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  buildBatchPrompt,
  clearPendingSlices,
  fetchPendingSlices,
  type PendingSliceEntry,
} from '@/lib/review';

export interface PendingChangesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  /** Engine kind — drives engine-specific wording in the Codex apply prompt. */
  engine?: string;
  /** Called after pending slices are reverted so the host can re-poll. */
  onResolved?: () => void;
  /** Optional: hand the generated batch prompt to the chat so the user can
   *  review + send it to the agent. When absent, "Apply via Codex" copies the
   *  prompt to the clipboard instead (there is no daemon endpoint that patches
   *  arbitrary engine code — only the agent can). */
  onApplyPrompt?: (prompt: string) => void;
}

export function PendingChangesModal(props: PendingChangesModalProps) {
  const { open, onOpenChange, projectPath, engine, onResolved, onApplyPrompt } = props;
  const [pending, setPending] = useState<PendingSliceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPendingSlices(projectPath);
      setPending(r.pending);
    } catch (err) {
      toast.error('Failed to load pending changes', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function handleApply() {
    if (pending.length === 0) return;
    const prompt = buildBatchPrompt(pending, engine);
    if (onApplyPrompt) {
      onApplyPrompt(prompt);
      onOpenChange(false);
      return;
    }
    // Fallback: no chat hook wired — copy the prompt so the user can paste it.
    void navigator.clipboard
      .writeText(prompt)
      .then(() =>
        toast.success('Apply prompt copied', {
          description: 'Paste it into the agent chat and send to apply.',
        }),
      )
      .catch(() =>
        toast.error('Could not copy prompt to clipboard'),
      );
  }

  async function handleRevertAll() {
    if (pending.length === 0 || busy) return;
    setBusy(true);
    try {
      // GAP: daemon has no per-sidecar discard route — DELETE clears every
      // pending slice for the project at once. So this is "Revert all" only.
      const r = await clearPendingSlices(projectPath);
      toast.success(`Reverted ${r.removed} pending change${r.removed === 1 ? '' : 's'}`, {
        description: 'Sidecars deleted. Engine files were left untouched.',
      });
      setPending([]);
      onResolved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Revert failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-4 text-primary" />
            Pending slicing changes
          </DialogTitle>
          <DialogDescription>
            {pending.length} sheet{pending.length === 1 ? '' : 's'} edited locally — not yet
            applied to the engine.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {!loading && pending.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending changes.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <div key={p.sidecarPath} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {p.sourcePath}
                  </code>
                  <Badge variant="secondary">
                    {p.cols}×{p.rows} · {p.fps}fps · {p.anchor}
                  </Badge>
                </div>
                <dl className="mt-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Frame</dt>
                  <dd>
                    {p.frameW ?? '?'} × {p.frameH ?? '?'}
                    {(p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0) && (
                      <> · padding {p.padding}, offset ({p.offsetX}, {p.offsetY})</>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Sidecar</dt>
                  <dd className="text-muted-foreground">{p.sidecarPath}</dd>
                  <dt className="text-muted-foreground">Used in</dt>
                  <dd>
                    {p.usages.length === 0 ? (
                      <span className="text-muted-foreground">(no references found)</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {p.usages.map((u, i) => (
                          <li key={i}>
                            <code className="text-foreground">
                              {u.file}:{u.line}
                            </code>
                            <span className="ml-2 text-muted-foreground">
                              {u.snippet.length > 80
                                ? u.snippet.slice(0, 80) + '…'
                                : u.snippet}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </dl>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center gap-2 border-t px-6 py-4">
          <span className="mr-auto text-xs text-muted-foreground">
            Applying builds one prompt covering all entries for the agent. You review and send.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevertAll}
            disabled={pending.length === 0 || busy}
            title="Discard all pending changes (deletes sidecars; engine files untouched)"
          >
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
            Revert all
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={pending.length === 0 || busy}
          >
            <Sparkles className="size-4" />
            Apply all via Codex
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
