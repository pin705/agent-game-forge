// Asset listing + project actions for the studio app. Talks to the existing
// OGF daemon (proxied at /api → :7621); no backend changes.
//
// Assets come from walking /api/files/tree for image/audio files under
// assets/**. Attribution is read from data/asset-credits.json — the broker's
// ledger written by fetch-asset.py (an array of { asset, id, source, license,
// author, page, url, ... }). The `asset` field is the project-relative path,
// which is how we join a credit row to a tree file.

// -------- File tree (mirrors the daemon's FileNode contract) --------

export type FileKind = 'text' | 'image' | 'binary';

export interface FileNode {
  name: string;
  relPath: string; // POSIX, '' for root
  kind: 'dir' | 'file';
  fileKind?: FileKind;
  size?: number;
  mtimeMs?: number;
  children?: FileNode[];
}

// -------- Asset-credits.json ledger row (written by fetch-asset.py) --------

export interface AssetCredit {
  /** project-relative path of the fetched file, e.g. assets/sprites/foo.png */
  asset: string;
  id: string;
  source: string;
  /** 'CC0', 'CC-BY 4.0', 'OGA-BY 3.0', ... */
  license: string;
  author: string | null;
  page?: string | null;
  url?: string | null;
  query?: string;
  fetched_at?: string;
}

// -------- Asset row surfaced to the UI --------

export type AssetMediaKind = 'image' | 'audio';

export interface AssetItem {
  /** project-relative POSIX path, e.g. assets/audio/jump.wav */
  relPath: string;
  name: string;
  mediaKind: AssetMediaKind;
  size?: number;
  /** Matching credit row from data/asset-credits.json, if any. */
  credit?: AssetCredit;
}

const AUDIO_EXTS = new Set(['wav', 'mp3', 'ogg', 'm4a', 'flac', 'aac']);

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function jsend<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

// -------- Thumbnail / static file URL --------
// Mirrors apps/web's projectFileUrl: the daemon mounts each registered web
// project under /api/web-play/<base64url(projectPath)>/<relPath>, so an <img>
// src resolves to the real file on disk.

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Static URL for any project file (image/audio src) via the daemon's
 *  web-play static mount. Works for registered web projects. */
export function assetUrl(projectPath: string, relPath: string): string {
  return `/api/web-play/${base64Url(projectPath)}/${relPath.replace(/\\/g, '/')}`;
}

// -------- Listing --------

function flatten(node: FileNode | null): FileNode[] {
  const out: FileNode[] = [];
  const walk = (n: FileNode) => {
    if (n.kind === 'file') out.push(n);
    else for (const c of n.children ?? []) walk(c);
  };
  if (node) walk(node);
  return out;
}

/** Read + parse data/asset-credits.json. Returns a map keyed by the
 *  project-relative asset path. Missing/malformed ledger → empty map. */
export async function fetchAssetCredits(
  projectPath: string,
): Promise<Map<string, AssetCredit>> {
  const map = new Map<string, AssetCredit>();
  try {
    const r = await jget<{ content?: string }>(
      `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent('data/asset-credits.json')}`,
    );
    const parsed = JSON.parse(r.content ?? '[]');
    if (Array.isArray(parsed)) {
      for (const it of parsed as AssetCredit[]) {
        if (it && typeof it.asset === 'string') {
          map.set(it.asset.replace(/\\/g, '/'), it);
        }
      }
    }
  } catch {
    // No ledger yet (or unreadable) — assets simply show without credits.
  }
  return map;
}

/** List a project's image + audio assets under assets/**, each joined to its
 *  attribution row from data/asset-credits.json when present. */
