import { useEffect, useMemo, useState } from 'react';
import type { FileNode } from '@ogf/contracts';
import { fetchFileTree } from '../lib/api.js';
import { I } from './icons.js';

export interface RegenerateOptions {
  /** 'same' = keep current dims, 'free' = let model decide, otherwise w:h. */
  aspectRatio: 'same' | 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  /** Total frame count (cols × rows). 0 means "don't enforce". */
  frames: number;
  cols: number;
  rows: number;
  fps: number;
  /** Free-form change request. */
  hint: string;
  /** Tell agent to also patch slicing config (cols/rows/fps in code) AFTER user applies the swap. */
  updateCodeIfChanged: boolean;
  /** Auto-discover sibling sprites in the same dir and ask agent to use them as visual reference. */
  matchSiblingStyle: boolean;
}

interface Props {
  /** Current slicing if known — pre-fills cols/rows/fps. */
  initial?: { cols?: number; rows?: number; fps?: number; naturalW?: number; naturalH?: number };
  /** Path of the sprite being regenerated; we use the parent dir to find siblings. */
  relPath: string;
  projectPath: string;
  onCancel: () => void;
  onSubmit: (opts: RegenerateOptions, siblings: string[]) => void;
}

const ASPECTS: Array<{ value: RegenerateOptions['aspectRatio']; label: string }> = [
  { value: 'same', label: 'Same as current' },
  { value: '1:1', label: '1:1 (square)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: 'free', label: 'Free (let model pick)' },
];

/** Suggest a reasonable cols × rows grid for a frame count.
 *  Prefers wider-than-tall (cols >= rows); falls back to N×1 for primes. */
function suggestGrid(frames: number): { cols: number; rows: number } {
  if (frames <= 0) return { cols: 1, rows: 1 };
  if (frames === 1) return { cols: 1, rows: 1 };
  // Try to find factors closest to sqrt
  const root = Math.sqrt(frames);
  for (let r = Math.floor(root); r >= 1; r--) {
    if (frames % r === 0) {
      return { cols: frames / r, rows: r };
    }
  }
  return { cols: frames, rows: 1 };
}

export function RegenerateOptionsModal(props: Props) {
  const initialFrames = (props.initial?.cols ?? 0) * (props.initial?.rows ?? 0) || 4;
  const [aspectRatio, setAspectRatio] = useState<RegenerateOptions['aspectRatio']>('same');
  const [frames, setFrames] = useState(initialFrames);
  const [cols, setCols] = useState(props.initial?.cols ?? 4);
  const [rows, setRows] = useState(props.initial?.rows ?? 1);
  const [fps, setFps] = useState(props.initial?.fps ?? 8);
  const [hint, setHint] = useState('');
  const [updateCodeIfChanged, setUpdateCode] = useState(true);
  const [matchSiblingStyle, setMatchSiblings] = useState(true);
  const [siblings, setSiblings] = useState<string[]>([]);
  const [siblingsLoading, setSiblingsLoading] = useState(true);

  const parentDir = useMemo(() => {
    const segs = props.relPath.replace(/\\/g, '/').split('/');
    segs.pop();
    return segs.join('/');
  }, [props.relPath]);

  // Discover sibling images in the same folder for visual consistency.
  useEffect(() => {
    let cancelled = false;
    setSiblingsLoading(true);
    fetchFileTree(props.projectPath)
      .then((res) => {
        if (cancelled) return;
        const found: string[] = [];
        const walk = (node: FileNode): void => {
          if (node.children) {
            for (const c of node.children) walk(c);
          }
          if (node.kind !== 'file') return;
          const rp = node.relPath;
          if (rp === props.relPath) return;
          const norm = rp.replace(/\\/g, '/');
          const dir = norm.split('/').slice(0, -1).join('/');
          if (dir === parentDir && /\.(png|jpe?g|webp)$/i.test(norm)) {
            found.push(norm);
          }
        };
        walk(res.tree);
        setSiblings(found);
      })
      .catch(() => {
        // Non-fatal — agent will still ls itself.
        setSiblings([]);
      })
      .finally(() => {
        if (!cancelled) setSiblingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath, parentDir]);

  // Keep cols/rows in sync with frames when user changes frame count.
  function applyFrames(n: number) {
    const v = Math.max(1, Math.floor(n || 0));
    setFrames(v);
    const g = suggestGrid(v);
    setCols(g.cols);
    setRows(g.rows);
  }

  function autoSuggest() {
    const g = suggestGrid(frames);
    setCols(g.cols);
    setRows(g.rows);
  }

  function submit() {
    props.onSubmit(
      {
        aspectRatio,
        frames,
        cols,
        rows,
        fps,
        hint: hint.trim(),
        updateCodeIfChanged,
        matchSiblingStyle,
      },
      siblings,
    );
  }

  const gridMismatch = cols * rows !== frames;
  const layoutChanged =
    cols !== (props.initial?.cols ?? -1) ||
    rows !== (props.initial?.rows ?? -1) ||
    fps !== (props.initial?.fps ?? -1);

  return (
    <div className="modal-scrim" onClick={props.onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.refresh}</span>
          <span className="title">Regenerate sprite</span>
          <span className="sub">{props.relPath}</span>
          <button className="close" onClick={props.onCancel}>{I.close}</button>
        </div>

        <div className="modal-body" style={{ display: 'block', padding: 16, overflow: 'auto' }}>
          <div className="regen-form">
            <label className="regen-form-row">
              <span>Aspect ratio</span>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as RegenerateOptions['aspectRatio'])}
              >
                {ASPECTS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="regen-form-row">
              <span>Frames</span>
              <div className="regen-frame-controls">
                <input
                  type="number"
                  min={1}
                  value={frames}
                  onChange={(e) => applyFrames(Number(e.target.value))}
                  style={{ width: 64 }}
                />
                <span className="regen-form-divider">in</span>
                <input
                  type="number"
                  min={1}
                  value={cols}
                  onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 56 }}
                />
                <span className="regen-form-divider">×</span>
                <input
                  type="number"
                  min={1}
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 56 }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={autoSuggest}
                  title="Suggest a grid that matches frame count"
                >
                  auto
                </button>
              </div>
            </div>
            {gridMismatch && (
              <div className="regen-form-warn">
                {I.warn} cols × rows ({cols * rows}) doesn't match frames ({frames}).
              </div>
            )}

            <label className="regen-form-row">
              <span>FPS</span>
              <input
                type="number"
                min={1}
                max={60}
                value={fps}
                onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 8)))}
                style={{ width: 64 }}
              />
            </label>

            <label className="regen-form-row regen-form-row-stack">
              <span>What should change?</span>
              <textarea
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Optional. Leave blank for a fresh take with the same intent."
                rows={3}
              />
            </label>

            <label className="regen-checkbox">
              <input
                type="checkbox"
                checked={updateCodeIfChanged}
                onChange={(e) => setUpdateCode(e.target.checked)}
              />
              <span>
                Patch code/data slicing (cols / rows / fps) <strong>after</strong> I apply the swap
                {layoutChanged && <span className="pill" style={{ marginLeft: 6 }}>layout changed</span>}
              </span>
            </label>

            <label className="regen-checkbox">
              <input
                type="checkbox"
                checked={matchSiblingStyle}
                onChange={(e) => setMatchSiblings(e.target.checked)}
              />
              <span>
                Match style of sibling sprites in the same folder
                {siblingsLoading ? (
                  <span className="muted mono" style={{ marginLeft: 6 }}>scanning…</span>
                ) : (
                  <span className="pill" style={{ marginLeft: 6 }}>{siblings.length} found</span>
                )}
              </span>
            </label>
            {matchSiblingStyle && siblings.length > 0 && (
              <ul className="regen-siblings">
                {siblings.slice(0, 8).map((s) => (
                  <li key={s} className="mono">{s}</li>
                ))}
                {siblings.length > 8 && (
                  <li className="muted mono">… and {siblings.length - 8} more</li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={props.onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={submit}>
            {I.refresh} Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
