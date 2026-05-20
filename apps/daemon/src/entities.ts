// Asset-centric discovery — derives `entities` and `scenes` from the
// project's existing catalog JSON + level registry. Pure read; never
// writes. Powers the asset-centric sidebar (see
// docs/asset-centric-view-plan.md). If discovery fails for a file it is
// surfaced as an error, never silently dropped.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  Entity,
  EntityGroup,
  EntityKind,
  EntitySprite,
  SceneSummary,
} from '@ogf/contracts';

// Known catalog files → entity kind + lane label. Order = lane order.
const CATALOG_SPEC: Array<{ file: string; kind: EntityKind; label: string }> = [
  { file: 'player.json', kind: 'player', label: 'Player' },
  // Some genres (side-scroll) scaffold the player as a single-object
  // `player-config.json` rather than a `player.json` catalog.
  { file: 'player-config.json', kind: 'player', label: 'Player' },
  { file: 'heroes.json', kind: 'hero', label: 'Heroes' },
  { file: 'starters.json', kind: 'hero', label: 'Starters' },
  { file: 'enemies.json', kind: 'enemy', label: 'Enemies' },
  { file: 'bosses.json', kind: 'boss', label: 'Bosses' },
  { file: 'towers.json', kind: 'tower', label: 'Towers' },
  { file: 'npcs.json', kind: 'npc', label: 'NPCs' },
  { file: 'pickups.json', kind: 'pickup', label: 'Pickups' },
  { file: 'hazards.json', kind: 'hazard', label: 'Hazards' },
  { file: 'projectiles.json', kind: 'projectile', label: 'Projectiles' },
  { file: 'items.json', kind: 'item', label: 'Items' },
];

// data/*.json files that are NOT entity catalogs. Mirrors the blacklist
// in apps/web/src/App.tsx (DATA_CATALOG_NAMES / isCatalogName) so the
// asset-centric view and the scene heuristic agree on what's an entity.
const NON_ENTITY_JSON = new Set([
  'levels.json',
  'assets.json',
  'maps.json',
  'runtime.json',
  'ui.json',
  'quests.json',
  'dialogues.json',
  'dialogue.json',
  'waves.json',
  'recipes.json',
  'music-themes.json',
  'encounters.json',
  'fx.json',
  'progression-config.json',
]);

function isNonEntityJson(base: string): boolean {
  const lower = base.toLowerCase();
  if (NON_ENTITY_JSON.has(lower)) return true;
  if (/-collision-map\.json$/i.test(lower)) return true;
  if (/-config\.json$/i.test(lower)) return true;
  if (/-strings\.json$/i.test(lower)) return true;
  if (/\.ogf-slice\.json$/i.test(lower)) return true;
  return false;
}

function readJson(rootAbs: string, rel: string): unknown {
  const abs = path.join(rootAbs, rel);
  if (!existsSync(abs)) return undefined;
  return JSON.parse(readFileSync(abs, 'utf8'));
}

/** Normalize a catalog into rows. Handles three shapes:
 *  - array of objects               → the objects, as-is
 *  - single object with top-level `id` → ONE row (single-entity catalog,
 *    e.g. player-config.json). Without this check a player file would
 *    explode into fake "size"/"stats"/"movement" entities.
 *  - record-of-objects (no top-level id) → entries, id injected from key */
function rowsOf(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) {
    return json.filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && !Array.isArray(r),
    );
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (typeof obj.id === 'string' && obj.id) return [obj];
    return Object.entries(obj)
      .filter(([, v]) => !!v && typeof v === 'object' && !Array.isArray(v))
      .map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
  }
  return [];
}

/** True when JSON is an entity catalog in ARRAY form — every element is
 *  an object that ALREADY carries its own string `id`. Used only for
 *  dynamic discovery of unknown data/*.json. The record form is NOT
 *  accepted dynamically: a level file `{ mapSize:{}, spawn:{} }` would
 *  otherwise look like a catalog of "mapSize"/"spawn" entities, because
 *  rowsOf() injects an id from each key. */
function looksLikeDynamicCatalog(json: unknown): boolean {
  if (!Array.isArray(json) || json.length === 0) return false;
  return json.every((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const id = (r as Record<string, unknown>).id;
    return typeof id === 'string' && id.length > 0;
  });
}