export async function listAssets(projectPath: string): Promise<AssetItem[]> {
  const [treeRes, credits] = await Promise.all([
    jget<{ tree: FileNode }>(
      `/api/files/tree?projectPath=${encodeURIComponent(projectPath)}`,
    ),
    fetchAssetCredits(projectPath),
  ]);

  const files = flatten(treeRes.tree);
  const items: AssetItem[] = [];
  for (const f of files) {
    if (!f.relPath.startsWith('assets/')) continue;
    const e = ext(f.name);
    let mediaKind: AssetMediaKind | null = null;
    if (f.fileKind === 'image') mediaKind = 'image';
    else if (AUDIO_EXTS.has(e)) mediaKind = 'audio';
    if (!mediaKind) continue;

    items.push({
      relPath: f.relPath,
      name: f.name,
      mediaKind,
      size: f.size,
      credit: credits.get(f.relPath),
    });
  }
  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return items;
}

// -------- License classification (for the badge) --------

export type LicenseTone = 'cc0' | 'cc-by' | 'unknown';

/** Normalize a license string into a tone for badge styling.
 *  CC0 / public-domain → 'cc0'; any CC-BY / OGA-BY → 'cc-by'. */
export function licenseTone(license?: string | null): LicenseTone {
  if (!license) return 'unknown';
  const l = license.toLowerCase();
  if (l.includes('cc0') || l.includes('zero') || l.includes('public domain')) return 'cc0';
  if (l.includes('by')) return 'cc-by';
  return 'unknown';
}

// -------- Project actions (mirror the daemon) --------

/** DELETE /api/projects?path= — unregisters the project (does not delete
 *  files on disk; matches the daemon's deleteProject). */
export function deleteProject(path: string): Promise<{ ok: true }> {
  return jsend<{ ok: true }>(
    `/api/projects?path=${encodeURIComponent(path)}`,
    'DELETE',
  );
}

/** POST /api/projects/rename — renames the project's display name. */
export function renameProject(
  path: string,
  name: string,
): Promise<{ project: { path: string; name: string; engine: string } | null }> {
  return jsend('/api/projects/rename', 'POST', { path, name });
}

// -------- Publish --------
// NOTE: No HTTP publish endpoint exists on the daemon. "Publish" is an
// agent-driven pipeline stage (apps/daemon/src/templates/pipelines/stages/
// publish-director.md), not an /api route. The UI surfaces Publish as a
// clearly-labeled stub until a route exists.
export const PUBLISH_AVAILABLE = false;

// =========================================================================
// Asset-workflow clients (Dropzone / SpriteSlicer / Regenerate / PackReview)
//
// These mirror apps/web/src/lib/api.ts but stay self-contained: the studio
// does not import @ogf/contracts, so the request/response shapes the asset
// modals need are declared here. All endpoints already exist on the daemon
// (see apps/daemon/src/server.ts) — no backend changes.
// =========================================================================

// ── Reference images (uploadRef / deleteRef / listRefs) ──

export interface RefImage {
  /** project-relative POSIX path of the uploaded reference */
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** GET /api/files/refs — list reference images already uploaded for a project. */
export async function listRefs(projectPath: string): Promise<RefImage[]> {
  const r = await jget<{ refs?: RefImage[] }>(
    `/api/files/refs?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return r.refs ?? [];
}

/** POST /api/files/refs — upload one reference image (base64, no data-URL prefix). */
export function uploadRef(req: {
  projectPath: string;
  filename: string;
  base64: string;
}): Promise<{ relPath: string; size: number }> {
  return jsend('/api/files/refs', 'POST', req);
}

/** DELETE /api/files/refs — remove one uploaded reference image. */
export function deleteRef(
  projectPath: string,
  relPath: string,
): Promise<{ ok: true }> {
  return jsend(
    `/api/files/refs?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
    'DELETE',
  );
}

/** Read a File as base64 (without the `data:...;base64,` prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── File content as base64 (for canvas / <img> data URLs) ──
//
// assets.ts already exposes assetUrl() for plain <img src>, but the slicer
// canvas + pack diff need the bytes as a data URL (avoids CORS/streaming
// surprises and works for staged files under .ogf/). The daemon's
// /api/files/content returns { base64 } for image files.

export interface ReadFileResult {
  kind?: 'text' | 'image' | 'binary';
  content?: string;
  base64?: string;
}

/** GET /api/files/content — raw read (text or base64 image payload). */
export function readFile(
  projectPath: string,
  relPath: string,
): Promise<ReadFileResult> {
  return jget<ReadFileResult>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );
}

