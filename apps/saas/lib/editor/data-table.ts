// Pure data-table model — a faithful port of apps/studio/src/components/
// TableEditor.tsx's parsing/serialization logic, extracted so the React
// component stays thin AND so scripts/data-test.mjs can exercise the
// transforms with zero DOM. No I/O here: callers read/write the file bytes
// through the project file API; these functions only parse/transform/serialize.
//
// Data-format assumptions (mirrored EXACTLY from the studio so the editor reads
// the same generated games):
//   • A data/*.json that is a ROOT array-of-objects → one editable table.
//   • A root OBJECT whose first-level fields are arrays-of-objects (the
//     multi-catalog shape, e.g. { wild: [...], marsh: [...] }) → one table per
//     field (tabs).
//   • An empty root array `[]` → editable (start adding rows).
//   • Anything else → not a table (surface a reason).
//   • EOL of the on-disk file is detected on read and re-applied on save, with a
//     trailing newline, so diffs stay clean (matches the daemon's JSON writers).

export type CatalogRow = Record<string, unknown>;

export type ColumnType = "string" | "number" | "boolean" | "json";

export interface ColumnSpec {
  key: string;
  type: ColumnType;
}

/** One editable array found inside the JSON. A root array has path []; a field
 *  array (e.g. enemies.json → { wild: [...] }) has path [field]. */
export interface ArrayBlock {
  path: string[];
  label: string;
  rows: CatalogRow[];
}

export type Eol = "\n" | "\r\n";

export interface ParsedDoc {
  /** The full parsed JSON, mutated in place on edit then re-serialized. */
  root: unknown;
  /** Editable array-of-objects blocks discovered in the document. */
  blocks: ArrayBlock[];
  /** Preserved EOL of the on-disk file. */
  eol: Eol;
  /** Set when the JSON parses but has no editable array, or fails to parse. */
  reason?: string;
}

export function isPlainObject(v: unknown): v is CatalogRow {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isArrayOfObjects(v: unknown): v is CatalogRow[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

/** Detect the on-disk EOL of a text file (CRLF vs LF). */
export function detectEol(content: string): Eol {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function detectColumnType(rows: CatalogRow[], key: string): ColumnType {
  let allNumber = true;
  let allBoolean = true;
  let nonEmpty = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === undefined || v === null || v === "") continue;
    nonEmpty++;
    if (typeof v !== "number") allNumber = false;
    if (typeof v !== "boolean") allBoolean = false;
    if (v && typeof v === "object") return "json";
  }
  if (nonEmpty === 0) return "string";
  if (allNumber) return "number";
  if (allBoolean) return "boolean";
  return "string";
}

/** Column order = first-seen order across all rows (the generator emits stable
 *  field order, so this matches the on-disk layout for the common case). */
export function columnsOf(rows: CatalogRow[]): ColumnSpec[] {
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

/** Parse the file into editable blocks. Recognizes a root array-of-objects, or
 *  a root object whose first-level fields are arrays-of-objects (the
 *  multi-catalog shape, e.g. { wild: [...], marsh: [...] }). */
export function parseDoc(content: string, eol: Eol): ParsedDoc {
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
    return { root, blocks: [{ path: [], label: "(root array)", rows: root }], eol };
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
    return { root, blocks: [{ path: [], label: "(root array)", rows: root }], eol };
  }
  return {
    root,
    blocks: [],
    eol,
    reason: isPlainObject(root)
      ? "This JSON is an object with no array-of-objects field — not a flat table."
      : "This JSON is not an array of objects.",
  };
}

export function getArray(root: unknown, path: string[]): CatalogRow[] {
  let cur: unknown = root;
  for (const p of path) cur = (cur as Record<string, unknown>)[p];
  return cur as CatalogRow[];
}

export function setArray(root: unknown, path: string[], next: CatalogRow[]): unknown {
  if (path.length === 0) return next;
  const obj = root as Record<string, unknown>;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string, unknown>;
  cur[path[path.length - 1]] = next;
  return obj;
}

export function defaultValueForType(t: ColumnType): unknown {
  if (t === "number") return 0;
  if (t === "boolean") return false;
  if (t === "json") return null;
  return "";
}

/** Stringify a cell value for case-insensitive search matching. */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Compare two cell values: numeric when both are numbers, else string. */
export function compareCells(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellToText(a).localeCompare(cellToText(b), undefined, { numeric: true });
}

/**
 * Re-pretty-print the document with the preserved EOL + trailing newline so the
 * diff stays clean (matches the generator's own JSON writers). Takes the current
 * serialized `content` (already-updated root) and the EOL.
 */
export function serializeDoc(content: string, eol: Eol): string {
  return JSON.stringify(JSON.parse(content), null, 2).replace(/\n/g, eol) + eol;
}

/**
 * Apply a mutation to the active block's array and return the next serialized
 * (2-space, LF) content. Pure: parse → locate block → mutate → reserialize.
 * The component holds `content` as LF-normalized 2-space JSON between edits and
 * only applies the real EOL at save time via serializeDoc().
 */
export function commitToContent(
  content: string,
  eol: Eol,
  activeIdx: number,
  mutator: (rows: CatalogRow[]) => CatalogRow[],
): string {
  const parsed = parseDoc(content, eol);
  const block = parsed.blocks[Math.min(activeIdx, parsed.blocks.length - 1)];
  if (!block) return content;
  const next = mutator(getArray(parsed.root, block.path));
  const nextRoot = setArray(parsed.root, block.path, next);
  return JSON.stringify(nextRoot, null, 2);
}
