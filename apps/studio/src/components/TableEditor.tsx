import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Save, Trash2, Loader2 } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  fetchFileContent,
  writeFileContent,
  type CatalogRow,
} from '@/lib/catalog';

interface TableEditorProps {
  /** Absolute project path. */
  projectPath: string;
  /** Project-relative path to a data/*.json catalog (array-of-objects). */
  relPath: string;
}

type ColumnType = 'string' | 'number' | 'boolean' | 'json';

interface ColumnSpec {
  key: string;
  type: ColumnType;
}

/** One editable array found inside the JSON. A root array has path []; a
 *  field array (e.g. enemies.json → { wild: [...] }) has path [field]. */
interface ArrayBlock {
  path: string[];
  label: string;
  rows: CatalogRow[];
}

interface ParsedDoc {
  /** The full parsed JSON, mutated in place on edit then re-serialized. */
  root: unknown;
  /** Editable array-of-objects blocks discovered in the document. */
  blocks: ArrayBlock[];
  /** Preserved EOL of the on-disk file. */
  eol: '\n' | '\r\n';
  /** Set when the JSON parses but has no editable array, or fails to parse. */
  reason?: string;
}

function isPlainObject(v: unknown): v is CatalogRow {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isArrayOfObjects(v: unknown): v is CatalogRow[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

function detectColumnType(rows: CatalogRow[], key: string): ColumnType {
  let allNumber = true;
  let allBoolean = true;
  let nonEmpty = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === undefined || v === null || v === '') continue;
    nonEmpty++;
    if (typeof v !== 'number') allNumber = false;
    if (typeof v !== 'boolean') allBoolean = false;
    if (v && typeof v === 'object') return 'json';
  }
  if (nonEmpty === 0) return 'string';
  if (allNumber) return 'number';
  if (allBoolean) return 'boolean';
  return 'string';
}

/** Column order = first-seen order across all rows (the daemon emits stable
 *  field order, so this matches the on-disk layout for the common case). */
function columnsOf(rows: CatalogRow[]): ColumnSpec[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys.map((key) => ({ key, type: detectColumnType(rows, key) }));
}

/** Parse the file into editable blocks. Recognizes a root array-of-objects,
 *  or a root object whose first-level fields are arrays-of-objects (the
 *  multi-catalog shape, e.g. { wild: [...], marsh: [...] }). */
