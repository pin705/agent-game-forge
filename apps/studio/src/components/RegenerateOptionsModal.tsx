import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fetchFileTree, type FileNode } from '@/lib/assets';

export interface RegenerateOptions {
  /** 'auto' = trust the agent (default). 'manual' = use the numeric fields. */
  mode: 'auto' | 'manual';
  /** Free-form change request — what should be different about this sprite. */
  hint: string;
  /** Ask the agent to view sibling sprites as character references. */
  matchSiblingStyle: boolean;
  /** Manual-only: aspect override. 'same' = keep dims, 'free' = model picks. */
  aspectRatio: 'same' | 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  /** Manual-only fields. */
  frames: number;
  cols: number;
  rows: number;
  fps: number;
}

/** Whether `relPath` is part of an animation pack (a dir with sheet.png +
 *  pipeline-meta.json), and what sibling action folders exist. */
export interface PackContext {
  isPack: boolean;
  packDir: string | null;
  packFiles: string[];
  siblingActions: Array<{ name: string; sheetRelPath: string }>;
}

interface RegenerateOptionsModalProps {
  /** Current slicing if known — pre-fills cols/rows/fps. */
  initial?: { cols?: number; rows?: number; fps?: number };
  /** Path of the sprite being regenerated; its parent dir locates siblings. */
  relPath: string;
  projectPath: string;
  onCancel: () => void;
  onSubmit: (
    opts: RegenerateOptions,
    siblings: string[],
    packCtx: PackContext,
  ) => void;
}

