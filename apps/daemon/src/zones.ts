// Zone readers/writers for Area2D / Marker2D in .tscn and zones JSON sidecar.
// Writers reuse the collider primitives — Area2D position writes are identical
// to StaticBody2D writes and JSON section patches are line-targeted.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ColliderRef,
  ColliderShape,
  SceneZone,
  Vec2,
  ZoneKind,
} from '@ogf/contracts';
import {
  parseTscn,
  parseVector2,
  readBodyValue,
  type ParsedTscn,
  type Section,
} from './tscn-parse.js';

void parseTscn; // re-exported elsewhere; keep import for tooling alignment

const SHAPE_KINDS = new Set(['RectangleShape2D', 'CircleShape2D', 'ConvexPolygonShape2D']);

function indexSubResources(parsed: ParsedTscn): Map<string, Section> {
  const out = new Map<string, Section>();
  for (const s of parsed.sections) {
    if (s.kind === 'sub_resource' && s.attrs.id) out.set(s.attrs.id, s);
  }
  return out;
}

function nodeKey(s: Section): string {
  const name = s.attrs.name ?? '';
  const parent = s.attrs.parent;
  if (parent === undefined || parent === '.') return name;
  return `${parent}/${name}`;
}

function parseSubResourceRef(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^SubResource\(\s*"([^"]+)"\s*\)/.exec(raw);
  return m ? m[1] : null;
}

