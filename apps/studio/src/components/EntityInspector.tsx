import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  fetchFileContent,
  writeFileContent,
  type CatalogRow,
} from '@/lib/catalog';

interface EntityInspectorProps {
  /** Absolute project path. */
  projectPath: string;
  /** Project-relative catalog file (e.g. data/enemies.json). */
  catalog: string;
  /** Entity id (the row's `id`, or its key in a record-shaped catalog). */
  id: string;
  /** Optional: notify the host after a successful save (re-fetch entities). */
  onSaved?: () => void;
}

/** A single editable field, flattened from the entity row. Nested stat
 *  objects are surfaced one level deep with a `parent.child` key. */
interface FieldRow {
  key: string;
  path: string[];
  /** 'number' | 'string' | 'boolean' — drives the input + parse on save. */
  type: 'number' | 'string' | 'boolean';
}

// Structural fields shown read-only in the header rather than as editable
// stats (id/name are identity; sprite/animation paths aren't stats).
const META_FIELDS = new Set([
  'id',
  'name',
  'label',
  'title',
  'kind',
  'sprite',
  'sheet',
  'image',
  'icon',
  'sheetPath',
  'animations',
]);

function scalarType(v: unknown): FieldRow['type'] | null {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  return null;
}

/** Flatten editable scalar fields out of a row. Top-level scalars become
 *  rows; nested objects (stats, hitbox, movement, …) are surfaced one level
 *  deep as `group.child`. Arrays and deeper nesting are left to raw JSON. */
function flattenFields(row: CatalogRow): { groups: Array<{ group: string | null; fields: FieldRow[] }> } {
  const top: FieldRow[] = [];
  const nested: Array<{ group: string; fields: FieldRow[] }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (META_FIELDS.has(k)) continue;
    const t = scalarType(v);
    if (t) {
      top.push({ key: k, path: [k], type: t });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const fields: FieldRow[] = [];
      for (const [k2, v2] of Object.entries(v as CatalogRow)) {
        const t2 = scalarType(v2);
        if (t2) fields.push({ key: k2, path: [k, k2], type: t2 });
      }
      if (fields.length > 0) nested.push({ group: k, fields });
    }
  }
  const groups: Array<{ group: string | null; fields: FieldRow[] }> = [];
  if (top.length > 0) groups.push({ group: null, fields: top });
  groups.push(...nested);
  return { groups };
}

/** Find a row by id across the three catalog shapes (mirrors the daemon's
 *  rowsOf): array-of-objects, single object with top-level id, or a
 *  record-of-objects where the id is the key. Returns the row plus the path
 *  to it within the parsed JSON so a save can write back in place. */
function locateRow(
  root: unknown,
  id: string,
): { row: CatalogRow; rowPath: Array<string | number> } | null {
  if (Array.isArray(root)) {
    const idx = root.findIndex(
      (r) => r && typeof r === 'object' && (r as CatalogRow).id === id,
    );
    if (idx >= 0) return { row: root[idx] as CatalogRow, rowPath: [idx] };
    return null;
  }
  if (root && typeof root === 'object') {
    const obj = root as CatalogRow;
    // Single-entity catalog (player-config.json): the object IS the row.
    if (typeof obj.id === 'string' && obj.id === id) return { row: obj, rowPath: [] };
    // Record-of-objects: id is the key.
    const v = obj[id];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return { row: v as CatalogRow, rowPath: [id] };
    }
  }
  return null;
}

function getAt(root: unknown, path: Array<string | number>): unknown {
  let cur: unknown = root;
  for (const p of path) cur = (cur as Record<string | number, unknown>)[p];
  return cur;
}