const ASPECTS: Array<{ value: RegenerateOptions['aspectRatio']; label: string }> = [
  { value: 'same', label: 'Same as current' },
  { value: '1:1', label: '1:1 (square)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: 'free', label: 'Free (let model pick)' },
];

function findNodeByRelPath(tree: FileNode, relPath: string): FileNode | null {
  if (relPath === '' || tree.relPath.replace(/\\/g, '/') === relPath) return tree;
  if (!tree.children) return null;
  for (const c of tree.children) {
    const found = findNodeByRelPath(c, relPath);
    if (found) return found;
  }
  return null;
}

/** Walk the file tree to determine whether `relPath` lives in a pack dir. */
function detectPackContext(tree: FileNode, relPath: string): PackContext {
  const norm = relPath.replace(/\\/g, '/');
  const parts = norm.split('/');
  parts.pop(); // drop the file name
  const parentRel = parts.join('/');

  const parentNode = findNodeByRelPath(tree, parentRel);
  if (!parentNode?.children) {
    return { isPack: false, packDir: null, packFiles: [], siblingActions: [] };
  }

  const childNames = parentNode.children
    .filter((c) => c.kind === 'file')
    .map((c) => c.name);
  const isPack =
    childNames.includes('sheet.png') && childNames.includes('pipeline-meta.json');
  if (!isPack) {
    return { isPack: false, packDir: null, packFiles: [], siblingActions: [] };
  }

  const packFiles = parentNode.children
    .filter((c) => c.kind === 'file')
    .map((c) => c.relPath.replace(/\\/g, '/'));

  // Sibling actions: dirs next to this pack that are packs themselves.
  const siblingActions: Array<{ name: string; sheetRelPath: string }> = [];
  const grandparentRel = parts.slice(0, -1).join('/');
  const grandparent = findNodeByRelPath(tree, grandparentRel);
  if (grandparent?.children) {
    for (const sib of grandparent.children) {
      if (sib.kind !== 'dir' || sib.name === parts[parts.length - 1]) continue;
      if (!sib.children) continue;
      const sibChildren = sib.children
        .filter((c) => c.kind === 'file')
        .map((c) => c.name);
      if (
        sibChildren.includes('sheet.png') &&
        sibChildren.includes('pipeline-meta.json')
      ) {
        siblingActions.push({
          name: sib.name,
          sheetRelPath: `${sib.relPath.replace(/\\/g, '/')}/sheet.png`,
        });
      }
    }
  }

  return { isPack: true, packDir: parentRel, packFiles, siblingActions };
}

/** Suggest a reasonable cols × rows grid for a frame count. */
function suggestGrid(frames: number): { cols: number; rows: number } {
  if (frames <= 1) return { cols: 1, rows: 1 };
  const root = Math.sqrt(frames);
  for (let r = Math.floor(root); r >= 1; r--) {
    if (frames % r === 0) return { cols: frames / r, rows: r };
  }
  return { cols: frames, rows: 1 };
}

/**
 * Options form to regenerate a sprite (or a whole animation pack). Detects
 * pack-ness from the file tree, discovers sibling sprites for style matching,
 * and surfaces a Quick (agent decides) vs Manual (set frames/grid/fps) toggle.
 * On submit it hands the chosen options + reference list + pack context back
 * to the caller, which drives the actual agent turn.
 */
export function RegenerateOptionsModal(props: RegenerateOptionsModalProps) {
  const initialFrames =
    (props.initial?.cols ?? 0) * (props.initial?.rows ?? 0) || 4;
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [hint, setHint] = useState('');
  const [matchSiblingStyle, setMatchSiblings] = useState(true);

  const [aspectRatio, setAspectRatio] =
    useState<RegenerateOptions['aspectRatio']>('same');
  const [frames, setFrames] = useState(initialFrames);
  const [cols, setCols] = useState(props.initial?.cols ?? 4);
  const [rows, setRows] = useState(props.initial?.rows ?? 1);
  const [fps, setFps] = useState(props.initial?.fps ?? 8);

  const [packCtx, setPackCtx] = useState<PackContext>({
    isPack: false,
    packDir: null,
    packFiles: [],
    siblingActions: [],
  });
  const [scanLoading, setScanLoading] = useState(true);
  const [flatSiblings, setFlatSiblings] = useState<string[]>([]);

  const parentDir = useMemo(() => {
    const segs = props.relPath.replace(/\\/g, '/').split('/');
    segs.pop();
    return segs.join('/');
  }, [props.relPath]);

  // Detect pack-ness + discover references in one tree walk.
  useEffect(() => {
    let cancelled = false;
    setScanLoading(true);
    fetchFileTree(props.projectPath)
      .then((res) => {
        if (cancelled) return;
        const ctx = detectPackContext(res.tree, props.relPath);
        setPackCtx(ctx);

        if (!ctx.isPack) {
          // Fallback: flat sibling PNGs in the same dir.
          const found: string[] = [];
          const walk = (node: FileNode): void => {
            if (node.children) for (const c of node.children) walk(c);
            if (node.kind !== 'file' || node.relPath === props.relPath) return;
            const norm = node.relPath.replace(/\\/g, '/');
            const dir = norm.split('/').slice(0, -1).join('/');
            if (dir === parentDir && /\.(png|jpe?g|webp)$/i.test(norm)) {
              found.push(norm);
            }
          };
          walk(res.tree);
          setFlatSiblings(found);
        }
      })
      .catch(() => {
        setPackCtx({
          isPack: false,
          packDir: null,
          packFiles: [],
          siblingActions: [],
        });
        setFlatSiblings([]);
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath, parentDir]);

  const referenceFiles = packCtx.isPack
    ? packCtx.siblingActions.map((a) => a.sheetRelPath)
    : flatSiblings;

  function applyFrames(n: number) {
    const v = Math.max(1, Math.floor(n || 0));
    setFrames(v);
    const g = suggestGrid(v);
    setCols(g.cols);
    setRows(g.rows);
  }

  function submit() {
    props.onSubmit(
      { mode, hint: hint.trim(), matchSiblingStyle, aspectRatio, frames, cols, rows, fps },
      referenceFiles,
      packCtx,
    );
  }

  const gridMismatch = cols * rows !== frames;

  const packLabel = packCtx.packDir
    ? (() => {
        const segs = packCtx.packDir.split('/');
        return `${segs[segs.length - 2]} / ${segs[segs.length - 1]}`;
      })()
    : null;

  return (
    <Dialog open onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-4" />
            {packCtx.isPack ? `Regenerate ${packLabel}` : 'Regenerate sprite'}
          </DialogTitle>
          <DialogDescription
            className="truncate font-mono"
            title={packCtx.isPack ? packCtx.packDir ?? '' : props.relPath}
          >
            {packCtx.isPack ? packCtx.packDir : props.relPath}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {packCtx.isPack && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <strong>This regenerates the entire animation pack.</strong>{' '}
              <span className="text-muted-foreground">
                All {packCtx.packFiles.length} files in{' '}
                <code className="text-xs">{packCtx.packDir}/</code> swap atomically
                when you apply.
                {packCtx.siblingActions.length > 0 && (
                  <>
                    {' '}Other actions of the same entity (
                    {packCtx.siblingActions.map((a) => a.name).join(', ')}) won't be
                    touched.
                  </>
                )}
              </span>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">What should change?</span>
            <Textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Optional. e.g. 'more aggressive — bigger swings'. Leave blank for a fresh take with the same intent."
              rows={3}
              autoFocus
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={matchSiblingStyle}
              onChange={(e) => setMatchSiblings(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              {packCtx.isPack
                ? 'Match style of other actions of this entity'
                : 'Match style of sibling sprites in the same folder'}
              {scanLoading ? (
                <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                  scanning…
                </span>
              ) : (
                <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-xs">
                  {referenceFiles.length} found
                </span>
              )}
            </span>
          </label>

          {matchSiblingStyle && referenceFiles.length > 0 && (
            <ul className="space-y-0.5 rounded-md border bg-muted/20 p-2 font-mono text-xs text-muted-foreground">
              {referenceFiles.slice(0, 6).map((s) => (
                <li key={s} className="truncate">{s}</li>
              ))}
              {referenceFiles.length > 6 && (
                <li>… and {referenceFiles.length - 6} more</li>
              )}
            </ul>
          )}

          {/* Quick vs Manual */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('auto')}
              className={cn(
                'flex flex-col rounded-md border px-3 py-2 text-left text-sm transition-colors',
                mode === 'auto'
                  ? 'border-primary bg-accent'
                  : 'hover:bg-accent/50',
              )}
            >
              <span className="font-medium">Quick</span>
              <span className="text-xs text-muted-foreground">agent decides layout</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={cn(
                'flex flex-col rounded-md border px-3 py-2 text-left text-sm transition-colors',
                mode === 'manual'
                  ? 'border-primary bg-accent'
                  : 'hover:bg-accent/50',
              )}
            >
              <span className="font-medium">Manual</span>
              <span className="text-xs text-muted-foreground">set frames / grid / fps</span>
            </button>
          </div>

          {mode === 'manual' && (
            <div className="space-y-3 rounded-md border p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Aspect ratio</span>
                <Select
                  value={aspectRatio}
                  onValueChange={(v) =>
                    setAspectRatio(v as RegenerateOptions['aspectRatio'])
                  }
                >
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECTS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Frames</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={frames}
                    onChange={(e) => applyFrames(Number(e.target.value))}
                    className="h-8 w-16"
                  />
                  <span className="text-xs text-muted-foreground">in</span>
                  <Input
                    type="number"
                    min={1}
                    value={cols}
                    onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-14"
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input
                    type="number"
                    min={1}
                    value={rows}
                    onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-14"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => {
                      const g = suggestGrid(frames);
                      setCols(g.cols);
                      setRows(g.rows);
                    }}
                    title="Suggest a grid that matches the frame count"
                  >
                    auto
                  </Button>
                </div>
              </div>
              {gridMismatch && (
                <div className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" />
                  cols × rows ({cols * rows}) doesn't match frames ({frames}).
                </div>
              )}

              <label className="flex items-center justify-between gap-3 text-sm">
                <span>FPS</span>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={fps}
                  onChange={(e) =>
                    setFps(Math.max(1, Math.min(60, Number(e.target.value) || 8)))
                  }
                  className="h-8 w-16"
                />
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            <RefreshCw className="size-4" />
            Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
