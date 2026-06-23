// Catalog read/write for the studio data editors. Talks to the existing OGF
// daemon (proxied at /api → :7621); no backend changes.
//
// A "catalog" is a data/*.json file. Game catalogs come in a few shapes:
//   - array of objects                  → enemies.json, towers.json, …
//   - single object with top-level `id` → player-config.json (one entity)
//   - record-of-objects (id is the key) → { goblin: {…}, slime: {…} }
//
// The TableEditor only edits true array-of-objects files; the EntityInspector
// edits one row of any of the three shapes (it resolves the row by id). The
// daemon's /api/projects/entities endpoint already normalizes these into a
// flat entity list, which is what listEntities surfaces.
//
// Like lib/api.ts / lib/scene.ts, the wire types are re-declared locally so
// the studio app does NOT depend on @ogf/contracts.

// -------- Wire types (mirror @ogf/contracts) --------

export type FileKind = 'text' | 'image' | 'binary';

/** Mirror of @ogf/contracts ReadFileResponse (GET /api/files/content). */
export interface ReadFileResponse {
  kind: FileKind;
  content?: string;
  base64?: string;
  size: number;
  truncated?: boolean;
}

export type EntityKind =
  | 'player'
  | 'enemy'
  | 'hero'
  | 'boss'
  | 'tower'
  | 'pickup'
  | 'npc'
  | 'projectile'
  | 'item'
  | 'hazard'
  | 'unknown';

export interface EntitySprite {
  action: string;
  relPath: string;
  isPack: boolean;
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  /** Catalog file this entity was discovered from (e.g. data/enemies.json). */
  catalog: string;
  sprites: EntitySprite[];
  broken: boolean;
  /** The raw catalog row, verbatim — the inspector reads stats/display from it. */
  raw: Record<string, unknown>;
}

export interface EntityGroup {
  catalog: string;
  label: string;
  kind: EntityKind;
  entities: Entity[];
}

export interface EntitiesResponse {
  groups: EntityGroup[];
  errors: Array<{ catalog: string; error: string }>;
}

// -------- Fetch helpers --------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** GET /api/files/content — full ReadFileResponse (kind/content/base64/size).
 *  lib/api.ts exposes a narrower `{ content?: string }` version; the data
 *  editors need `kind` to reject binary files, so they use this one. */
export const fetchFileContent = (projectPath: string, relPath: string) =>
  jget<ReadFileResponse>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

export interface WriteFileRequest {
  projectPath: string;
  relPath: string;
  content: string;
}

/** POST /api/files/content — write a project file (overwrites). The daemon
 *  replies { ok, size }. There is no writeFileContent in lib/api.ts, so the
 *  data editors own this helper here (per the porting brief). */
export const writeFileContent = async (req: WriteFileRequest): Promise<{ ok: true; size: number }> => {
  const r = await fetch('/api/files/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`/api/files/content: ${r.status} ${t}`);
  }
  return r.json() as Promise<{ ok: true; size: number }>;
};

// -------- Entities (derived catalog view) --------

/** GET /api/projects/entities — the daemon's derived entity list. Returns a
 *  flat array (groups flattened) so callers can render one list, plus the
 *  per-catalog parse errors so they're surfaced, never hidden. */
export async function listEntities(
  projectPath: string,
): Promise<{ entities: Entity[]; groups: EntityGroup[]; errors: EntitiesResponse['errors'] }> {
  const res = await jget<EntitiesResponse>(
    `/api/projects/entities?projectPath=${encodeURIComponent(projectPath)}`,
  );
  const entities = res.groups.flatMap((g) => g.entities);
  return { entities, groups: res.groups, errors: res.errors };
}

// -------- Catalog (array-of-objects) read/write --------

export type CatalogRow = Record<string, unknown>;

export interface CatalogReadResult {
  /** Parsed rows when the file is an array of objects, else null. */
  rows: CatalogRow[] | null;
  /** The end-of-line style of the on-disk file, preserved on write. */
  eol: '\n' | '\r\n';
  /** Why rows is null (parse error / not array-of-objects / binary), if so. */
  reason?: string;
}

function isPlainObject(v: unknown): v is CatalogRow {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Read a data/*.json catalog and parse it as an array of objects. Non-tabular
 *  JSON (object root, primitives, parse errors) yields rows: null + a reason
 *  so the editor can show a graceful message instead of throwing. */
export async function readCatalog(
  projectPath: string,
  relPath: string,
): Promise<CatalogReadResult> {
  const res = await fetchFileContent(projectPath, relPath);
  if (res.kind !== 'text' || res.content === undefined) {
    return { rows: null, eol: '\n', reason: 'File is not text.' };
  }
  const eol: '\n' | '\r\n' = res.content.includes('\r\n') ? '\r\n' : '\n';
  let data: unknown;
  try {
    data = JSON.parse(res.content);
  } catch (err) {
    return {
      rows: null,
      eol,
      reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(data)) {
    return { rows: null, eol, reason: 'Not an array — this catalog is not a flat table.' };
  }
  if (!data.every(isPlainObject)) {
    return { rows: null, eol, reason: 'Array contains non-object entries.' };
  }
  return { rows: data as CatalogRow[], eol };
}

/** Write rows back to a data/*.json catalog as a pretty-printed array,
 *  preserving the file's original EOL and ending with a trailing newline
 *  (matches the daemon's own writers — see EntityInspector.commitStat). */
export async function writeCatalog(
  projectPath: string,
  relPath: string,
  rows: CatalogRow[],
  eol: '\n' | '\r\n' = '\n',
): Promise<void> {
  const text = JSON.stringify(rows, null, 2).replace(/\n/g, eol) + eol;
  await writeFileContent({ projectPath, relPath, content: text });
}
