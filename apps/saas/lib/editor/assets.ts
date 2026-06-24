// Pure asset-listing model — the hosted-model port of apps/studio/src/lib/
// assets.ts. The studio walked a daemon file-tree endpoint and built static
// web-play URLs; here we derive everything from the flat file list the workspace
// already owns (GET /api/projects/[id]/files) and build thumbnail URLs from the
// byte-accurate draft-preview route. License credits are read (optionally) from
// `data/asset-credits.json`, exactly as the studio does.

export type AssetMediaKind = "image" | "audio";

/** A ledger row from `data/asset-credits.json` (CC0/CC-BY provenance). */
export interface AssetCredit {
  asset: string;
  id?: string;
  source?: string;
  license?: string;
  author?: string | null;
  page?: string | null;
  url?: string | null;
  query?: string;
  fetched_at?: string;
}

export interface AssetItem {
  relPath: string;
  name: string;
  mediaKind: AssetMediaKind;
  credit?: AssetCredit;
}

export type LicenseTone = "cc0" | "cc-by" | "unknown";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const AUDIO_EXTS = new Set(["wav", "mp3", "ogg", "m4a", "flac", "aac"]);

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Classify a path as an editable asset media kind, or null if it isn't one. */
export function assetMediaKind(relPath: string): AssetMediaKind | null {
  const e = ext(relPath);
  if (IMAGE_EXTS.has(e)) return "image";
  if (AUDIO_EXTS.has(e)) return "audio";
  return null;
}

/**
 * Parse the optional `data/asset-credits.json` ledger into a relPath→credit
 * map. The file is an array of rows keyed by their `asset` (project-relative)
 * path. Tolerates a missing/malformed file (returns an empty map). Pure.
 */
export function parseAssetCredits(content: string | null): Map<string, AssetCredit> {
  const map = new Map<string, AssetCredit>();
  if (!content) return map;
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return map;
    for (const row of parsed as AssetCredit[]) {
      if (row && typeof row === "object" && typeof row.asset === "string") {
        map.set(row.asset.replace(/\\/g, "/"), row);
      }
    }
  } catch {
    /* malformed ledger — treat as no credits */
  }
  return map;
}

/**
 * Build the asset list from a flat project file list. Keeps files under
 * `assets/**` that are images or audio, joins any credits, and sorts by
 * relPath — mirroring the studio's `listAssets`. Pure.
 */
export function listAssets(
  files: string[],
  credits: Map<string, AssetCredit> = new Map(),
): AssetItem[] {
  const items: AssetItem[] = [];
  for (const relPath of files) {
    if (!relPath.startsWith("assets/")) continue;
    const kind = assetMediaKind(relPath);
    if (!kind) continue;
    items.push({
      relPath,
      name: relPath.split("/").pop() ?? relPath,
      mediaKind: kind,
      credit: credits.get(relPath),
    });
  }
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Classify a license string into a badge tone. Ported verbatim from studio. */
export function licenseTone(license?: string | null): LicenseTone {
  if (!license) return "unknown";
  const l = license.toLowerCase();
  if (l.includes("cc0") || l.includes("zero") || l.includes("public domain")) return "cc0";
  if (l.includes("by")) return "cc-by";
  return "unknown";
}

/**
 * Byte-accurate thumbnail/preview URL for an asset, served by the owner-scoped
 * draft-preview route. The studio used a daemon web-play mount; the SaaS uses
 * the same draft route the code panel + preview already rely on.
 */
export function assetThumbUrl(projectId: string, relPath: string): string {
  return `/build/${projectId}/preview/${relPath.replace(/\\/g, "/")}`;
}

/** A reference string a user can paste into a level/catalog (the project path). */
export function assetReference(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

// ── Sprite-slice sidecar metadata (port of studio's SliceMetadata) ──

export interface SliceMetadata {
  cols: number;
  rows: number;
  padding: number;
  offsetX: number;
  offsetY: number;
  anchor: "top" | "center" | "bottom" | "feet" | "left" | "right";
  fps: number;
  source: string;
  frameW?: number;
  frameH?: number;
}

/** Sidecar path for a sprite sheet's slice metadata, e.g.
 *  `assets/sprites/walk.png` → `assets/sprites/walk.ogf-slice.json`. Mirrors the
 *  studio's `saveSliceMetadata` naming so the engine reads the same file. */
export function sliceSidecarPath(imageRelPath: string): string {
  return imageRelPath.replace(/\.(png|jpg|jpeg|gif|webp|bmp)$/i, ".ogf-slice.json");
}
