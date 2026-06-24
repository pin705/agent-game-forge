/**
 * File-tree helpers for the code editor (CodePanel).
 *
 * The hosted editor lists files as a flat array of repo-relative POSIX paths
 * (GET /api/projects/:id/files → string[]). This module turns that flat list
 * into the nested `FileNode` tree the panel renders, classifies each file as
 * text / image / binary by extension (so binary assets show a notice instead
 * of being dumped into Monaco), and prunes the tree for the search box.
 *
 * Adapted from apps/studio/src/lib/files.ts + CodePanel's filterTree — minus
 * the daemon wire types (we own the storage layer here).
 */

export type FileKind = "text" | "image" | "binary";

export interface FileNode {
  name: string;
  /** POSIX, project-relative. "" for the root node. */
  relPath: string;
  kind: "dir" | "file";
  /** Only on files. */
  fileKind?: FileKind;
  children?: FileNode[];
}

// Extensions we treat as NON-text. Images get an <img> preview; everything else
// binary gets a "no preview" notice. Anything not listed is edited as text.
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
]);
const BINARY_EXTS = new Set([
  "wav",
  "mp3",
  "ogg",
  "oga",
  "m4a",
  "mp4",
  "webm",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "wasm",
  "zip",
  "gz",
  "pdf",
]);

/** Classify a path's content kind from its extension. */
export function fileKindOf(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

/**
 * Build a nested tree from a flat list of POSIX file paths. Folders sort before
 * files; both alphabetically (case-insensitive). The returned node is the
 * synthetic root (relPath "").
 */
export function buildFileTree(paths: string[]): FileNode {
  const root: FileNode = { name: "", relPath: "", kind: "dir", children: [] };

  for (const raw of paths) {
    const parts = raw.split("/").filter(Boolean);
    let cursor = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      cursor.children ??= [];
      let next = cursor.children.find((c) => c.name === part);
      if (!next) {
        next = isLeaf
          ? { name: part, relPath: acc, kind: "file", fileKind: fileKindOf(acc) }
          : { name: part, relPath: acc, kind: "dir", children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node: FileNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const c of node.children) sortTree(c);
}

/** Result of pruning the tree to a case-insensitive `relPath` query. */
export interface FilteredTree {
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
export function filterTree(node: FileNode, query: string): FilteredTree {
  const q = query.trim().toLowerCase();
  const expand = new Set<string>();

  function walk(n: FileNode, isRoot: boolean): FileNode | null {
    if (n.kind === "file") {
      return n.relPath.toLowerCase().includes(q) ? n : null;
    }
    const kids = (n.children ?? [])
      .map((c) => walk(c, false))
      .filter((c): c is FileNode => c !== null);
    const selfMatches = !isRoot && n.relPath.toLowerCase().includes(q);
    if (isRoot || kids.length > 0 || selfMatches) {
      if (!isRoot && (kids.length > 0 || selfMatches)) expand.add(n.relPath);
      return { ...n, children: kids };
    }
    return null;
  }

  return { tree: walk(node, true), expand };
}
