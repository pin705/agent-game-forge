import { useEffect, useState } from 'react';
import {
  Folder,
  Home,
  ChevronUp,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { fsList, openProject, type FsListResult } from '@/lib/files';
import type { Project } from '@/lib/api';

interface OpenProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an existing folder is registered as a project. */
  onOpened: (project: Project) => void;
}

const LS_LAST_BROWSE = 'ogf:lastBrowsePath';

export function OpenProjectDialog({ open, onOpenChange, onOpened }: OpenProjectDialogProps) {
  // '' = home dir (POSIX) / drive list (Windows). Seeded from the last browse.
  const [path, setPath] = useState<string>('');
  const [data, setData] = useState<FsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the start path each time the dialog opens (last browse, else home).
  useEffect(() => {
    if (open) {
      setPath(localStorage.getItem(LS_LAST_BROWSE) ?? '');
      setError(null);
    }
  }, [open]);

  // List the current directory whenever the path changes (dialog open only).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fsList(path)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (r.cwd) localStorage.setItem(LS_LAST_BROWSE, r.cwd);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  const isWindows = navigator.platform.toLowerCase().includes('win');

  async function openCurrent() {
    if (!data?.cwd || busy) return;
    setBusy(true);
    try {
      const { project } = await openProject(data.cwd);
      toast.success(`Opened “${project.name}”`);
      onOpened(project as Project);
      onOpenChange(false);
    } catch (e) {
      toast.error(`Open failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1 p-6 pb-4">
          <DialogTitle>Open existing project</DialogTitle>
          <DialogDescription>
            Browse to a folder and register it as a project. Projects are highlighted.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb / nav bar */}
        <div className="flex items-center gap-1 border-y px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title={isWindows ? 'Drive list' : 'Home'}
            onClick={() => setPath('')}
          >
            <Home />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title="Up one level"
            disabled={data?.parent === null || data?.parent === undefined}
            onClick={() => setPath(data?.parent ?? '')}
          >
            <ChevronUp />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-sm">
            {data && data.parts.length === 0 && (
              <span className="text-muted-foreground">{isWindows ? 'Drives' : 'Home'}</span>
            )}
            {data?.parts.map((p, i) => (
              <span key={p.path} className="flex items-center">
                <button
                  type="button"
                  className="max-w-[14rem] truncate rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground text-muted-foreground"
                  onClick={() => setPath(p.path)}
                >
                  {p.name}
                </button>
                {i < data.parts.length - 1 && (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Folder list */}
        <ScrollArea className="h-[320px] min-h-0 flex-1">
          <div className="p-2">
            {error && (
              <div className="m-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}
            {!error && loading && !data && (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </div>
            )}
            {!error &&
              data &&
              data.entries.length === 0 &&
              (data.drives && data.drives.length === 0 ? null : (
                <div className="p-4 text-sm text-muted-foreground">This folder is empty.</div>
              ))}
            {data?.entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => setPath(e.path)}
                onDoubleClick={() => setPath(e.path)}
                title={e.path}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  e.engine && 'font-medium',
                )}
              >
                <Folder
                  className={cn('size-4 shrink-0', e.engine ? 'text-primary' : 'text-muted-foreground')}
                />
                <span className="truncate">{e.name}</span>
                {e.engine && (
                  <Badge variant="secondary" className="ml-auto capitalize">
                    {e.engine}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col items-stretch gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {data?.cwd ? (
              <>
                <span className="shrink-0">Open:</span>
                <code className="truncate text-foreground">{data.cwd}</code>
                {data.isProject && data.engine && (
                  <Badge variant="secondary" className="shrink-0 capitalize">
                    {data.engine}
                  </Badge>
                )}
              </>
            ) : (
              <span>{isWindows ? 'Pick a drive' : 'Pick a folder'}</span>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void openCurrent()} disabled={!data?.cwd || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {data?.isProject ? 'Open project' : 'Open folder'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