function parsePackedVector2Array(raw: string | null): Vec2[] | null {
  if (!raw) return null;
  const m = /^PackedVector2Array\(\s*(.*)\)\s*$/s.exec(raw);
  if (!m) return null;
  const inner = m[1].trim();
  if (inner === '') return [];
  const nums = inner.split(/\s*,\s*/).map((x) => Number(x));
  if (nums.length % 2 !== 0 || nums.some((n) => Number.isNaN(n))) return null;
  const out: Vec2[] = [];
  for (let i = 0; i < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

/** Decide a zone's semantic kind from script-bound properties or its name. */
function classifyZone(section: Section, parsed: ParsedTscn): { kind: ZoneKind; fields: Record<string, string | number> } {
  const fields: Record<string, string | number> = {};
  for (let i = section.headerLine + 1; i < section.endLine; i++) {
    const line = parsed.lines[i];
    const trimmed = line.trim();
    // metadata/foo = value
    const meta = /^metadata\/([\w-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (meta) {
      const v = meta[2].trim();
      fields[meta[1]] =
        v.startsWith('"') && v.endsWith('"')
          ? v.slice(1, -1)
          : Number.isFinite(Number(v))
          ? Number(v)
          : v;
      continue;
    }
    // script-exported property: key = value
    const m = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(trimmed);
    if (!m) continue;
    if (['position', 'script', 'shape'].includes(m[1])) continue;
    const v = m[2].trim();
    fields[m[1]] =
      v.startsWith('"') && v.endsWith('"')
        ? v.slice(1, -1)
        : Number.isFinite(Number(v))
        ? Number(v)
        : v;
  }

  let kind: ZoneKind = 'unknown';
  if ('encounter_zone_id' in fields || 'encounter_rate' in fields) kind = 'encounter';
  else if ('exit_id' in fields || 'target_scene' in fields || 'target' in fields) kind = 'exit';
  else if (section.attrs.type === 'Marker2D') kind = 'spawn';

  return { kind, fields };
}

/** Read all zones from a .tscn parse. */
export function readTscnZones(parsed: ParsedTscn): SceneZone[] {
  const subs = indexSubResources(parsed);
  const out: SceneZone[] = [];
  let counter = 0;

  // 1) Area2D bodies (encounter / exit)
  for (const csNode of parsed.sections) {
    if (csNode.kind !== 'node') continue;
    if (csNode.attrs.type !== 'CollisionShape2D') continue;
    const parentPath = csNode.attrs.parent;
    if (!parentPath || parentPath === '.') continue;

    const bodySection = parsed.sections.find(
      (s) => s.kind === 'node' && nodeKey(s) === parentPath,
    );
    if (!bodySection || bodySection.attrs.type !== 'Area2D') continue;

    const shapeRefId = parseSubResourceRef(readBodyValue(parsed, csNode, 'shape'));
    if (!shapeRefId) continue;
    const subResource = subs.get(shapeRefId);
    if (!subResource) continue;
    const subType = subResource.attrs.type;
    if (!SHAPE_KINDS.has(subType)) continue;

    const position = parseVector2(readBodyValue(parsed, bodySection, 'position')) ?? { x: 0, y: 0 };

    let shape: ColliderShape;
    let editable = true;
    if (subType === 'RectangleShape2D') {
      const sz = parseVector2(readBodyValue(parsed, subResource, 'size')) ?? { x: 0, y: 0 };
      shape = { kind: 'rect', w: sz.x, h: sz.y };
    } else if (subType === 'CircleShape2D') {
      const r = Number(readBodyValue(parsed, subResource, 'radius') ?? 0);
      shape = { kind: 'circle', r };
    } else {
      const points = parsePackedVector2Array(readBodyValue(parsed, subResource, 'points')) ?? [];
      shape = { kind: 'polygon', points };
      editable = false;
    }

    const { kind, fields } = classifyZone(bodySection, parsed);
    const ref: ColliderRef = {
      backend: 'tscn',
      nodePath: parentPath,
      subResourceId: shapeRefId,
    };
    out.push({
      uid: `zone-tscn:${parentPath}:${counter++}`,
      ref,
      name: bodySection.attrs.name ?? '',
      zoneKind: kind,
      position,
      shape,
      fields,
      editable,
    });
  }

  // 2) Marker2D — spawn points (no shape)
  for (const m of parsed.sections) {
    if (m.kind !== 'node') continue;
    if (m.attrs.type !== 'Marker2D') continue;
    const position = parseVector2(readBodyValue(parsed, m, 'position')) ?? { x: 0, y: 0 };
    const { fields } = classifyZone(m, parsed);
    out.push({
      uid: `zone-tscn:${nodeKey(m)}:${counter++}`,
      ref: {
        backend: 'tscn',
        nodePath: nodeKey(m),
        subResourceId: '', // not used for points
      },
      name: m.attrs.name ?? '',
      zoneKind: 'spawn',
      position,
      shape: { kind: 'point' },
      fields,
      editable: true,
    });
  }

  // 3) Script-driven markers: Node2D under a non-root parent, with a script
  //    attached and recognized shape body properties. Catches MapEdit-style
  //    TowerPads / PathPoints / Blockers — pure data, no Sprite2D / Area2D /
  //    StaticBody2D involvement.
  // Size-property name → shape inference. First match wins.
  const sizePropOrder = ['pad_size', 'blocker_size', 'size'] as const;

  for (const node of parsed.sections) {
    if (node.kind !== 'node' || node.attrs.type !== 'Node2D') continue;
    const parent = node.attrs.parent;
    // Skip top-level / unparented Node2Ds (those are usually layer containers).
    if (!parent || parent === '.' || parent === undefined) continue;
    // Must have an attached script — that's our 'this is a marker' signal.
    const hasScript = parsed.lines
      .slice(node.headerLine + 1, node.endLine)
      .some((l) => /^\s*script\s*=\s*ExtResource/.test(l));
    if (!hasScript) continue;

    const np = nodeKey(node);
    const position = parseVector2(readBodyValue(parsed, node, 'position')) ?? { x: 0, y: 0 };
    const { fields } = classifyZone(node, parsed);

    // Detect rect-like shape from a Vector2 body property.
    let foundRect = false;
    for (const prop of sizePropOrder) {
      const sz = parseVector2(readBodyValue(parsed, node, prop));
      if (sz) {
        out.push({
          uid: `zone-tscn:${np}:${counter++}`,
          ref: {
            backend: 'tscn',
            nodePath: np,
            subResourceId: '',
            markerSizeProperty: prop,
          },
          name: node.attrs.name ?? '',
          zoneKind: 'marker',
          position,
          shape: { kind: 'rect', w: sz.x, h: sz.y },
          fields,
          editable: true,
        });
        foundRect = true;
        break;
      }
    }
    if (foundRect) continue;

    // Detect circle-like shape from a numeric `radius` property.
    const radiusRaw = readBodyValue(parsed, node, 'radius');
    if (radiusRaw && Number.isFinite(Number(radiusRaw))) {
      out.push({
        uid: `zone-tscn:${np}:${counter++}`,
        ref: {
          backend: 'tscn',
          nodePath: np,
          subResourceId: '',
          markerRadiusProperty: 'radius',
        },
        name: node.attrs.name ?? '',
        zoneKind: 'marker',
        position,
        shape: { kind: 'circle', r: Number(radiusRaw) },
        fields,
        editable: true,
      });
      continue;
    }

    // No shape inferred — fall back to a draggable point.
    out.push({
      uid: `zone-tscn:${np}:${counter++}`,
      ref: { backend: 'tscn', nodePath: np, subResourceId: '' },
      name: node.attrs.name ?? '',
      zoneKind: 'marker',
      position,
      shape: { kind: 'point' },
      fields,
      editable: true,
    });
  }

  return out;
}

// ---------- JSON sidecar reader ----------

const ZONES_JSON_HINTS = ['-zones.json', '_zones.json', 'zones.json'];

export function findZonesJsonPath(rootAbs: string, scenePath: string): string | null {
  const baseName = path.basename(scenePath, path.extname(scenePath)).toLowerCase();
  const dataDir = path.join(rootAbs, 'data');
  if (!existsSync(dataDir)) return null;
  let names: string[] = [];
  try {
    names = readdirSync(dataDir);
  } catch {
    return null;
  }
  for (const n of names) {
    const lower = n.toLowerCase();
    if (!ZONES_JSON_HINTS.some((h) => lower.endsWith(h))) continue;
    if (
      lower.includes(baseName) ||
      baseName.includes(lower.replace(/[-_]zones\.json$/, ''))
    ) {
      return path.posix.join('data', n);
    }
  }
  for (const n of names) {
    const lower = n.toLowerCase();
    if (ZONES_JSON_HINTS.some((h) => lower.endsWith(h))) return path.posix.join('data', n);
  }
  return null;
}

interface JsonZone {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  radius?: number;
  facing?: string;
  encounter_rate?: number;
  target?: string;
  encounter_table?: unknown;
}

interface ZonesJson {
  spawn_points?: JsonZone[];
  encounter_zones?: JsonZone[];
  exits?: JsonZone[];
}

/** Read top-level point-style fields from any JSON file (typically the
 *  collision sidecar): `heroSpawn`, `playerSpawn`, `spawn`, plus arrays
 *  `entrances` / `goals` of {id, x, y} entries. */
export function readJsonPointMarkers(rootAbs: string, jsonRel: string): SceneZone[] {
  const abs = path.join(rootAbs, jsonRel);
  if (!existsSync(abs)) return [];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return [];
  }
  const out: SceneZone[] = [];

  // Single-point fields like heroSpawn / playerSpawn
  const SINGLE: { field: string; kind: ZoneKind }[] = [
    { field: 'heroSpawn', kind: 'spawn' },
    { field: 'playerSpawn', kind: 'spawn' },
    { field: 'spawn', kind: 'spawn' },
  ];
  for (const { field, kind } of SINGLE) {
    const v = data[field];
    if (
      v &&
      typeof v === 'object' &&
      typeof (v as Record<string, unknown>).x === 'number' &&
      typeof (v as Record<string, unknown>).y === 'number'
    ) {
      const o = v as { x: number; y: number; facing?: string };
      const fields: Record<string, string | number> = {};
      if (o.facing) fields.facing = o.facing;
      out.push({
        uid: `zone-json:${jsonRel}:${field}`,
        ref: {
          backend: 'json',
          relPath: jsonRel,
          section: field,
          id: field,
          singleField: true,
        },
        name: field,
        zoneKind: kind,
        position: { x: o.x, y: o.y },
        shape: { kind: 'point' },
        fields,
        editable: true,
      });
    }
  }

  // Array-of-points fields
  const ARRAYS: { field: string; kind: ZoneKind }[] = [
    { field: 'entrances', kind: 'spawn' },
    { field: 'goals', kind: 'exit' },
  ];
  for (const { field, kind } of ARRAYS) {
    const arr = data[field];
    if (!Array.isArray(arr)) continue;
    arr.forEach((it: unknown, idx: number) => {
      if (
        !it ||
        typeof it !== 'object' ||
        typeof (it as { x?: unknown }).x !== 'number' ||
        typeof (it as { y?: unknown }).y !== 'number'
      ) {
        return;
      }
      const o = it as { id?: string; x: number; y: number };
      const id = String(o.id ?? `${field}_${idx}`);
      out.push({
        uid: `zone-json:${jsonRel}:${field}:${id}`,
        ref: { backend: 'json', relPath: jsonRel, section: field, id },
        name: id,
        zoneKind: kind,
        position: { x: o.x, y: o.y },
        shape: { kind: 'point' },
        fields: {},
        editable: true,
      });
    });
  }

  return out;
}

export function readJsonZones(rootAbs: string, jsonRel: string): SceneZone[] {
  const abs = path.join(rootAbs, jsonRel);
  if (!existsSync(abs)) return [];
  let parsed: ZonesJson;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return [];
  }
  const out: SceneZone[] = [];

  function ingest(items: JsonZone[] | undefined, section: 'encounter_zones' | 'exits' | 'spawn_points', kind: ZoneKind) {
    if (!items) return;
    for (const it of items) {
      const ref: ColliderRef = {
        backend: 'json',
        relPath: jsonRel,
        section,
        id: it.id,
      };
      const fields: Record<string, string | number> = {};
      if (it.name) fields.name = it.name;
      if (typeof it.encounter_rate === 'number') fields.encounter_rate = it.encounter_rate;
      if (it.target) fields.target = it.target;
      if (it.facing) fields.facing = it.facing;

      let shape: ColliderShape;
      let position: Vec2;
      if (typeof it.w === 'number' && typeof it.h === 'number') {
        shape = { kind: 'rect', w: it.w, h: it.h };
        position = { x: (it.x ?? 0) + it.w / 2, y: (it.y ?? 0) + it.h / 2 };
      } else if (typeof it.radius === 'number') {
        shape = { kind: 'circle', r: it.radius };
        position = { x: it.x ?? 0, y: it.y ?? 0 };
      } else {
        shape = { kind: 'point' };
        position = { x: it.x ?? 0, y: it.y ?? 0 };
      }

      out.push({
        uid: `zone-json:${section}:${it.id}`,
        ref,
        name: it.name ?? it.id,
        zoneKind: kind,
        position,
        shape,
        fields,
        editable: true,
      });
    }
  }

  ingest(parsed.spawn_points, 'spawn_points', 'spawn');
  ingest(parsed.encounter_zones, 'encounter_zones', 'encounter');
  ingest(parsed.exits, 'exits', 'exit');
  return out;
}
