import { useEffect, useState } from 'react';
import { fetchFileContent } from '../lib/api.js';

// The game-build pipeline, surfaced as a live progress rail. Reads the
// checkpoint state the agent maintains at .ogf/pipeline/state.json (written by
// .agents/tools/pipeline.py). Renders nothing for projects that don't use the
// pipeline yet, so it's safe on any project.
const STAGES: [string, string][] = [
  ['discovery', 'Discovery'],
  ['spec', 'Spec'],
  ['art_direction', 'Art'],
  ['assets', 'Assets'],
  ['scaffold', 'Scaffold'],
  ['systems', 'Systems'],
  ['verify', 'Verify'],
  ['publish', 'Publish'],
];
const GATES = new Set(['discovery', 'spec', 'art_direction', 'publish']);

type StageState = { status?: string; approved?: boolean };

export function PipelineRail({ projectPath, rev }: { projectPath: string; rev?: number }) {
  const [stages, setStages] = useState<Record<string, StageState> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFileContent(projectPath, '.ogf/pipeline/state.json')
      .then((r) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(r.content ?? '{}');
          setStages(parsed.stages ?? {});
        } catch {
          setStages(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStages(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, rev]);

  const s = stages ?? {};
  const done = (k: string) => s[k]?.status === 'completed';

  return (
    <div className="pipeline-rail" role="list" aria-label="Build pipeline">
      <span className="prl-head">Pipeline</span>
      {STAGES.flatMap(([key, label], i) => {
        const isDone = done(key);
        const isCur = !isDone && STAGES.slice(0, i).every(([k]) => done(k));
        const node = (
          <span
            key={key}
            role="listitem"
            className={
              'prl-node' +
              (isDone ? ' done' : '') +
              (isCur ? ' cur' : '') +
              (GATES.has(key) ? ' gate' : '')
            }
            title={GATES.has(key) ? `${label} — approval gate` : label}
          >
            <span className="prl-b">{isDone ? '✓' : isCur ? '●' : ''}</span>
            <span className="prl-t">{label}</span>
          </span>
        );
        const line = i < STAGES.length - 1 ? <span key={`${key}-ln`} className="prl-ln" /> : null;
        return [node, line];
      })}
    </div>
  );
}
