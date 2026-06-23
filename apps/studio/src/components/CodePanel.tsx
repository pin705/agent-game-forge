import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  ImageIcon,
  RefreshCw,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  fetchFileContent,
  fetchFileTree,
  fileUrl,
  writeFileContent,
  type FileKind,
  type FileNode,
  type ReadFileResponse,
} from '@/lib/files';

interface CodePanelProps {
  /** Absolute project path. */
  projectPath: string;
}

interface SelectedFile {
  relPath: string;
  fileKind?: FileKind;
}

// ─── File tree ───────────────────────────────────────────────────────────

function fileIcon(node: FileNode) {
  if (node.fileKind === 'image') return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'gd', 'cs', 'py', 'go', 'rs', 'lua'].includes(ext))
    return <FileCode className="size-3.5 shrink-0 text-muted-foreground" />;
  if (ext === 'json') return <FileJson className="size-3.5 shrink-0 text-muted-foreground" />;
  if (['md', 'txt', 'cfg', 'ini', 'toml', 'yaml', 'yml'].includes(ext))
    return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function TreeNode({
  node,
  depth,
  selected,
  openFolders,
  onToggle,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  openFolders: Set<string>;
  onToggle: (relPath: string) => void;
  onSelect: (file: SelectedFile) => void;
}) {
  const isRoot = depth < 0;

  if (node.kind === 'dir') {
    const open = isRoot || openFolders.has(node.relPath);
    const children = node.children ?? [];
    return (
      <>
        {!isRoot && (
          <button
            type="button"
            onClick={() => onToggle(node.relPath)}
            className="flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm text-foreground hover:bg-muted/60"
            style={{ paddingLeft: depth * 12 + 8 }}
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            />
            {open ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {open &&
          children.map((c) => (
            <TreeNode
              key={c.relPath || c.name}
              node={c}
              depth={isRoot ? 0 : depth + 1}
              selected={selected}
              openFolders={openFolders}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  const isSelected = selected === node.relPath;
  return (
    <button
      type="button"
      onClick={() => onSelect({ relPath: node.relPath, fileKind: node.fileKind })}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm hover:bg-muted/60',
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground',
      )}
      style={{ paddingLeft: depth * 12 + 8 + 14 }}
      title={node.relPath}
    >
      {fileIcon(node)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ─── Viewer / editor ───────────────────────────────────────────────────────

function FileViewer({
  projectPath,
  file,
}: {
  projectPath: string;
  file: SelectedFile;
}) {
  const [data, setData] = useState<ReadFileResponse | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchFileContent(projectPath, file.relPath)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (r.kind === 'text') {
          const c = r.content ?? '';
          setContent(c);
          setOriginal(c);
        }
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
  }, [projectPath, file.relPath]);

  const dirty = data?.kind === 'text' && content !== original;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFileContent({ projectPath, relPath: file.relPath, content });
      setOriginal(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, projectPath, file.relPath, content]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="truncate font-mono text-xs text-foreground" title={file.relPath}>
          {file.relPath}
        </span>
        {dirty ? (
          <span className="text-xs text-amber-500">● unsaved</span>
        ) : null}
        <div className="flex-1" />
        {data?.kind === 'text' ? (
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            <Save />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : data?.kind === 'image' ? (
          <div className="flex h-full items-center justify-center overflow-auto bg-[length:16px_16px] p-6">
            <img
              src={fileUrl(projectPath, file.relPath)}
              alt={file.relPath}
              className="max-h-full max-w-full object-contain [image-rendering:pixelated] drop-shadow-lg"
            />
          </div>
        ) : data?.kind === 'text' ? (
          <div className="flex h-full flex-col">
            {data.truncated ? (
              <div className="shrink-0 px-4 py-1 text-xs text-amber-500">
                File truncated — only part of it is shown. Saving would overwrite the full file.
              </div>
            ) : null}
            {/* TODO: Monaco — Textarea is a stopgap editor. */}
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="h-full min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0"
            />
          </div>
        ) : data?.kind === 'binary' ? (
          <div className="p-6 text-sm text-muted-foreground">
            Binary file — no preview available.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────

export function CodePanel({ projectPath }: CodePanelProps) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    fetchFileTree(projectPath)
      .then((r) => {
        if (!cancelled) setTree(r.tree);
      })
      .catch((e) => {
        if (!cancelled) setTreeError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, reloadKey]);

  const toggle = useCallback((relPath: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const viewer = useMemo(
    () =>
      selected ? (
        <FileViewer key={selected.relPath} projectPath={projectPath} file={selected} />
      ) : (
        <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
          Select a file to view or edit it.
        </div>
      ),
    [selected, projectPath],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr]">
      <div className="flex min-h-0 flex-col border-r">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-xs font-medium text-foreground">Files</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Refresh"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1">
            {treeError ? (
              <div className="p-3 text-xs text-destructive">{treeError}</div>
            ) : !tree ? (
              <div className="p-3 text-xs text-muted-foreground">Loading…</div>
            ) : (
              <TreeNode
                node={tree}
                depth={-1}
                selected={selected?.relPath ?? null}
                openFolders={openFolders}
                onToggle={toggle}
                onSelect={setSelected}
              />
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="min-h-0">{viewer}</div>
    </div>
  );
}