export function EntityInspector({ projectPath, catalog, id, onSaved }: EntityInspectorProps) {
  const [root, setRoot] = useState<unknown>(null);
  const [eol, setEol] = useState<'\n' | '\r\n'>('\n');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Edited values keyed by joined path; values held as strings while editing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoot(null);
    setLoadError(null);
    setNotFound(false);
    setDrafts({});
    setSaveError(null);
    fetchFileContent(projectPath, catalog)
      .then((r) => {
        if (cancelled) return;
        if (r.kind !== 'text' || r.content === undefined) {
          setLoadError('Catalog is not editable text.');
          return;
        }
        setEol(r.content.includes('\r\n') ? '\r\n' : '\n');
        try {
          const parsed = JSON.parse(r.content);
          setRoot(parsed);
          if (!locateRow(parsed, id)) setNotFound(true);
        } catch (err) {
          setLoadError(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, catalog, id]);

  const located = useMemo(() => (root === null ? null : locateRow(root, id)), [root, id]);
  const row = located?.row ?? null;

  const name = useMemo(() => {
    if (!row) return id;
    const n = row.name ?? row.label ?? row.title;
    return typeof n === 'string' && n ? n : id;
  }, [row, id]);

  const kind = typeof row?.kind === 'string' ? (row.kind as string) : null;
  const { groups } = useMemo(() => (row ? flattenFields(row) : { groups: [] }), [row]);

  const draftKey = (path: string[]) => path.join('.');
  const currentString = useCallback(
    (path: string[]): string => {
      const k = draftKey(path);
      if (k in drafts) return drafts[k];
      const v = located ? getAt(root, [...located.rowPath, ...path]) : undefined;
      return v == null ? '' : String(v);
    },
    [drafts, located, root],
  );

  const dirty = Object.keys(drafts).length > 0;

  function setDraft(path: string[], value: string) {
    setDrafts((d) => ({ ...d, [draftKey(path)]: value }));
    setSaveError(null);
  }

  async function save() {
    if (!located || root === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Deep-clone so we never mutate the live state before the write lands.
      const next = JSON.parse(JSON.stringify(root)) as unknown;
      const located2 = locateRow(next, id);
      if (!located2) throw new Error(`row ${id} not found in catalog`);
      for (const [k, raw] of Object.entries(drafts)) {
        const path = k.split('.');
        const field = findFieldType(groups, path);
        let parsed: unknown = raw;
        if (field === 'number') {
          const num = Number(raw);
          if (raw.trim() === '' || Number.isNaN(num)) throw new Error(`${k}: not a number`);
          parsed = num;
        } else if (field === 'boolean') {
          parsed = raw === 'true';
        }
        // Walk to the parent and set the leaf. Every segment but the last
        // already exists (the path came from the loaded row).
        let cursor = located2.row as Record<string, unknown>;
        for (let i = 0; i < path.length - 1; i++) {
          const seg = cursor[path[i]];
          if (!seg || typeof seg !== 'object') throw new Error(`bad path at ${path[i]}`);
          cursor = seg as Record<string, unknown>;
        }
        cursor[path[path.length - 1]] = parsed;
      }
      const text = JSON.stringify(next, null, 2).replace(/\n/g, eol) + eol;
      await writeFileContent({ projectPath, relPath: catalog, content: text });
      setRoot(next);
      setDrafts({});
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <div className="p-6 text-sm text-destructive">Failed to load {catalog}: {loadError}</div>;
  }
  if (root === null) {
    return <div className="p-6 text-sm text-muted-foreground">Loading {id}…</div>;
  }
  if (notFound || !row) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Entity <span className="font-mono text-foreground">{id}</span> not found in{' '}
        <span className="font-mono">{catalog}</span>.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{name}</h2>
            {kind ? <Badge variant="secondary">{kind}</Badge> : null}
            {dirty ? (
              <Badge variant="outline" className="border-warning/40 text-warning">
                unsaved
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono">{id}</span> · {catalog}
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || saving} className="shrink-0">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>

      {saveError ? <div className="mt-2 text-sm text-destructive">{saveError}</div> : null}

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {groups.length === 0 ? (
          <div className="rounded-lg border p-6 text-sm text-muted-foreground">
            No editable scalar fields on this entity. Edit it as raw JSON instead.
          </div>
        ) : (
          groups.map((g) => (
            <Card key={g.group ?? '__top'}>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium capitalize">
                  {g.group ?? 'Fields'}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-2 p-4 pt-2">
                {g.fields.map((f) => {
                  const k = draftKey(f.path);
                  const isDirty = k in drafts;
                  if (f.type === 'boolean') {
                    return (
                      <div key={k} className="contents">
                        <Label className="self-center text-muted-foreground">{f.key}</Label>
                        <div className="self-center">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={currentString(f.path) === 'true'}
                            onChange={(e) => setDraft(f.path, String(e.target.checked))}
                          />
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={k} className="contents">
                      <Label htmlFor={`f-${k}`} className="self-center text-muted-foreground">
                        {f.key}
                      </Label>
                      <Input
                        id={`f-${k}`}
                        type={f.type === 'number' ? 'number' : 'text'}
                        className={cn('h-8', isDirty && 'border-warning/60')}
                        value={currentString(f.path)}
                        onChange={(e) => setDraft(f.path, e.target.value)}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function findFieldType(
  groups: Array<{ group: string | null; fields: FieldRow[] }>,
  path: string[],
): FieldRow['type'] {
  const k = path.join('.');
  for (const g of groups) {
    for (const f of g.fields) {
      if (f.path.join('.') === k) return f.type;
    }
  }
  return 'string';
}
