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
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useT } from '@/lib/i18n';

interface CodePanelProps {
  /** Absolute project path. */
  projectPath: string;
}

interface SelectedFile {
  relPath: string;
  fileKind?: FileKind;
}

/** An open editor tab. `name` is the basename shown on the tab. */
interface OpenTab extends SelectedFile {
  name: string;
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
  forceOpen,
  onToggle,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  openFolders: Set<string>;
  /** Folders forced open by an active search filter (overrides openFolders). */
  forceOpen: Set<string> | null;
  onToggle: (relPath: string) => void;
  onSelect: (file: OpenTab) => void;
}) {
  const isRoot = depth < 0;

  if (node.kind === 'dir') {
    const open = isRoot || (forceOpen ? forceOpen.has(node.relPath) : openFolders.has(node.relPath));
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
              forceOpen={forceOpen}
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
      onClick={() => onSelect({ relPath: node.relPath, name: node.name, fileKind: node.fileKind })}
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

/** Result of pruning the tree to a case-insensitive `relPath` query. */
interface FilteredTree {
  /** Pruned tree (dirs kept only if they contain a match), or null if no match. */
  tree: FileNode | null;
  /** relPaths of folders that contain a match — forced open so hits are visible. */
  expand: Set<string>;
}

/**
 * Prune `node` to entries whose `relPath` contains `query` (case-insensitive).
 * A directory survives if any descendant matches; its relPath is added to
 * `expand` so it renders open. The root node is always kept as the container.
 */
function filterTree(node: FileNode, query: string): FilteredTree {
  const q = query.trim().toLowerCase();
  const expand = new Set<string>();

  function walk(n: FileNode, isRoot: boolean): FileNode | null {
    if (n.kind === 'file') {
      return n.relPath.toLowerCase().includes(q) ? n : null;
    }
    const kids = (n.children ?? [])
      .map((c) => walk(c, false))
      .filter((c): c is FileNode => c !== null);
    const selfMatches = !isRoot && n.relPath.toLowerCase().includes(q);
    // Keep a dir if it (or a descendant) matches; always keep the root container.
    if (isRoot || kids.length > 0 || selfMatches) {
      if (!isRoot && (kids.length > 0 || selfMatches)) expand.add(n.relPath);
      return { ...n, children: kids };
    }
    return null;
  }

  return { tree: walk(node, true), expand };
}

// ─── Breadcrumbs ───────────────────────────────────────────────────────────

/** Render a project-relative path as muted segments, last one emphasized. */
function Breadcrumbs({ relPath }: { relPath: string }) {
  const segments = relPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <nav
      aria-label={relPath}
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-4 py-1.5 text-xs"
    >
      {segments.map((seg, i) => {
        const last = i === segments.length - 1;
        return (
          <span key={i} className="flex shrink-0 items-center gap-1">
            {i > 0 ? <span className="text-muted-foreground/50">/</span> : null}
            <span className={cn('font-mono', last ? 'text-foreground' : 'text-muted-foreground')}>
              {seg}
            </span>
          </span>
        );
      })}
    </nav>
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
  const t = useT();
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
      <div className="flex shrink-0 items-center gap-2 bg-muted/30 px-4 py-2">
        <span className="truncate font-mono text-xs text-foreground" title={file.relPath}>
          {file.relPath}
        </span>
        {dirty ? (
          <span className="text-xs text-amber-500">● {t('common.unsaved')}</span>
        ) : null}
        <div className="flex-1" />
        {data?.kind === 'text' ? (
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            <Save />
            {saving ? t('common.saving') : t('common.save')}
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
          <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>
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
                {t('code.truncated')}
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
            {t('code.binary')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────

export function CodePanel({ projectPath }: CodePanelProps) {
  const t = useT();
  const [tree, setTree] = useState<FileNode | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
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

  // Open a file: push a tab if not already open, then activate it.
  const openFile = useCallback((file: OpenTab) => {
    setTabs((prev) => (prev.some((t) => t.relPath === file.relPath) ? prev : [...prev, file]));
    setActivePath(file.relPath);
  }, []);

  // Close a tab; if it was active, activate its neighbor (prefer the next one).
  const closeTab = useCallback((relPath: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.relPath === relPath);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.relPath !== relPath);
      setActivePath((cur) => {
        if (cur !== relPath) return cur;
        if (next.length === 0) return null;
        const neighbor = next[idx] ?? next[idx - 1];
        return neighbor.relPath;
      });
      return next;
    });
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.relPath === activePath) ?? null,
    [tabs, activePath],
  );

  // Apply the file-search filter. When the query is empty, show the full tree
  // (no forced expansion). Otherwise prune to matches and force-open their
  // ancestor folders so every hit is visible.
  const searching = search.trim().length > 0;
  const filtered = useMemo(
    () => (tree && searching ? filterTree(tree, search) : null),
    [tree, search, searching],
  );
  const displayTree = searching ? filtered?.tree ?? null : tree;
  const forceOpen = searching ? filtered?.expand ?? new Set<string>() : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr]">
      <div className="flex min-h-0 flex-col bg-muted/20">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3">
          <span className="text-xs font-medium text-foreground">{t('code.files')}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={t('common.refresh')}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('code.searchFiles')}
              aria-label={t('code.searchFiles')}
              className="h-8 pl-8"
            />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1">
            {treeError ? (
              <div className="p-3 text-xs text-destructive">{treeError}</div>
            ) : !tree ? (
              <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>
            ) : displayTree ? (
              <TreeNode
                node={displayTree}
                depth={-1}
                selected={activePath}
                openFolders={openFolders}
                forceOpen={forceOpen}
                onToggle={toggle}
                onSelect={openFile}
              />
            ) : (
              <div className="p-3 text-xs text-muted-foreground">{t('code.noMatch')}</div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col">
        {tabs.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto bg-muted/30 px-1.5 py-1">
            {tabs.map((tab) => {
              const isActive = tab.relPath === activePath;
              return (
                <div
                  key={tab.relPath}
                  className={cn(
                    'group flex shrink-0 items-center gap-1 rounded-md py-1 pl-2.5 pr-1 text-xs transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActivePath(tab.relPath)}
                    className="max-w-[12rem] truncate font-mono"
                    title={tab.relPath}
                  >
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.relPath);
                    }}
                    aria-label={t('common.close')}
                    title={t('common.close')}
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                      !isActive && 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {activeTab ? <Breadcrumbs relPath={activeTab.relPath} /> : null}

        <div className="min-h-0 flex-1">
          {activeTab ? (
            <FileViewer key={activeTab.relPath} projectPath={projectPath} file={activeTab} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
              {t('code.selectFile')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