function parseDoc(content: string, eol: '\n' | '\r\n'): ParsedDoc {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch (err) {
    return {
      root: null,
      blocks: [],
      eol,
      reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (isArrayOfObjects(root)) {
    return { root, blocks: [{ path: [], label: '(root array)', rows: root }], eol };
  }
  if (isPlainObject(root)) {
    const blocks: ArrayBlock[] = [];
    for (const [k, v] of Object.entries(root)) {
      if (isArrayOfObjects(v)) blocks.push({ path: [k], label: k, rows: v });
    }
    if (blocks.length > 0) return { root, blocks, eol };
  }
  if (Array.isArray(root) && root.length === 0) {
    // An empty root array is editable — start adding rows.
    return { root, blocks: [{ path: [], label: '(root array)', rows: root }], eol };
  }
  return {
    root,
    blocks: [],
    eol,
    reason: isPlainObject(root)
      ? 'This JSON is an object with no array-of-objects field — not a flat table.'
      : 'This JSON is not an array of objects.',
  };
}

function getArray(root: unknown, path: string[]): CatalogRow[] {
  let cur: unknown = root;
  for (const p of path) cur = (cur as Record<string, unknown>)[p];
  return cur as CatalogRow[];
}

function setArray(root: unknown, path: string[], next: CatalogRow[]): unknown {
  if (path.length === 0) return next;
  const obj = root as Record<string, unknown>;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string, unknown>;
  cur[path[path.length - 1]] = next;
  return obj;
}

function defaultValueForType(t: ColumnType): unknown {
  if (t === 'number') return 0;
  if (t === 'boolean') return false;
  if (t === 'json') return null;
  return '';
}

export function TableEditor({ projectPath, relPath }: TableEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [eol, setEol] = useState<'\n' | '\r\n'>('\n');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Load (and reload when the target file changes).
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    setDirty(false);
    setSaveError(null);
    setActiveIdx(0);
    fetchFileContent(projectPath, relPath)
      .then((r) => {
        if (cancelled) return;
        if (r.kind !== 'text' || r.content === undefined) {
          setLoadError('File is not editable text.');
          return;
        }
        setEol(r.content.includes('\r\n') ? '\r\n' : '\n');
        setContent(r.content);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, relPath]);

  const doc = useMemo<ParsedDoc | null>(
    () => (content === null ? null : parseDoc(content, eol)),
    [content, eol],
  );

  const fileName = relPath.split('/').pop() ?? relPath;

  // Mutate the active array and re-serialize into `content` (marks dirty).
  const commit = useCallback(
    (mutator: (rows: CatalogRow[]) => CatalogRow[]) => {
      setContent((prev) => {
        if (prev === null) return prev;
        const parsed = parseDoc(prev, eol);
        const block = parsed.blocks[Math.min(activeIdx, parsed.blocks.length - 1)];
        if (!block) return prev;
        const next = mutator(getArray(parsed.root, block.path));
        const nextRoot = setArray(parsed.root, block.path, next);
        return JSON.stringify(nextRoot, null, 2);
      });
      setDirty(true);
      setSaveError(null);
    },
    [activeIdx, eol],
  );

  async function save() {
    if (content === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Re-pretty-print with the preserved EOL + trailing newline so the
      // diff stays clean (matches the daemon's own JSON writers).
      const text = JSON.stringify(JSON.parse(content), null, 2).replace(/\n/g, eol) + eol;
      await writeFileContent({ projectPath, relPath, content: text });
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-destructive">Failed to load {fileName}: {loadError}</div>
    );
  }
  if (doc === null) {
    return <div className="p-6 text-sm text-muted-foreground">Loading {fileName}…</div>;
  }

  if (doc.blocks.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header fileName={fileName} relPath={relPath} dirty={dirty} saving={saving} onSave={save} canSave={false} />
        <div className="mt-3 rounded-lg border p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Not a table</p>
          <p className="mt-1">{doc.reason ?? 'No editable array-of-objects found.'}</p>
          <p className="mt-2">Edit this file as raw JSON instead.</p>
        </div>
      </div>
    );
  }

  const active = doc.blocks[Math.min(activeIdx, doc.blocks.length - 1)];
  const rows = active.rows;
  const columns = columnsOf(rows);

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
    <div className="flex h-full min-h-0 flex-col">
      <Header
        fileName={fileName}
        relPath={relPath}
        dirty={dirty}
        saving={saving}
        onSave={save}
        canSave
        extra={
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus />
            Add row
          </Button>
        }
      />

      {doc.blocks.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {doc.blocks.map((b, i) => (
            <button
              key={b.label}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                i === activeIdx
                  ? 'border-input bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted/50',
              )}
              title={`Edit ${b.label} (${b.rows.length} rows)`}
            >
              <span className="font-mono">{b.label}</span>
              <span className="ml-1 opacity-60">· {b.rows.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {active.path.length > 0 ? `.${active.path.join('.')}` : '(root array)'}
        </span>
        <span>·</span>
        <span>{rows.length} rows</span>
        <span>·</span>
        <span>{columns.length} columns</span>
      </div>

      {saveError ? <div className="mt-2 text-sm text-destructive">{saveError}</div> : null}

      <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No rows yet. Use <span className="font-medium text-foreground">Add row</span> to create one.
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[44px] text-right">#</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key} className="whitespace-nowrap">
                    <span className="font-medium text-foreground">{c.key}</span>
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {c.type}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-[96px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-right text-xs text-muted-foreground">{i}</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="p-1.5 align-middle">
                      <CellEditor
                        type={c.type}
                        value={row[c.key]}
                        onChange={(v) => updateCell(i, c.key, v)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="p-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => moveRow(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Move down"
                        disabled={i === rows.length - 1}
                        onClick={() => moveRow(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        title="Delete row"
                        onClick={() => deleteRow(i)}
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
}: {
  fileName: string;
  relPath: string;
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{fileName}</span>
          {dirty ? (
            <Badge variant="outline" className="border-warning/40 text-warning">
              unsaved
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{relPath}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <Button size="sm" onClick={onSave} disabled={!canSave || !dirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
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
  if (type === 'number') {
    return (
      <Input
        type="number"
        className="h-8"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (type === 'json') {
    // Nested objects/arrays aren't inline-editable in the grid — show a
    // compact, read-only summary. Editing happens in the EntityInspector or
    // raw JSON. (Stubbed intentionally; see report.)
    const summary = Array.isArray(value)
      ? `[ ${value.length} ]`
      : value && typeof value === 'object'
        ? `{ ${Object.keys(value as object).length} }`
        : String(value ?? '');
    return (
      <span
        className="block truncate font-mono text-xs text-muted-foreground"
        title={JSON.stringify(value)}
      >
        {summary}
      </span>
    );
  }
  // string
  return (
    <Input
      type="text"
      className="h-8"
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
