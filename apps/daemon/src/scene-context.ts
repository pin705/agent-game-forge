// Reader for <project>/.ogf/scene-context.json. The frontend writes this; the
// daemon's composePrompt reads it to build a per-turn mini-snapshot for the
// agent. Kept small (~80–230 tokens) so we don't blow up conversation history.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface DumpedVec2 {
  x: number;
  y: number;
}

export interface DumpedSelection {
  kind: 'prop' | 'collider' | 'zone' | 'path-point' | null;
  nodePath: string;
  name?: string;
  position?: DumpedVec2;
  scale?: DumpedVec2;
  texture?: string;
  shape?: { kind: string; w?: number; h?: number; r?: number };
  zoneKind?: string;
  pointIndex?: number;
}

export interface DumpedProp {
  nodePath: string;
  name: string;
  position: DumpedVec2;
  scale: DumpedVec2;
  texture?: string;
}

export interface DumpedCollider {
  nodePath?: string;
  name: string;
  kind: string;
  position: DumpedVec2;
  shape: { kind: string; w?: number; h?: number; r?: number };
}

export interface DumpedZone {
  name: string;
  zoneKind: string;
  position: DumpedVec2;
  shape: { kind: string; w?: number; h?: number; r?: number };
}

export interface DumpedPath {
  name: string;
  origin: DumpedVec2;
  pointCount: number;
  /** A few representative points so the agent gets a sense of route. */
  samplePoints?: DumpedVec2[];
}

export interface SceneContextDump {
  version: 1;
  updatedAt: number;
  project?: { path: string; engine?: string; name?: string };
  scene?: { relPath: string; rootName?: string };
  selected?: DumpedSelection | null;
  viewport?: { x: number; y: number; w: number; h: number };
  props?: DumpedProp[];
  colliders?: DumpedCollider[];
  zones?: DumpedZone[];
  paths?: DumpedPath[];
  stats?: Record<string, number>;
}

export function readSceneContext(projectAbs: string): SceneContextDump | null {
  const file = path.join(projectAbs, '.ogf', 'scene-context.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed as SceneContextDump;
  } catch {
    // ignore — corrupted or in-flight write
  }
  return null;
}

const NEARBY_RADIUS = 300;

/** Build the per-turn text block prepended to the user's prompt. */
export function formatSceneContextSnippet(ctx: SceneContextDump | null): string {
  if (!ctx) return '';
  const lines: string[] = ['[OGF scene context]'];

  if (ctx.scene?.relPath) {
    lines.push(
      `Scene: ${ctx.scene.relPath}${ctx.scene.rootName ? ` (${ctx.scene.rootName})` : ''}`,
    );
  }
  const stats = ctx.stats;
  if (stats) {
    const parts: string[] = [];
    if (stats.props !== undefined) parts.push(`${stats.props} props`);
    if (stats.colliders !== undefined) parts.push(`${stats.colliders} colliders`);
    if (stats.zones !== undefined) parts.push(`${stats.zones} zones`);
    if (stats.paths !== undefined) parts.push(`${stats.paths} paths`);
    if (parts.length > 0) lines.push(`Totals: ${parts.join(', ')}.`);
  }

  if (ctx.selected) {
    const s = ctx.selected;
    lines.push(`Selected: ${s.nodePath} (${s.kind ?? 'unknown'})`);
    if (s.position) lines.push(`  position: (${fmt(s.position.x)}, ${fmt(s.position.y)})`);
    if (s.scale) lines.push(`  scale: (${fmt(s.scale.x)}, ${fmt(s.scale.y)})`);
    if (s.texture) lines.push(`  texture: ${s.texture}`);
    if (s.shape) {
      const sh = s.shape;
      const desc =
        sh.kind === 'rect'
          ? `rect ${fmt(sh.w ?? 0)}x${fmt(sh.h ?? 0)}`
          : sh.kind === 'circle'
          ? `circle r=${fmt(sh.r ?? 0)}`
          : sh.kind;
      lines.push(`  shape: ${desc}`);
    }
    if (s.zoneKind) lines.push(`  zoneKind: ${s.zoneKind}`);

    // Nearby — only when something is selected, since "this" prompts are the
    // case that actually needs spatial context.
    if (s.position) {
      const nearby = collectNearby(ctx, s.position, s.nodePath);
      if (nearby.length > 0) {
        lines.push(`Nearby within ${NEARBY_RADIUS}px:`);
        for (const n of nearby) lines.push(`  - ${n}`);
      }
    }
  }

  lines.push('Full state in .ogf/scene-context.json — read it for more.');
  return lines.join('\n') + '\n';
}

function collectNearby(
  ctx: SceneContextDump,
  origin: DumpedVec2,
  excludePath: string,
): string[] {
  const out: { dist: number; line: string }[] = [];
  const within = (p: DumpedVec2): number => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return Math.hypot(dx, dy);
  };

  for (const p of ctx.props ?? []) {
    if (p.nodePath === excludePath) continue;
    const d = within(p.position);
    if (d <= NEARBY_RADIUS) {
      out.push({
        dist: d,
        line: `prop ${p.nodePath} at (${fmt(p.position.x)}, ${fmt(p.position.y)})`,
      });
    }
  }
  for (const c of ctx.colliders ?? []) {
    if (c.nodePath === excludePath) continue;
    const d = within(c.position);
    if (d <= NEARBY_RADIUS) {
      const sh =
        c.shape.kind === 'rect'
          ? `rect ${fmt(c.shape.w ?? 0)}x${fmt(c.shape.h ?? 0)}`
          : c.shape.kind === 'circle'
          ? `circle r=${fmt(c.shape.r ?? 0)}`
          : c.shape.kind;
      out.push({
        dist: d,
        line: `collider "${c.name}" (${c.kind}) ${sh} at (${fmt(c.position.x)}, ${fmt(c.position.y)})`,
      });
    }
  }
  for (const z of ctx.zones ?? []) {
    const d = within(z.position);
    if (d <= NEARBY_RADIUS) {
      out.push({
        dist: d,
        line: `zone "${z.name}" (${z.zoneKind}) at (${fmt(z.position.x)}, ${fmt(z.position.y)})`,
      });
    }
  }
  for (const pa of ctx.paths ?? []) {
    // Include path if any sample point is within radius.
    const closest = (pa.samplePoints ?? [])
      .map((pt) => ({ pt, d: within({ x: pa.origin.x + pt.x, y: pa.origin.y + pt.y }) }))
      .sort((a, b) => a.d - b.d)[0];
    if (closest && closest.d <= NEARBY_RADIUS) {
      out.push({
        dist: closest.d,
        line: `path "${pa.name}" (${pa.pointCount} points) passes near (${fmt(closest.pt.x + pa.origin.x)}, ${fmt(closest.pt.y + pa.origin.y)})`,
      });
    }
  }

  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, 6).map((x) => x.line); // cap to keep snippet small
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number.parseFloat(n.toFixed(2)).toString();
}
