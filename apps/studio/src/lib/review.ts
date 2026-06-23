// Self-contained client for the OGF daemon's review surfaces (proxied at
// /api → :7621). Two flavours of "pending agent output" the user reviews
// before it lands in the project:
//
//   1. Pending slice changes — local `.ogf-slice.json` sidecars the user
//      edited in the slicer. Applied to the engine via a Codex turn.
//      Endpoints: GET/DELETE /api/projects/pending-slices
//
//   2. Pending sprite packs — whole-folder animation regenerations the agent
//      staged under `.ogf/regen/<packDir>`. Applied/discarded directly.
//      Endpoints: GET /api/files/regen/packs,
//                 POST /api/files/regen/apply-pack,
//                 POST /api/files/regen/discard-pack
//
// Like the studio's other lib modules, this does NOT import @ogf/contracts —
// wire types are re-declared locally and mirror packages/contracts/src/api.ts.
// No backend changes; the daemon is reused untouched.

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function jsend<T>(
  url: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Pending slice changes (mirror of @ogf/contracts PendingSliceEntry/UsageHit)
// ---------------------------------------------------------------------------

export interface UsageHit {
  file: string;
  line: number;
  col: number;
  snippet: string;
}

export interface PendingSliceEntry {
  /** Source sprite path, e.g. assets/enemies/scout/sheet-transparent.png. */
  sourcePath: string;
  /** Path of the .ogf-slice.json sidecar. */
  sidecarPath: string;
  cols: number;
  rows: number;
  fps: number;
  anchor: string;
  padding: number;
  offsetX: number;
  offsetY: number;
  frameW?: number;
  frameH?: number;
  mtimeMs: number;
  /** Where the source sprite is referenced in the project. */
  usages: UsageHit[];
}

/** GET /api/projects/pending-slices?projectPath= — list edited-but-unapplied
 *  slice sidecars. */
export const fetchPendingSlices = (projectPath: string) =>
  jget<{ pending: PendingSliceEntry[] }>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
  );

/** DELETE /api/projects/pending-slices?projectPath= — discard ALL pending
 *  slice sidecars (the underlying engine files are untouched).
 *
 *  GAP: the daemon exposes no per-sidecar discard route — this clears every
 *  pending slice for the project at once. The modal therefore offers a single
 *  "Revert all" action rather than per-row discard. (web's PendingChangesModal
 *  shows a per-row discard button that calls an `onDiscardOne(sidecarPath)`
 *  handler the host wires up; no such endpoint exists in this daemon build.) */
export const clearPendingSlices = (projectPath: string) =>
  jsend<{ ok: true; removed: number }>(
    `/api/projects/pending-slices?projectPath=${encodeURIComponent(projectPath)}`,
    'DELETE',
  );

// ---------------------------------------------------------------------------
// Pending sprite packs (mirror of @ogf/contracts PendingPack/PackLayout)
// ---------------------------------------------------------------------------

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
  /** Layout of the staged pack. */
  stagingLayout: PackLayout | null;
  /** Layout of the live pack pre-apply (for diff). */
  liveLayout: PackLayout | null;
}

export interface ApplyPackResponse {
  applied: string[];
  failed: Array<{ relPath: string; err: string }>;
}

export interface DiscardPackResponse {
  discarded: string[];
}

/** GET /api/files/regen/packs?projectPath= — list staged regen packs. */
export const fetchPendingPacks = (projectPath: string) =>
  jget<{ packs: PendingPack[] }>(
    `/api/files/regen/packs?projectPath=${encodeURIComponent(projectPath)}`,
  );

/** POST /api/files/regen/apply-pack — copy a staged pack over the live files. */
export const applyPack = (projectPath: string, packDir: string) =>
  jsend<ApplyPackResponse>('/api/files/regen/apply-pack', 'POST', {
    projectPath,
    packDir,
  });

/** POST /api/files/regen/discard-pack — delete a staged pack (live untouched). */
export const discardPack = (projectPath: string, packDir: string) =>
  jsend<DiscardPackResponse>('/api/files/regen/discard-pack', 'POST', {
    projectPath,
    packDir,
  });

// ---------------------------------------------------------------------------
// File content (sheet.png previews for the pack-diff). Re-declared here so the
// review surface has a single import; mirrors lib/files.ts#fetchFileContent.
// ---------------------------------------------------------------------------

export type FileKind = 'text' | 'image' | 'binary';

export interface ReadFileResponse {
  kind: FileKind;
  content?: string;
  /** base64 (no data: prefix) when kind === 'image'. */
  base64?: string;
  size: number;
  truncated?: boolean;
}