/** Convenience: read an image file as a ready-to-use data URL, or null. */
export async function imageDataUrl(
  projectPath: string,
  relPath: string,
): Promise<string | null> {
  try {
    const r = await readFile(projectPath, relPath);
    if (r.kind && r.kind !== 'image') return null;
    if (!r.base64) return null;
    const e = ext(relPath);
    const mime = e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : `image/${e || 'png'}`;
    return `data:${mime};base64,${r.base64}`;
  } catch {
    return null;
  }
}

/** POST /api/files/content — write a text file (used to save slice sidecars). */
export function writeFile(req: {
  projectPath: string;
  relPath: string;
  content: string;
}): Promise<{ ok: true; size: number }> {
  return jsend('/api/files/content', 'POST', req);
}

// ── File tree (for sibling/pack discovery in the regenerate modal) ──

/** GET /api/files/tree — the full project file tree. */
export function fetchFileTree(projectPath: string): Promise<{ tree: FileNode }> {
  return jget<{ tree: FileNode }>(
    `/api/files/tree?projectPath=${encodeURIComponent(projectPath)}`,
  );
}

// ── Sprite-slice sidecar metadata ──

export interface SliceMetadata {
  cols: number;
  rows: number;
  padding: number;
  offsetX: number;
  offsetY: number;
  anchor: 'top' | 'center' | 'bottom' | 'feet' | 'left' | 'right';
  fps: number;
  /** Relative path of the source sprite this metadata describes. */
  source: string;
  /** Pixel width / height of one frame, computed at save-time. */
  frameW?: number;
  frameH?: number;
}

/** Write the `<image>.ogf-slice.json` sidecar next to a sprite sheet. */
export function saveSliceMetadata(
  projectPath: string,
  imageRelPath: string,
  metadata: SliceMetadata,
): Promise<{ ok: true; size: number }> {
  const sidecar = imageRelPath.replace(
    /\.(png|jpg|jpeg|gif|webp|bmp)$/i,
    '.ogf-slice.json',
  );
  return writeFile({
    projectPath,
    relPath: sidecar,
    content: JSON.stringify(metadata, null, 2),
  });
}

// ── Regenerate staging (single file) ──

export function regenExists(
  projectPath: string,
  relPath: string,
): Promise<{ exists: boolean; size?: number; base64?: string }> {
  return jget(
    `/api/files/regen/exists?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );
}

export function applyRegen(
  projectPath: string,
  relPath: string,
): Promise<{ ok: true }> {
  return jsend('/api/files/regen/apply', 'POST', { projectPath, relPath });
}

export function discardRegen(
  projectPath: string,
  relPath: string,
): Promise<{ ok: true }> {
  return jsend('/api/files/regen/discard', 'POST', { projectPath, relPath });
}

// ── Animation pack staging (whole-folder regen) ──

export interface PackLayout {
  cols: number;
  rows: number;
  frames: number;
  cellSize: number | null;
  fps: number | null;
  anchor: string | null;
}

export interface PendingPack {
  /** Project-relative directory (e.g. assets/sprites/scout/idle). */
  packDir: string;
  fileCount: number;
  stagingLayout: PackLayout | null;
  liveLayout: PackLayout | null;
}

/** GET /api/files/regen/packs — list pending (staged) animation packs. */
export async function fetchPendingPacks(
  projectPath: string,
): Promise<PendingPack[]> {
  const r = await jget<{ packs?: PendingPack[] }>(
    `/api/files/regen/packs?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return r.packs ?? [];
}

export function applyPack(req: {
  projectPath: string;
  packDir: string;
}): Promise<{ applied: string[]; failed: Array<{ relPath: string; err: string }> }> {
  return jsend('/api/files/regen/apply-pack', 'POST', req);
}

export function discardPack(req: {
  projectPath: string;
  packDir: string;
}): Promise<{ discarded: string[] }> {
  return jsend('/api/files/regen/discard-pack', 'POST', req);
}