/** True when a catalog row declares an intent to have sprites — has a
 *  non-empty `animations` object or a non-null sprite-path field. An
 *  entity is only "broken" when it declared sprites but none resolved;
 *  a logic-only entity (invisible kill-zone, `sprite: null`) is simply
 *  art-less, not broken. */
function declaresSprites(row: Record<string, unknown>): boolean {
  const a = row.animations;
  if (a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length > 0) {
    return true;
  }
  for (const f of ['sprite', 'sheet', 'image', 'icon', 'sheetPath']) {
    if (asString(row[f])) return true;
  }
  return false;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** A dir is an animation pack when it carries sheet.png + pipeline-meta.json. */
function isPackDir(rootAbs: string, relDir: string): boolean {
  const abs = path.join(rootAbs, relDir);
  return (
    existsSync(path.join(abs, 'sheet.png')) &&
    existsSync(path.join(abs, 'pipeline-meta.json'))
  );
}

/** Resolve the sprites for one catalog row. Tries, in order:
 *  1. row.animations: { <action>: { path } | "<path>" }
 *  2. row.sprite / sheet / image / icon string
 *  3. glob assets/sprites/<id>/ for pack subdirs or PNGs   */
function spritesFor(
  rootAbs: string,
  id: string,
  row: Record<string, unknown>,
): EntitySprite[] {
  const out: EntitySprite[] = [];
  const seen = new Set<string>();
  const push = (action: string, relPath: string) => {
    const norm = relPath.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ action, relPath: norm, isPack: isPackDir(rootAbs, path.posix.dirname(norm)) });
  };

  // 1. animations object
  const anims = row.animations;
  if (anims && typeof anims === 'object' && !Array.isArray(anims)) {
    for (const [action, val] of Object.entries(anims as Record<string, unknown>)) {
      if (typeof val === 'string') {
        push(action, val);
      } else if (val && typeof val === 'object') {
        const v = val as Record<string, unknown>;
        const p =
          asString(v.sprite) ??
          asString(v.path) ??
          asString(v.sheet) ??
          asString(v.image);
        if (p) push(action, p);
      }
    }
  }

  // 2. single sprite/sheet/image/icon field
  if (out.length === 0) {
    for (const field of ['sprite', 'sheet', 'image', 'icon', 'sheetPath']) {
      const p = asString(row[field]);
      if (p) {
        push(field === 'icon' ? 'icon' : 'sprite', p);
        break;
      }
    }
  }

  // 3. folder convention: assets/sprites/<id>/
  if (out.length === 0) {
    const spriteDir = `assets/sprites/${id}`;
    const abs = path.join(rootAbs, spriteDir);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      for (const entry of readdirSync(abs)) {
        const childRel = `${spriteDir}/${entry}`;
        const childAbs = path.join(rootAbs, childRel);
        let st;
        try {
          st = statSync(childAbs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          const sheet = `${childRel}/sheet.png`;
          if (existsSync(path.join(rootAbs, sheet))) push(entry, sheet);
        } else if (/\.png$/i.test(entry) && !/^raw[-.]/i.test(entry)) {
          push(entry.replace(/\.png$/i, ''), childRel);
        }
      }
    }
  }

  return out;
}

function entityName(row: Record<string, unknown>, id: string): string {
  return asString(row.name) ?? asString(row.label) ?? asString(row.title) ?? id;
}

