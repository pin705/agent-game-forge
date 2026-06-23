import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Play, RotateCw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  detectGodot,
  fetchActiveGodotRun,
  startGodot,
  stopGodot,
  subscribeGodotRun,
  type GodotInfo,
  type GodotStreamEvent,
} from '@/lib/godot';

interface Props {
  /** Absolute path of the Godot project, as registered with the OGF daemon. */
  projectPath: string;
}

interface ConsoleLine {
  id: number;
  level: 'info' | 'warning' | 'error' | 'system';
  text: string;
}

const MAX_LINES = 4000;

function classify(channel: 'stdout' | 'stderr', text: string): ConsoleLine['level'] {
  if (/^\s*(SCRIPT\s+)?ERROR[:\s]/i.test(text)) return 'error';
  if (/^\s*WARNING[:\s]/i.test(text)) return 'warning';
  return channel === 'stderr' ? 'error' : 'info';
}

/**
 * Live console for a GODOT-engine game.
 *
 * The studio's main PlayPane only handles web games (iframe). Godot runs as a
 * native child process on the daemon host; we Run/Stop it via the daemon's
 * `/api/godot/*` routes and stream its stdout/stderr over SSE into a scrolling
 * console. Mirrors the original OGF web PlayPane's Godot branch.
 */
export function GodotPlayPane({ projectPath }: Props) {
  const [godot, setGodot] = useState<GodotInfo | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);

  const lineCounter = useRef(0);
  const stdoutBuf = useRef('');
  const stderrBuf = useRef('');
  const unsubRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const pushLine = useCallback((line: Omit<ConsoleLine, 'id'>) => {
    setLines((prev) => {
      const next = [...prev, { ...line, id: lineCounter.current++ }];
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return next;
    });
  }, []);

  // Each SSE chunk may carry partial lines — buffer until newline.
  const ingest = useCallback(
    (channel: 'stdout' | 'stderr', chunk: string) => {
      const ref = channel === 'stdout' ? stdoutBuf : stderrBuf;
      const combined = ref.current + chunk;
      const parts = combined.split(/\r?\n/);
      ref.current = parts.pop() ?? '';
      for (const text of parts) {
        if (text.length === 0) continue;
        pushLine({ level: classify(channel, text), text });
      }
    },
    [pushLine],
  );

  const flush = useCallback(() => {
    for (const channel of ['stdout', 'stderr'] as const) {
      const ref = channel === 'stdout' ? stdoutBuf : stderrBuf;
      if (ref.current) {
        pushLine({ level: classify(channel, ref.current), text: ref.current });
        ref.current = '';
      }
    }
  }, [pushLine]);

  const handleEvent = useCallback(
    (e: GodotStreamEvent) => {
      if (e.type === 'stdout') {
        ingest('stdout', e.data.chunk);
      } else if (e.type === 'stderr') {
        ingest('stderr', e.data.chunk);
      } else if (e.type === 'start') {
        const argLine = (e.data.args ?? []).join(' ');
        pushLine({
          level: 'system',
          text: `Godot started — ${e.data.bin ?? ''} ${argLine}`.trim(),
        });
      } else if (e.type === 'error') {
        pushLine({ level: 'error', text: e.data.message ?? 'unknown error' });
      } else if (e.type === 'end') {
        flush();
        pushLine({
          level: e.data.status === 'succeeded' ? 'system' : 'error',
          text: `Godot ${e.data.status} (code=${e.data.code ?? '—'})`,
        });
        setRunning(false);
        setRunId(null);
      }
    },
    [ingest, flush, pushLine],
  );

  const attach = useCallback(
    (id: string) => {
      unsubRef.current?.();
      setRunId(id);
      setRunning(true);
      unsubRef.current = subscribeGodotRun(id, handleEvent);
    },
    [handleEvent],
  );

  // Detect Godot on mount.
  useEffect(() => {
    let cancelled = false;
    setDetecting(true);
    detectGodot()
      .then((r) => !cancelled && setGodot(r))
      .catch(() => !cancelled && setGodot({ available: false }))
      .finally(() => !cancelled && setDetecting(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Reconnect to an active run for this project on mount / project change.
  useEffect(() => {
    let cancelled = false;
    fetchActiveGodotRun(projectPath)
      .then((r) => {
        if (!cancelled && r.runId) attach(r.runId);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, attach]);

  // Close the SSE on unmount.
  useEffect(
    () => () => {
      unsubRef.current?.();
      unsubRef.current = null;
    },
    [],
  );

  // Auto-scroll to the bottom as lines arrive.
  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const play = useCallback(async () => {
    if (!godot?.available || running || !projectPath) return;
    setLines([]);
    lineCounter.current = 0;
    stdoutBuf.current = '';
    stderrBuf.current = '';
    try {
      const r = await startGodot({ projectPath });
      attach(r.runId);
    } catch (err) {
      pushLine({
        level: 'error',
        text: `Could not start: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [godot, running, projectPath, attach, pushLine]);

  const stop = useCallback(async () => {
    if (runId) await stopGodot(runId);
  }, [runId]);

  const version = useMemo(
    () => godot?.version?.split('.').slice(0, 3).join('.'),
    [godot],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <Gamepad2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Play</span>
          <Badge variant="secondary" className="font-normal">
            godot
          </Badge>
          {godot?.available && version && (
            <span className="text-xs text-muted-foreground" title={godot.path}>
              {version}
            </span>
          )}
          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  setLines([]);
                  lineCounter.current = 0;
                }}
                disabled={lines.length === 0}
              >
                <Trash2 />
                <span className="sr-only">Clear output</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear output</TooltipContent>
          </Tooltip>

          {running ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => void stop()}
            >
              <Square />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={detecting || !godot?.available}
              onClick={() => void play()}
            >
              <Play />
              Play
            </Button>
          )}
        </div>

        {/* Stage */}
        {detecting ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6 text-sm text-muted-foreground">
            Detecting Godot…
          </div>
        ) : !godot?.available ? (
          <GodotNotFound
            onRecheck={() => {
              setDetecting(true);
              detectGodot()
                .then(setGodot)
                .catch(() => setGodot({ available: false }))
                .finally(() => setDetecting(false));
            }}
          />
        ) : lines.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6 text-sm text-muted-foreground">
            {running ? 'Waiting for output…' : 'Press Play to launch Godot.'}
          </div>
        ) : (
          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3 font-mono text-xs leading-relaxed"
          >
            {lines.map((l) => (
              <div
                key={l.id}
                className={cn(
                  'whitespace-pre-wrap break-words',
                  l.level === 'error' && 'text-destructive',
                  l.level === 'warning' && 'text-amber-500',
                  l.level === 'system' && 'italic text-muted-foreground',
                )}
              >
                {l.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Empty state when no Godot binary is detected on the daemon host. */
function GodotNotFound({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed bg-card/50 p-6 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Gamepad2 className="size-5" />
        </span>
        <div className="text-sm font-medium">Godot binary not detected</div>
        <p className="text-sm text-muted-foreground">
          The daemon looked on PATH and common install locations. Set the{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">OGF_GODOT</code>{' '}
          environment variable to your Godot executable, or add Godot to your{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">PATH</code>, then
          restart the daemon.
        </p>
        <Button variant="ghost" size="sm" onClick={onRecheck}>
          <RotateCw />
          Re-check
        </Button>
      </div>
    </div>
  );
}
