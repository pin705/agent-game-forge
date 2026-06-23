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
