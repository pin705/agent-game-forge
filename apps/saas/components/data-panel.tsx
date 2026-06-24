"use client";

// Data / table editor — the hosted-model port of apps/studio's DataTab +
// TableEditor. Lists the game's data/*.json files (left), opens one as an
// editable table (right): edit/add/delete/move rows with search + sort, exactly
// like the studio. Reads via GET /api/projects/:id/file and saves the serialized
// JSON via PUT. All parsing/serialization lives in lib/editor/data-table.ts so
// it's testable headless (scripts/data-test.mjs). JSON is validated before save;
// errors surface inline.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Database,
  FileJson,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useT, type TKey } from "@/lib/i18n";
import {
  cellToText,
  columnsOf,
  commitToContent,
  compareCells,
  defaultValueForType,
  detectEol,
  parseDoc,
  serializeDoc,
  type CatalogRow,
  type ColumnType,
  type Eol,
} from "@/lib/editor/data-table";

type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

/** data/*.json files only — the table editor's domain (config + level + catalogs). */
function dataFiles(files: string[]): string[] {
  return files
    .filter((f) => f.startsWith("data/") && f.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
}

export function DataPanel({
  projectId,
  files,
  onSaved,
}: {
  projectId: string;
  files: string[];
  /** Bumped after a save so the workspace can refresh the preview/file list. */
  onSaved?: () => void;
}) {
  const t = useT();
  const candidates = useMemo(() => dataFiles(files), [files]);
  const [active, setActive] = useState<string | null>(null);

  // Default to the first data file once the list resolves; keep the current
  // selection if it still exists after an agent run.
  useEffect(() => {
    setActive((cur) => (cur && candidates.includes(cur) ? cur : (candidates[0] ?? null)));
  }, [candidates]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr]">
      <div className="flex min-h-0 flex-col border-r bg-muted/20">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3">
          <Database className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">{t("data.files")}</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1">
            {candidates.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">{t("data.empty")}</div>
            ) : (
              candidates.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActive(f)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted/60",
                    f === active ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                  title={f}
                >
                  <FileJson className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{f.replace(/^data\//, "")}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="min-h-0">
        {active ? (
          <TableEditor key={active} projectId={projectId} relPath={active} onSaved={onSaved} />
        ) : (
          <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
            {candidates.length > 0 ? t("data.selectFile") : t("data.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";
interface SortState {
  key: string;
  dir: SortDir;
}

function TableEditor({
  projectId,
  relPath,
  onSaved,
}: {
  projectId: string;
  relPath: string;
  onSaved?: () => void;
}) {
  const t = useT();
  // `content` is held as LF-normalized 2-space JSON between edits; the real EOL
  // is re-applied at save (matches the studio + the generator's writers).
  const [content, setContent] = useState<string | null>(null);
  const [eol, setEol] = useState<Eol>("\n");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // View-only state — never affects the underlying data or what gets saved.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    setDirty(false);
    setSaveError(null);
    setActiveIdx(0);
    setQuery("");
    setSort(null);
    fetch(`/api/projects/${projectId}/file?path=${encodeURIComponent(relPath)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `${r.status}`);
        }
        return r.json() as Promise<{ content: string }>;
      })
      .then((r) => {
        if (cancelled) return;
        setEol(detectEol(r.content));
        setContent(r.content);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, relPath]);

  const doc = useMemo(() => (content === null ? null : parseDoc(content, eol)), [content, eol]);
  const fileName = relPath.split("/").pop() ?? relPath;

  const commit = useCallback(
    (mutator: (rows: CatalogRow[]) => CatalogRow[]) => {
      setContent((prev) => (prev === null ? prev : commitToContent(prev, eol, activeIdx, mutator)));
      setDirty(true);
      setSaveError(null);
    },
    [activeIdx, eol],
  );

  const save = useCallback(async () => {
    if (content === null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      let text: string;
      try {
        text = serializeDoc(content, eol);
      } catch {
        setSaveError(t("table.invalidJson"));
        setSaving(false);
        return;
      }
      const r = await fetch(`/api/projects/${projectId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relPath, content: text }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `${r.status}`);
      }
      setDirty(false);
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [content, eol, saving, projectId, relPath, onSaved, t]);

  if (loadError) {
    return (
      <div className="p-6 text-sm text-destructive">
        {t("table.loadFailed", { file: fileName, error: loadError })}
      </div>
    );
  }
  if (doc === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("table.loadingFile", { file: fileName })}
      </div>
    );
  }

  if (doc.blocks.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        <Header fileName={fileName} relPath={relPath} dirty={dirty} saving={saving} onSave={save} canSave={false} t={t} />
        <div className="mt-3 rounded-lg border p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("table.notTable")}</p>
          <p className="mt-1">{doc.reason ?? t("table.noArray")}</p>
          <p className="mt-2">{t("table.editRaw")}</p>
        </div>
      </div>
    );
  }

  const block = doc.blocks[Math.min(activeIdx, doc.blocks.length - 1)];
  const rows = block.rows;
  const columns = columnsOf(rows);

  const q = query.trim().toLowerCase();
  const view = rows
    .map((row, origIndex) => ({ row, origIndex }))
    .filter(({ row }) =>
      q === "" ? true : columns.some((c) => cellToText(row[c.key]).toLowerCase().includes(q)),
    );
  if (sort) {
    const { key, dir } = sort;
    view.sort((a, b) => {
      const cmp = compareCells(a.row[key], b.row[key]);
      return dir === "asc" ? cmp : -cmp;
    });
  }
  // Move only makes sense in natural order — disable it while filtering/sorting.
  const reorderDisabled = q !== "" || sort !== null;

  function cycleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }
  function addRow() {
    commit((arr) => {
      const blank: CatalogRow = {};
      for (const col of columns) blank[col.key] = defaultValueForType(col.type);
      return [...arr, blank];
    });
  }
  function deleteRow(i: number) {
    commit((arr) => arr.filter((_, idx) => idx !== i));
  }
  function moveRow(i: number, dir: -1 | 1) {
    const target = i + dir;
    if (target < 0 || target >= rows.length) return;
    commit((arr) => {
      const next = [...arr];
      const [r] = next.splice(i, 1);
      next.splice(target, 0, r);
      return next;
    });
  }
  function updateCell(i: number, key: string, value: unknown) {
    commit((arr) => arr.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <Header
        fileName={fileName}
        relPath={relPath}
        dirty={dirty}
        saving={saving}
        onSave={save}
        canSave
        t={t}
        extra={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("table.search")}
                className="h-8 w-44 pl-8"
              />
            </div>
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus />
              {t("table.addRow")}
            </Button>
          </>
        }
      />

      {doc.blocks.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {doc.blocks.map((b, i) => (
            <button
              key={b.label}
              type="button"
              onClick={() => {
                setActiveIdx(i);
                setQuery("");
                setSort(null);
              }}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                i === activeIdx
                  ? "border-input bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <span className="font-mono">{b.label}</span>
              <span className="ml-1 opacity-60">· {b.rows.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {block.path.length > 0 ? `.${block.path.join(".")}` : t("table.rootArray")}
        </span>
        <span>·</span>
        <span>
          {q !== "" ? `${view.length} / ${rows.length}` : rows.length} {t("table.rows")}
        </span>
        <span>·</span>
        <span>
          {columns.length} {t("table.columns")}
        </span>
      </div>

      {saveError ? <div className="mt-2 text-sm text-destructive">{saveError}</div> : null}

      <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("table.noRows")}</div>
        ) : view.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("table.noMatch")}</div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[44px] text-right">#</TableHead>
                {columns.map((c) => {
                  const isSorted = sort?.key === c.key;
                  return (
                    <TableHead key={c.key} className="whitespace-nowrap p-0">
                      <button
                        type="button"
                        onClick={() => cycleSort(c.key)}
                        className="flex w-full items-center gap-1 px-4 py-2 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="font-medium text-foreground">{c.key}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {c.type}
                        </span>
                        {isSorted ? (
                          sort?.dir === "asc" ? (
                            <ChevronUp className="size-3.5 text-foreground" />
                          ) : (
                            <ChevronDown className="size-3.5 text-foreground" />
                          )
                        ) : null}
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="w-[96px] text-right">{t("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map(({ row, origIndex }) => (
                <TableRow key={origIndex}>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {origIndex}
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="p-1.5 align-middle">
                      <CellEditor
                        type={c.type}
                        value={row[c.key]}
                        onChange={(v) => updateCell(origIndex, c.key, v)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="p-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title={t("table.moveUp")}
                        disabled={reorderDisabled || origIndex === 0}
                        onClick={() => moveRow(origIndex, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title={t("table.moveDown")}
                        disabled={reorderDisabled || origIndex === rows.length - 1}
                        onClick={() => moveRow(origIndex, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        title={t("table.deleteRow")}
                        onClick={() => deleteRow(origIndex)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Header({
  fileName,
  relPath,
  dirty,
  saving,
  canSave,
  onSave,
  extra,
  t,
}: {
  fileName: string;
  relPath: string;
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  extra?: React.ReactNode;
  t: TFn;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{fileName}</span>
          {dirty ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500">
              {t("common.unsaved")}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{relPath}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <Button size="sm" onClick={onSave} disabled={!canSave || !dirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function CellEditor({
  type,
  value,
  onChange,
}: {
  type: ColumnType;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (type === "number") {
    return (
      <Input
        type="number"
        className="h-8"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (type === "json") {
    // Nested objects/arrays aren't inline-editable in the grid — compact,
    // read-only summary. Editing happens via raw JSON in the Code tab (faithful
    // to the studio, which stubbed this the same way).
    const summary = Array.isArray(value)
      ? `[ ${value.length} ]`
      : value && typeof value === "object"
        ? `{ ${Object.keys(value as object).length} }`
        : String(value ?? "");
    return (
      <span
        className="block truncate font-mono text-xs text-muted-foreground"
        title={JSON.stringify(value)}
      >
        {summary}
      </span>
    );
  }
  return (
    <Input
      type="text"
      className="h-8"
      value={typeof value === "string" ? value : value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
