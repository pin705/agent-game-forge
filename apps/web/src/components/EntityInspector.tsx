import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entity, EntitySprite, SceneSummary, UsageHit } from '@ogf/contracts';
import { fetchFileContent, fetchUsages, projectFileUrl, writeFileContent } from '../lib/api.js';
import { I } from './icons.js';

interface Props {
  projectPath: string;
  entity: Entity;
  scenes: SceneSummary[];
  /** Open a raw file in the Assets tab. */
  onOpenFile: (relPath: string) => void;
  /** Open a scene in the Scenes tab. */
  onOpenScene: (relPath: string) => void;
  /** Send a prompt to the agent (used by Regenerate). */
  onAskAgent: (text: string) => void;
  /** Catalog changed on disk — parent should re-fetch entities. */
  onCatalogChanged: () => void;
}

const KIND_LABEL: Record<string, string> = {
  player: 'player',
  enemy: 'enemy',
  hero: 'hero',
  boss: 'boss',
  tower: 'tower',
  pickup: 'pickup',
  npc: 'npc',
  projectile: 'projectile',
  item: 'item',
  hazard: 'hazard',
  unknown: 'entity',
};

interface PipelineMeta {
  cols?: number;
  rows?: number;
  duration?: number; // ms per frame
  align?: string;
}

/** Animated sprite thumbnail. Reads sibling pipeline-meta.json for the
 *  grid + frame timing; cycles frames on a canvas. Falls back to a static
 *  image when no metadata is available. */
function SpriteThumb({
  projectPath,
  sprite,
  size = 96,
}: {
  projectPath: string;
  sprite: EntitySprite;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meta, setMeta] = useState<PipelineMeta | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  const dir = useMemo(() => {
    const i = sprite.relPath.lastIndexOf('/');
    return i >= 0 ? sprite.relPath.slice(0, i) : '';
  }, [sprite.relPath]);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setImg(null);
    setFailed(false);

    const image = new Image();
    image.onload = () => {
      if (!cancelled) setImg(image);
    };
    image.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    image.src = projectFileUrl(projectPath, sprite.relPath);

    // pipeline-meta.json sibling — optional; only present for packs.
    const metaPath = dir ? `${dir}/pipeline-meta.json` : 'pipeline-meta.json';
    fetchFileContent(projectPath, metaPath)
      .then((r) => {
        if (cancelled || r.kind !== 'text' || !r.content) return;
        try {
          setMeta(JSON.parse(r.content) as PipelineMeta);
        } catch {
          /* ignore — fall back to static */
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [projectPath, sprite.relPath, dir]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const cols = meta?.cols && meta.cols > 0 ? meta.cols : 1;
    const rows = meta?.rows && meta.rows > 0 ? meta.rows : 1;
    const total = cols * rows;
    const fw = img.width / cols;
    const fh = img.height / rows;
    const frameMs = meta?.duration && meta.duration > 0 ? meta.duration : 120;

    // Fit the frame into the canvas box, preserving aspect.
    const scale = Math.min(size / fw, size / fh);
    const dw = Math.round(fw * scale);
    const dh = Math.round(fh * scale);
    const dx = Math.round((size - dw) / 2);
    const dy = Math.round((size - dh) / 2);

    let frame = 0;
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      if (now - last >= frameMs) {
        last = now;
        frame = (frame + 1) % total;
      }
      const sx = (frame % cols) * fw;
      const sy = Math.floor(frame / cols) * fh;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [img, meta, size]);

  if (failed) {
    return (
      <div className="ent-thumb ent-thumb-missing" style={{ width: size, height: size }}>
        {I.png}
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="ent-thumb"
      style={{ width: size, height: size }}
    />
  );
}

/** Flatten a stat block into editable scalar rows. Nested objects are
 *  shown one level deep with a `parent.child` key. */
function flattenStats(
  stats: Record<string, unknown>,
): Array<{ key: string; path: string[]; value: number | string }> {
  const out: Array<{ key: string; path: string[]; value: number | string }> = [];
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number' || typeof v === 'string') {
      out.push({ key: k, path: [k], value: v });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === 'number' || typeof v2 === 'string') {
          out.push({ key: `${k}.${k2}`, path: [k, k2], value: v2 });
        }
      }
    }
  }
  return out;
}