/** GET /api/files/content?projectPath=&relPath= — read one file. */
export const fetchFileContent = (projectPath: string, relPath: string) =>
  jget<ReadFileResponse>(
    `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
  );

// ---------------------------------------------------------------------------
// Prompt builders — ported from web's modals. The studio applies slice edits
// to engine code by handing the user a ready-to-send Codex prompt (there's no
// "apply slices" endpoint; only the agent can patch arbitrary code/data).
// ---------------------------------------------------------------------------

/** Build a single Codex prompt covering every pending slice change. */
export function buildBatchPrompt(
  pending: PendingSliceEntry[],
  engine?: string,
): string {
  const updateLine =
    engine === 'godot'
      ? 'For each, please update the relevant Godot config (typically `frame_cols` / `frame_rows` / `animation_fps` in scenes, scripts, or `.tres` files) so the game uses the new values.'
      : engine === 'web'
        ? 'For each, please update the web project so the game uses the new values. Sheets are typically sliced via fields like `cols` / `rows` / `fps` / `frameWidth` / `frameHeight` / `anchor` / `offset` in a `data/*.json` catalog or a constant in `src/*.js` (preserve existing field names — don\'t rename them).'
        : 'For each, please update the project so the game uses the new values. Look at the per-sheet usages below to find the slicing config and update cols / rows / fps / anchor / offset to match.';
  const lines: string[] = [
    '# Apply pending sprite slicing changes',
    '',
    `I have ${pending.length} sprite sheet${pending.length === 1 ? '' : 's'} whose slicing config was edited locally in OGF.`,
    updateLine,
    '',
    'Plan first (list the exact edits you would make). After I confirm, apply them.',
    'Once applied successfully, delete the `.ogf-slice.json` sidecar for that sheet so OGF stops showing it as pending.',
    '',
    '## Pending changes',
    '',
  ];

  pending.forEach((p, i) => {
    lines.push(`### ${i + 1}. \`${p.sourcePath}\``);
    lines.push('');
    const detail = `**${p.cols} × ${p.rows}** at ${p.fps} fps · anchor: ${p.anchor}`;
    const extra =
      p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0
        ? ` · padding ${p.padding}, offset (${p.offsetX}, ${p.offsetY})`
        : '';
    lines.push(`Target slicing: ${detail}${extra}`);
    if (p.frameW && p.frameH) {
      lines.push(`Frame size: ${p.frameW} × ${p.frameH}px`);
    }
    lines.push(`Sidecar to delete after applying: \`${p.sidecarPath}\``);
    if (p.usages.length > 0) {
      lines.push('');
      lines.push('References:');
      for (const u of p.usages) {
        lines.push(`- \`${u.file}:${u.line}\`  ${u.snippet}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}

/** Build a follow-up Codex prompt to patch slicing in code/data after a pack
 *  whose layout changed was applied. */
export function buildCodeUpdatePrompt(pack: PendingPack): string {
  const segs = pack.packDir.split('/');
  const action = segs[segs.length - 1];
  const entity = segs[segs.length - 2];
  const lines: string[] = [];
  lines.push(
    `The user just applied a regenerated animation pack for **${entity} / ${action}** at \`${pack.packDir}/\`.`,
  );
  lines.push('');
  lines.push('The new layout differs from the previous one:');
  lines.push('');
  lines.push('| Field | Was | Now |');
  lines.push('|-------|-----|-----|');
  const rows: Array<[string, unknown, unknown]> = [
    ['frames', pack.liveLayout?.frames, pack.stagingLayout?.frames],
    [
      'grid',
      pack.liveLayout && pack.liveLayout.cols && pack.liveLayout.rows
        ? `${pack.liveLayout.cols}×${pack.liveLayout.rows}`
        : '?',
      pack.stagingLayout && pack.stagingLayout.cols && pack.stagingLayout.rows
        ? `${pack.stagingLayout.cols}×${pack.stagingLayout.rows}`
        : '?',
    ],
    ['cell_size (px)', pack.liveLayout?.cellSize, pack.stagingLayout?.cellSize],
    ['fps', pack.liveLayout?.fps, pack.stagingLayout?.fps],
  ];
  for (const [field, was, now] of rows) {
    const wasStr = was === null || was === undefined ? '?' : String(was);
    const nowStr = now === null || now === undefined ? '?' : String(now);
    if (wasStr !== nowStr) lines.push(`| ${field} | ${wasStr} | ${nowStr} |`);
  }
  lines.push('');
  lines.push(
    'Update the slicing config wherever this pack is referenced in the project so the engine renders the new layout. Likely places to look:',
  );
  lines.push(
    `- \`data/enemies.json\` / \`data/towers.json\` / \`data/heroes.json\` etc. — the catalog row for \`${entity}\`. Look for fields like \`displayW\`, \`displayH\`, \`animations.${action}.frames\`, \`frameW\`, \`frameH\`, \`fps\`, \`cols\`, \`rows\`.`,
  );
  lines.push(
    `- \`src/**/*.js\` — search for \`${entity}\` references and the previous numeric values (\`${pack.liveLayout?.cellSize ?? '?'}\`, \`${pack.liveLayout?.frames ?? '?'}\`, \`${pack.liveLayout?.fps ?? '?'}\`) wherever this sheet is loaded.`,
  );
  lines.push(`- \`${pack.packDir}/sheet.ogf-slice.json\` if it exists — the OGF-side slice sidecar.`);
  lines.push('');
  lines.push(
    "Stay focused. ONLY patch slicing config tied to this entity / action. Don't restyle the catalog, don't tune stats, don't touch unrelated entities. Show the diff for review.",
  );
  return lines.join('\n');
}

/** True when two pack layouts differ in a way that needs a code update. */
export function layoutDiffers(
  a: PackLayout | null,
  b: PackLayout | null,
): boolean {
  if (!a || !b) return false; // unknown — don't claim a change
  return (
    a.cols !== b.cols ||
    a.rows !== b.rows ||
    a.frames !== b.frames ||
    a.cellSize !== b.cellSize ||
    a.fps !== b.fps
  );
}
