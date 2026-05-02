// Path2D / Curve2D reader + writer for .tscn.
// Curve2D _data spans multiple lines:
//   _data = {
//   "points": PackedVector2Array(in_x, in_y, out_x, out_y, p_x, p_y, ...)
//   }
// We only edit the point positions — handles stay where they were.

import type { ColliderRef, ScenePath, Vec2 } from '@ogf/contracts';
import {
  parseVector2,
  readBodyValue,
  type ParsedTscn,
  type Section,
} from './tscn-parse.js';

const POINT_COMPONENTS = 6; // in_x, in_y, out_x, out_y, p_x, p_y

function parseSubResourceRef(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^SubResource\(\s*"([^"]+)"\s*\)/.exec(raw);
  return m ? m[1] : null;
}

function nodeKey(s: Section): string {
  const name = s.attrs.name ?? '';
  const parent = s.attrs.parent;
  if (parent === undefined || parent === '.') return name;
  return `${parent}/${name}`;
}

function indexSubResources(parsed: ParsedTscn): Map<string, Section> {
  const out = new Map<string, Section>();
  for (const s of parsed.sections) {
    if (s.kind === 'sub_resource' && s.attrs.id) out.set(s.attrs.id, s);
  }
  return out;
}

/** Inside a Curve2D sub_resource, find the line that contains
 *  `"points": PackedVector2Array(...)` and return its line index + the parsed numbers. */
function findCurvePointsLine(
  parsed: ParsedTscn,
  sub: Section,
): { lineIdx: number; numbers: number[] } | null {
  for (let i = sub.headerLine + 1; i < sub.endLine; i++) {
    const line = parsed.lines[i];
    const m = /"points"\s*:\s*PackedVector2Array\(\s*(.*?)\)/.exec(line);
    if (m) {
      const inner = m[1].trim();
      if (inner === '') return { lineIdx: i, numbers: [] };
      const nums = inner
        .split(/\s*,\s*/)
        .map((x) => Number(x))
        .filter((n) => !Number.isNaN(n));
      return { lineIdx: i, numbers: nums };
    }
  }
  return null;
}

export function readTscnPaths(parsed: ParsedTscn): ScenePath[] {
  const subs = indexSubResources(parsed);
  const out: ScenePath[] = [];
  let counter = 0;

  for (const node of parsed.sections) {
    if (node.kind !== 'node') continue;
    if (node.attrs.type !== 'Path2D') continue;

    const curveRef = parseSubResourceRef(readBodyValue(parsed, node, 'curve'));
    if (!curveRef) continue;
    const sub = subs.get(curveRef);
    if (!sub || sub.attrs.type !== 'Curve2D') continue;

    const found = findCurvePointsLine(parsed, sub);
    if (!found) continue;
    const { numbers } = found;

    if (numbers.length % POINT_COMPONENTS !== 0) continue;

    const points: Vec2[] = [];
    let hasBezier = false;
    for (let i = 0; i < numbers.length; i += POINT_COMPONENTS) {
      const inX = numbers[i];
      const inY = numbers[i + 1];
      const outX = numbers[i + 2];
      const outY = numbers[i + 3];
      const pX = numbers[i + 4];
      const pY = numbers[i + 5];
      if (inX !== 0 || inY !== 0 || outX !== 0 || outY !== 0) hasBezier = true;
      points.push({ x: pX, y: pY });
    }

    const origin = parseVector2(readBodyValue(parsed, node, 'position')) ?? { x: 0, y: 0 };
    const ref: ColliderRef = {
      backend: 'tscn',
      nodePath: nodeKey(node),
      subResourceId: curveRef,
    };
    out.push({
      uid: `path-tscn:${nodeKey(node)}:${counter++}`,
      ref,
      name: node.attrs.name ?? '',
      origin,
      points,
      hasBezierHandles: hasBezier,
      // Editable for non-bezier curves; if there are non-zero handles we'd
      // need to preserve them — supported here, but flag for the UI.
      editable: true,
    });
  }

  return out;
}

/** Mutate `parsed` to apply a point move within a Curve2D. */
export function writeTscnMovePathPoint(
  parsed: ParsedTscn,
  ref: ColliderRef & { backend: 'tscn' },
  index: number,
  position: Vec2,
): void {
  const subs = indexSubResources(parsed);
  const sub = subs.get(ref.subResourceId);
  if (!sub) throw new Error(`curve sub_resource not found: ${ref.subResourceId}`);
  const found = findCurvePointsLine(parsed, sub);
  if (!found) throw new Error(`points line not found in ${ref.subResourceId}`);

  const offset = index * POINT_COMPONENTS;
  if (offset + 5 >= found.numbers.length) {
    throw new Error(`point index ${index} out of range for curve with ${found.numbers.length / POINT_COMPONENTS} points`);
  }
  // Replace point.x / point.y. Handles are preserved.
  const next = [...found.numbers];
  next[offset + 4] = position.x;
  next[offset + 5] = position.y;

  // Re-emit the "points": PackedVector2Array(...) line, preserving any
  // surrounding text on that line (`,` separators, indentation, etc.)
  const oldLine = parsed.lines[found.lineIdx];
  const re = /("points"\s*:\s*PackedVector2Array)\(([^)]*)\)/;
  const newSerialized = next.map(formatNumber).join(', ');
  const newLine = oldLine.replace(re, (_, lhs) => `${lhs}(${newSerialized})`);
  parsed.lines[found.lineIdx] = newLine;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number.parseFloat(n.toFixed(6)).toString();
}
