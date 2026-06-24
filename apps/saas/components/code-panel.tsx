"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { setupMonaco, languageOf } from "@/lib/monaco-setup";
import {
  buildFileTree,
  filterTree,
  fileKindOf,
  type FileKind,
  type FileNode,
} from "@/lib/files";
import { useT } from "@/lib/i18n";

// Monaco is loaded CLIENT-ONLY (ssr:false) so it never touches `window` during
// SSR/prerender and its loader CDN is hit only at runtime in the browser.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => null,
});

interface SelectedFile {
  relPath: string;
  fileKind: FileKind;
}

/** An open editor tab. `name` is the basename shown on the tab. */
interface OpenTab extends SelectedFile {
  name: string;
}

// ─── File tree ───────────────────────────────────────────────────────────

function fileIcon(node: FileNode) {
  if (node.fileKind === "image")
    return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "gd", "cs", "py", "go", "rs", "lua"].includes(ext))
    return <FileCode className="size-3.5 shrink-0 text-muted-foreground" />;
  if (ext === "json") return <FileJson className="size-3.5 shrink-0 text-muted-foreground" />;
  if (["md", "txt", "cfg", "ini", "toml", "yaml", "yml", "html", "css"].includes(ext))
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
  forceOpen: Set<string> | null;
  onToggle: (relPath: string) => void;
  onSelect: (file: OpenTab) => void;
}) {
  const isRoot = depth < 0;

  if (node.kind === "dir") {
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
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
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
      onClick={() =>
        onSelect({ relPath: node.relPath, name: node.name, fileKind: node.fileKind ?? "text" })
      }
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm hover:bg-muted/60",
        isSelected ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
      style={{ paddingLeft: depth * 12 + 8 + 14 }}
      title={node.relPath}
    >
      {fileIcon(node)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ─── Breadcrumbs ───────────────────────────────────────────────────────────

/** Render a project-relative path as muted segments, last one emphasized. */
function Breadcrumbs({ relPath }: { relPath: string }) {
  const segments = relPath.split("/").filter(Boolean);
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
            <span className={cn("font-mono", last ? "text-foreground" : "text-muted-foreground")}>
              {seg}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

// ─── Editor theme ──────────────────────────────────────────────────────────

/**
 * Track the Monaco theme from the `dark` class on <html>. Returns 'vs-dark'
 * when dark mode is active, else 'vs'. Observes class changes so toggling the
 * app theme re-themes the editor live. Starts at 'vs' for SSR determinism.
 */
function useMonacoTheme(): "vs-dark" | "vs" {
  const [theme, setTheme] = useState<"vs-dark" | "vs">("vs");
  useEffect(() => {
    const read = () =>
      document.documentElement.classList.contains("dark") ? "vs-dark" : "vs";
    setTheme(read());
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ─── Viewer / editor ───────────────────────────────────────────────────────

function FileViewer({
  projectId,
  file,
  onDirtyChange,
}: {
  projectId: string;
  file: SelectedFile;
  /** Reports whether THIS file has unsaved edits (Batch 4 status bar / guard). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const theme = useMonacoTheme();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Make sure Monaco's loader is configured before the editor mounts.
  useEffect(() => {
    setupMonaco();
  }, []);

  const isText = file.fileKind === "text";

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent(file.relPath)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `${r.status}`);
        }
        return r.json() as Promise<{ content: string }>;
      })
      .then((r) => {
        if (cancelled) return;
        setContent(r.content);
        setOriginal(r.content);
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
  }, [projectId, file.relPath, isText]);

  const dirty = isText && content !== original;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.relPath, content }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `${r.status}`);
      }
      setOriginal(content);
    } catch (e) {
      setError(t("code.saveFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, projectId, file.relPath, content, t]);

  // Cmd/Ctrl+S saves from anywhere in the editor area.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, save]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 bg-muted/30 px-4 py-2">
        <span className="truncate font-mono text-xs text-foreground" title={file.relPath}>
          {file.relPath}
        </span>
        {dirty ? <span className="text-xs text-amber-500">● {t("common.unsaved")}</span> : null}
        <div className="flex-1" />
        {isText ? (
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            <Save />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {!isText ? (
          file.fileKind === "image" ? (
            <div className="flex h-full items-center justify-center overflow-auto p-6">
              {/* Served from the owner-only draft preview route (byte-accurate). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/build/${projectId}/preview/${file.relPath}`}
                alt={file.relPath}
                className="max-h-full max-w-full object-contain [image-rendering:pixelated] drop-shadow-lg"
              />
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">{t("code.binary")}</div>
          )
        ) : loading ? (
          <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <MonacoEditor
            height="100%"
            theme={theme}
            language={languageOf(file.relPath)}
            value={content}
            onChange={(v) => setContent(v ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────

/**
 * Code editor: file tree (built from the flat file list) + tree search + open
 * file tabs + breadcrumbs + Monaco + a Save affordance with a dirty indicator.
 * The workspace owns the file list and refresh (passed in) so the tree updates
 * after an agent run; the in-panel refresh button re-pulls too.
 */
export function CodePanel({
  projectId,
  files,
  onRefresh,
  loading,
}: {
  projectId: string;
  files: string[];
  onRefresh: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const tree = useMemo(() => buildFileTree(files), [files]);

  // Prune tabs whose file no longer exists (e.g. an agent run deleted it).
  useEffect(() => {
    const present = new Set(files);
    setTabs((prev) => {
      const next = prev.filter((tab) => present.has(tab.relPath));
      if (next.length === prev.length) return prev;
      setActivePath((cur) => (cur && present.has(cur) ? cur : (next[0]?.relPath ?? null)));
      return next;
    });
  }, [files]);

  const toggle = useCallback((relPath: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const openFile = useCallback((file: OpenTab) => {
    setTabs((prev) => (prev.some((tb) => tb.relPath === file.relPath) ? prev : [...prev, file]));
    setActivePath(file.relPath);
  }, []);

  const closeTab = useCallback((relPath: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((tb) => tb.relPath === relPath);
      if (idx === -1) return prev;
      const next = prev.filter((tb) => tb.relPath !== relPath);
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
    () => tabs.find((tb) => tb.relPath === activePath) ?? null,
    [tabs, activePath],
  );

  const searching = search.trim().length > 0;
  const filtered = useMemo(
    () => (searching ? filterTree(tree, search) : null),
    [tree, search, searching],
  );
  const displayTree = searching ? (filtered?.tree ?? null) : tree;
  const forceOpen = searching ? (filtered?.expand ?? new Set<string>()) : null;
  const hasFiles = files.length > 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_1fr]">
      <div className="flex min-h-0 flex-col border-r bg-muted/20">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3">
          <span className="text-xs font-medium text-foreground">{t("code.files")}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={t("common.refresh")}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("code.searchFiles")}
              aria-label={t("code.searchFiles")}
              className="h-8 pl-8"
            />
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1">
            {!hasFiles ? (
              <div className="p-3 text-xs text-muted-foreground">{t("code.empty")}</div>
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
              <div className="p-3 text-xs text-muted-foreground">{t("code.noMatch")}</div>
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
                    "group flex shrink-0 items-center gap-1 rounded-md py-1 pl-2.5 pr-1 text-xs transition-colors",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
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
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                      !isActive && "opacity-0 group-hover:opacity-100",
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
            <FileViewer key={activeTab.relPath} projectId={projectId} file={activeTab} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
              {hasFiles ? t("code.selectFile") : t("code.empty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export so callers can classify a path the same way the tree does.
export { fileKindOf };