export function EntityInspector(props: Props) {
  const { entity, projectPath } = props;
  const [usages, setUsages] = useState<UsageHit[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const raw = entity.raw;
  const statBlock = useMemo(() => {
    const s = raw.stats;
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return s as Record<string, unknown>;
    }
    // No `stats` object — surface top-level scalar fields that look like
    // stats (numbers), minus the structural ones.
    const skip = new Set(['id', 'name', 'label', 'title', 'kind', 'displayW', 'displayH']);
    const inferred: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (skip.has(k)) continue;
      if (typeof v === 'number') inferred[k] = v;
    }
    return inferred;
  }, [raw]);

  const statRows = useMemo(() => flattenStats(statBlock), [statBlock]);
  const hasStatsObject = !!raw.stats && typeof raw.stats === 'object';

  const displayW = typeof raw.displayW === 'number' ? raw.displayW : null;
  const displayH = typeof raw.displayH === 'number' ? raw.displayH : null;
  const anchor = typeof raw.anchor === 'string' ? raw.anchor : null;
  const hitbox =
    raw.hitbox && typeof raw.hitbox === 'object'
      ? (raw.hitbox as Record<string, unknown>)
      : null;

  // Used-in scenes — derived from the usage scan: a scene uses this
  // entity when its level JSON shows up among the references to the
  // entity's sprite. Real data, no guessing.
  const usedScenes = useMemo(() => {
    const refFiles = new Set(usages.map((h) => h.file.replace(/\\/g, '/')));
    return props.scenes.filter((s) => refFiles.has(s.file));
  }, [props.scenes, usages]);

  useEffect(() => {
    const probe = entity.sprites[0]?.relPath;
    if (!probe) {
      setUsages([]);
      return;
    }
    let cancelled = false;
    setUsagesLoading(true);
    fetchUsages(projectPath, probe)
      .then((r) => {
        if (!cancelled) setUsages(r.hits);
      })
      .catch(() => {
        if (!cancelled) setUsages([]);
      })
      .finally(() => {
        if (!cancelled) setUsagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, entity.sprites]);

  // Reset drafts when the entity changes.
  useEffect(() => {
    setDrafts({});
    setSaveError(null);
  }, [entity.id, entity.catalog]);

  async function commitStat(path: string[], rawValue: string, original: number | string) {
    const key = path.join('.');
    const numeric = typeof original === 'number';
    const parsed: number | string = numeric ? Number(rawValue) : rawValue;
    if (numeric && Number.isNaN(parsed)) {
      setSaveError(`${key}: not a number`);
      return;
    }
    if (parsed === original) {
      setDrafts((d) => {
        const n = { ...d };
        delete n[key];
        return n;
      });
      return;
    }
    setSaving(key);
    setSaveError(null);
    try {
      const r = await fetchFileContent(projectPath, entity.catalog);
      if (r.kind !== 'text' || !r.content) throw new Error('catalog unreadable');
      const json = JSON.parse(r.content) as unknown;
      const row = findRow(json, entity.id);
      if (!row) throw new Error(`row ${entity.id} not found in catalog`);
      // Walk into the stat path, creating nothing — the path came from
      // the existing row so every segment but the last exists.
      let cursor: Record<string, unknown> = row;
      for (let i = 0; i < path.length - 1; i++) {
        const next = cursor[path[i]];
        if (!next || typeof next !== 'object') throw new Error(`bad path at ${path[i]}`);
        cursor = next as Record<string, unknown>;
      }
      cursor[path[path.length - 1]] = parsed;
      const eol = r.content.includes('\r\n') ? '\r\n' : '\n';
      await writeFileContent({
        projectPath,
        relPath: entity.catalog,
        content: JSON.stringify(json, null, 2) + eol,
      });
      setDrafts((d) => {
        const n = { ...d };
        delete n[key];
        return n;
      });
      props.onCatalogChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  function regeneratePrompt(): string {
    const lines = [
      `Regenerate the COMPLETE sprite pack for entity \`${entity.id}\` (catalog: ${entity.catalog}).`,
      '',
      'The pack:',
      ...entity.sprites.map((s) => `- ${s.relPath}  (action: ${s.action})`),
      '',
      'Goal: refresh every animation as a coherent set so the entity reads as',
      'the SAME character across all of them. Use the generate2dsprite skill.',
      '',
      'For each animation:',
      '1. Stage the full pack to .ogf/regen/<that animation dir>/ via --output-dir.',
      '2. view_image .ogf/style-anchor.png (if present) + one existing animation',
      '   of this entity as the identity reference before generating.',
      '3. Keep each animation\'s existing grid + fps unless a change is clearly better.',
      '',
      'Do not touch any other file. Report the layout used for each animation when done.',
      'The user reviews + applies the swap via the pack review UI.',
    ];
    return lines.join('\n');
  }

  return (
    <div className="ent-inspector">
      <div className="ent-head">
        <div className="ent-head-main">
          <h2 className="ent-title">{entity.name}</h2>
          <span className={`ent-kind-badge kind-${entity.kind}`}>
            {KIND_LABEL[entity.kind] ?? entity.kind}
          </span>
          {entity.broken && (
            <span className="ent-broken-badge" title="No sprites resolved for this entity">
              no sprites
            </span>
          )}
        </div>
        <div className="ent-head-sub">
          <code>{entity.id}</code>
          <span className="ent-dot">·</span>
          <button className="ent-link" onClick={() => props.onOpenFile(entity.catalog)}>
            {entity.catalog}
          </button>
        </div>
      </div>

      {/* Animations */}
      <section className="ent-section">
        <div className="ent-section-head">
          <span>Animations</span>
          <span className="ent-count">{entity.sprites.length}</span>
        </div>
        {entity.sprites.length === 0 ? (
          <div className="ent-empty">
            No sprites found. The catalog row exists but no animation paths or{' '}
            <code>assets/sprites/{entity.id}/</code> folder resolved.
          </div>
        ) : (
          <div className="ent-anim-strip">
            {entity.sprites.map((s) => (
              <button
                key={s.relPath}
                className="ent-anim-cell"
                onClick={() => props.onOpenFile(s.relPath)}
                title={`${s.relPath}\nClick to open`}
              >
                <SpriteThumb projectPath={projectPath} sprite={s} />
                <span className="ent-anim-label">
                  {s.action}
                  {s.isPack && <span className="ent-pack-dot" title="Animation pack" />}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Stats */}
      {statRows.length > 0 && (
        <section className="ent-section">
          <div className="ent-section-head">
            <span>Stats</span>
            {!hasStatsObject && <span className="ent-hint">inferred from top-level fields</span>}
          </div>
          <div className="ent-stats">
            {statRows.map((row) => {
              const draftVal = drafts[row.key];
              const shown = draftVal ?? String(row.value);
              const dirty = draftVal !== undefined && draftVal !== String(row.value);
              return (
                <div className="ent-stat-row" key={row.key}>
                  <label className="ent-stat-key">{row.key}</label>
                  <input
                    className={`ent-stat-input${dirty ? ' dirty' : ''}`}
                    value={shown}
                    disabled={saving === row.key}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                    }
                    onBlur={(e) => void commitStat(row.path, e.target.value, row.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        setDrafts((d) => {
                          const n = { ...d };
                          delete n[row.key];
                          return n;
                        });
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
          {saveError && <div className="ent-save-error">{saveError}</div>}
        </section>
      )}

      {/* Display */}
      {(displayW !== null || anchor !== null || hitbox) && (
        <section className="ent-section">
          <div className="ent-section-head">
            <span>Display</span>
          </div>
          <div className="ent-kv">
            {displayW !== null && displayH !== null && (
              <div className="ent-kv-row">
                <span className="ent-kv-k">Render</span>
                <span className="ent-kv-v">
                  {displayW} × {displayH} px
                </span>
              </div>
            )}
            {anchor && (
              <div className="ent-kv-row">
                <span className="ent-kv-k">Anchor</span>
                <span className="ent-kv-v">{anchor}</span>
              </div>
            )}
            {hitbox && (
              <div className="ent-kv-row">
                <span className="ent-kv-k">Hitbox</span>
                <span className="ent-kv-v">
                  {typeof hitbox.w === 'number' ? hitbox.w : '?'} ×{' '}
                  {typeof hitbox.h === 'number' ? hitbox.h : '?'}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Used in */}
      <section className="ent-section">
        <div className="ent-section-head">
          <span>Used in</span>
        </div>
        <div className="ent-kv">
          <div className="ent-kv-row">
            <span className="ent-kv-k">Scenes</span>
            <span className="ent-kv-v">
              {usedScenes.length === 0 ? (
                <span className="ent-muted">none detected</span>
              ) : (
                usedScenes.map((s, i) => (
                  <span key={s.file}>
                    {i > 0 && ' · '}
                    <button className="ent-link" onClick={() => props.onOpenScene(s.file)}>
                      {s.name}
                    </button>
                  </span>
                ))
              )}
            </span>
          </div>
          <div className="ent-kv-row">
            <span className="ent-kv-k">Code</span>
            <span className="ent-kv-v">
              {usagesLoading ? (
                <span className="ent-muted">scanning…</span>
              ) : usages.length === 0 ? (
                <span className="ent-muted">no references</span>
              ) : (
                usages.slice(0, 6).map((h, i) => (
                  <span key={`${h.file}:${h.line}`}>
                    {i > 0 && ' · '}
                    <button className="ent-link" onClick={() => props.onOpenFile(h.file)}>
                      {h.file.split('/').pop()}:{h.line}
                    </button>
                  </span>
                ))
              )}
            </span>
          </div>
        </div>
      </section>

      {/* Actions */}
      <section className="ent-section">
        <div className="ent-section-head">
          <span>Actions</span>
        </div>
        <div className="ent-actions">
          <button
            className="btn btn-sm"
            disabled={entity.sprites.length === 0}
            onClick={() => props.onAskAgent(regeneratePrompt())}
            title="Ask the agent to regenerate every animation as a coherent set"
          >
            {I.refresh} Regenerate whole pack
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => props.onOpenFile(entity.catalog)}>
            Open catalog
          </button>
        </div>
      </section>
    </div>
  );
}

/** Find a catalog row by id in either the array or record shape. */
function findRow(json: unknown, id: string): Record<string, unknown> | null {
  if (Array.isArray(json)) {
    const hit = json.find(
      (r) => r && typeof r === 'object' && (r as Record<string, unknown>).id === id,
    );
    return (hit as Record<string, unknown>) ?? null;
  }
  if (json && typeof json === 'object') {
    const rec = json as Record<string, unknown>;
    if (rec[id] && typeof rec[id] === 'object') return rec[id] as Record<string, unknown>;
  }
  return null;
}