function titleCase(slug: string): string {
  return slug
    .replace(/\.json$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DiscoverEntitiesResult {
  groups: EntityGroup[];
  errors: Array<{ catalog: string; error: string }>;
}

export function discoverEntities(rootAbs: string): DiscoverEntitiesResult {
  const groups: EntityGroup[] = [];
  const errors: Array<{ catalog: string; error: string }> = [];
  const dataDir = path.join(rootAbs, 'data');
  if (!existsSync(dataDir)) return { groups, errors };

  const consumed = new Set<string>();

  const buildGroup = (
    file: string,
    kind: EntityKind,
    label: string,
  ): EntityGroup | null => {
    const rel = `data/${file}`;
    let json: unknown;
    try {
      json = readJson(rootAbs, rel);
    } catch (err) {
      errors.push({ catalog: rel, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
    if (json === undefined) return null;
    const rows = rowsOf(json);
    if (rows.length === 0) return null;
    const entities: Entity[] = rows.map((row) => {
      const id = asString(row.id) ?? 'unknown';
      const sprites = spritesFor(rootAbs, id, row);
      return {
        id,
        name: entityName(row, id),
        kind,
        catalog: rel,
        sprites,
        // "broken" only when the row WANTED sprites but none resolved.
        // A logic-only entity (invisible hazard, `sprite: null`) is
        // art-less by design — not broken.
        broken: sprites.length === 0 && declaresSprites(row),
        raw: row,
      };
    });
    return { catalog: rel, label, kind, entities };
  };

  // 1. Known catalogs, in declared order.
  for (const spec of CATALOG_SPEC) {
    const g = buildGroup(spec.file, spec.kind, spec.label);
    if (g) {
      groups.push(g);
      consumed.add(spec.file.toLowerCase());
    }
  }

  // 2. Dynamic discovery — any other data/*.json that looks like an
  //    entity catalog. Guarded three ways so level files never leak in:
  //    - skip the non-entity blacklist (levels.json, maps.json, …)
  //    - skip files registered as scenes in data/levels.json
  //    - require ARRAY shape with pre-existing ids (a level file is an
  //      object, so it can't pass — see looksLikeDynamicCatalog)
  const sceneFiles = new Set(
    discoverScenes(rootAbs).map((s) => s.file.toLowerCase()),
  );
  let dataEntries: string[] = [];
  try {
    dataEntries = readdirSync(dataDir);
  } catch {
    dataEntries = [];
  }
  for (const entry of dataEntries.sort()) {
    const lower = entry.toLowerCase();
    if (!lower.endsWith('.json')) continue;
    if (consumed.has(lower)) continue;
    if (isNonEntityJson(entry)) continue;
    const rel = `data/${entry}`;
    if (sceneFiles.has(rel.toLowerCase())) continue;
    let json: unknown;
    try {
      json = readJson(rootAbs, rel);
    } catch (err) {
      errors.push({ catalog: rel, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!looksLikeDynamicCatalog(json)) continue;
    const g = buildGroup(entry, 'unknown', titleCase(entry));
    if (g) groups.push(g);
  }

  return { groups, errors };
}

/** Parse data/levels.json (both shapes) into [{ id, file }]. */
function levelRegistry(rootAbs: string): Array<{ id?: string; file?: string; name?: string }> {
  let json: unknown;
  try {
    json = readJson(rootAbs, 'data/levels.json');
  } catch {
    return [];
  }
  if (Array.isArray(json)) return json as Array<{ id?: string; file?: string; name?: string }>;
  if (json && typeof json === 'object' && Array.isArray((json as { levels?: unknown }).levels)) {
    return (json as { levels: Array<{ id?: string; file?: string; name?: string }> }).levels;
  }
  return [];
}

export function discoverScenes(rootAbs: string): SceneSummary[] {
  const out: SceneSummary[] = [];
  for (const lv of levelRegistry(rootAbs)) {
    const file = asString(lv.file);
    if (!file) continue;
    const rel = file.replace(/\\/g, '/');
    let bg: string | null = null;
    let collisionSource: string | null = null;
    let name = asString(lv.name) ?? asString(lv.id) ?? rel.split('/').pop() ?? rel;
    try {
      const json = readJson(rootAbs, rel);
      if (json && typeof json === 'object') {
        const o = json as Record<string, unknown>;
        name = asString(o.name) ?? name;
        collisionSource = asString(o.collisionSource);
        if (typeof o.background === 'string') {
          bg = o.background;
        } else if (o.background && typeof o.background === 'object') {
          bg = asString((o.background as Record<string, unknown>).image);
        }
        if (!bg && asString(o.map)) bg = asString(o.map);
      }
    } catch {
      // Unreadable level file — still list it so the user can open + fix it.
    }
    out.push({
      id: asString(lv.id) ?? rel,
      name,
      file: rel,
      background: bg,
      collisionSource,
    });
  }
  return out;
}
