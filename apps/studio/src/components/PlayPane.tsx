import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Gamepad2,
  Play,
  RotateCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { gameUrl, hasPlayableIndex } from '@/lib/play';
import { useT } from '@/lib/i18n';

interface Props {
  /** Absolute path of the web project, as registered with the OGF daemon. */
  projectPath: string;
}

/** A single captured console line from the running game. */
interface LogLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
  ts: number;
}

/** Cap scrollback so a chatty game (per-frame logging) can't grow state forever. */
const MAX_LOGS = 2000;

/** Best-effort stringify of a console argument for display. */
function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (a === undefined) return 'undefined';
  if (a === null) return 'null';
  try {
    return JSON.stringify(a);
  } catch {
    // Circular / non-serializable — fall back to coercion.
    return String(a);
  }
}

/**
 * Live preview of a WEB-engine game.
 *
 * The OGF daemon serves the project root as static files under
 * `/api/web-play/<base64url(projectPath)>/` (reached via the Vite `/api`
 * proxy). We run the game by pointing an <iframe> at the served
 * `index.html`. See `@/lib/play`.
 *
 * Because the iframe is served from the SAME ORIGIN as the studio and carries
 * `allow-same-origin`, the parent can reach into `iframe.contentWindow` once
 * it loads. We use that to mirror the game's `console.*` output and runtime
 * errors into a collapsible Console panel (see `hookConsole`).
 *
 * Like the original OGF PlayPane, we do NOT auto-run on mount: a live game
 * runs an animation loop / audio / network and would burn CPU while the Play
 * tab sits in the background. The user presses Play to start; the iframe
 * unmounts on Stop.
 */
export function PlayPane({ projectPath }: Props) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // null = still probing; true/false = whether index.html is served yet.
  const [hasIndex, setHasIndex] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // --- Console capture state ---
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is pinned to the bottom (auto-scroll). Flipped off when
  // they scroll up to read history, back on when they return to the bottom.
  const autoScrollRef = useRef(true);

  const src = gameUrl(projectPath, reloadTick);

  const pushLog = useCallback((level: LogLine['level'], text: string) => {
    setLogs((prev) => {
      const next = prev.concat({ id: logIdRef.current++, level, text, ts: Date.now() });
      // Trim from the front so newest stays visible.
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
  }, []);

  // Probe for a playable index.html on mount + whenever the project changes.
  // Re-probe is also triggered by the empty-state "Check again" button via
  // bumping `reloadTick` (cheap; the GET is no-store).
  useEffect(() => {
    let cancelled = false;
    setHasIndex(null);
    hasPlayableIndex(projectPath)
      .then((ok) => {
        if (!cancelled) setHasIndex(ok);
      })
      .catch(() => {
        if (!cancelled) setHasIndex(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, reloadTick]);

  // If the project switches while running, stop — the served URL just changed
  // and the new project should start from its Play button.
  useEffect(() => {
    setRunning(false);
  }, [projectPath]);

  // Clear captured logs whenever the game (re)starts or reloads. The fresh run
  // gets a clean slate; output from the previous run is no longer meaningful.
  useEffect(() => {
    if (running) {
      setLogs([]);
      logIdRef.current = 0;
      autoScrollRef.current = true;
    }
  }, [running, reloadTick]);

  // After Play, push focus into the iframe so the next keypress goes to the
  // game (jump / fire / Enter on a "press start" screen) instead of back to
  // the Play button. A short delay lets the iframe document attach.
  useEffect(() => {
    if (!running) return;
    const focusTimer = setTimeout(() => {
      const f = iframeRef.current;
      if (!f) return;
      try {
        f.focus();
        f.contentWindow?.focus();
      } catch {
        // cross-origin or detached frame — user can click into it
      }
    }, 80);
    return () => clearTimeout(focusTimer);
  }, [running, reloadTick]);

  // Auto-scroll the console to the newest line while the user is pinned to the
  // bottom.
  useEffect(() => {
    if (!consoleOpen || !autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, consoleOpen]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  /**
   * Mirror the iframe game's console + runtime errors into our `logs` state.
   *
   * Runs on the iframe's `load` event. The iframe is same-origin and carries
   * `allow-same-origin`, so `contentWindow` is reachable — but we still guard
   * every access in try/catch: a cross-origin redirect, a navigated-away frame,
   * or a teardown race must never throw into the Play pane. We patch the four
   * console methods (preserving the originals so the game's own devtools output
   * is unaffected) and attach `error` / `unhandledrejection` listeners.
   */
  const hookConsole = useCallback(() => {
    const win = iframeRef.current?.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return;
    try {
      const c = win.console;
      (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
        const original = c[level]?.bind(c);
        c[level] = (...args: unknown[]) => {
          try {
            pushLog(level, args.map(formatArg).join(' '));
          } catch {
            // Never let our mirror break the game's own logging.
          }
          original?.(...args);
        };
      });
    } catch {
      // console patch failed (cross-origin / timing) — errors below may still work.
    }

    try {
      win.addEventListener('error', (e: ErrorEvent) => {
        try {
          const where =
            e.filename || e.lineno
              ? ` (${(e.filename || '').split('/').pop() ?? ''}:${e.lineno}:${e.colno})`
              : '';
          const msg = e.error?.stack || e.message || 'Uncaught error';
          pushLog('error', `${msg}${where}`);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    try {
      win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        try {
          const r = e.reason;
          const text =
            r instanceof Error ? r.stack || `${r.name}: ${r.message}` : formatArg(r);
          pushLog('error', `Unhandled promise rejection: ${text}`);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }, [pushLog]);

  // Track whether the user is pinned to the bottom of the scrollback. Once they
  // scroll up, auto-scroll pauses until they return to the bottom.
  const onConsoleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    logIdRef.current = 0;
    autoScrollRef.current = true;
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-2 px-4 py-2">
          <Gamepad2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('play.play')}</span>
          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={consoleOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                onClick={() => setConsoleOpen((o) => !o)}
                aria-pressed={consoleOpen}
              >
                <Terminal />
                <span className="sr-only">{t('play.console')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('play.console')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={reload}
                disabled={!running}
              >
                <RotateCw />
                <span className="sr-only">{t('play.reload')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('play.reload')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => window.open(src, '_blank', 'noopener')}
                disabled={!hasIndex}
              >
                <ExternalLink />
                <span className="sr-only">{t('play.openNewTab')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('play.openNewTab')}</TooltipContent>
          </Tooltip>

          {running ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setRunning(false)}
            >
              <Square />
              {t('play.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!hasIndex}
              onClick={(e) => {
                setRunning(true);
                // Blur so a stray Enter after the click doesn't re-trigger
                // Play — focus moves to the iframe via the effect above.
                e.currentTarget.blur();
              }}
            >
              <Play />
              {t('play.play')}
            </Button>
          )}
        </div>

        {/* Stage */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6">
          {running ? (
            <iframe
              ref={iframeRef}
              key={reloadTick}
              src={src}
              title={t('play.preview')}
              onLoad={hookConsole}
              className="aspect-video h-full w-full max-w-3xl rounded-xl bg-background shadow-md"
              sandbox="allow-scripts allow-same-origin allow-modals"
            />
          ) : hasIndex ? (
            <PlayStub onPlay={() => setRunning(true)} />
          ) : (
            <EmptyState probing={hasIndex === null} onRetry={reload} />
          )}
        </div>

        {/* Console — only while a game is running (it's the source of output). */}
        {running && consoleOpen && (
          <div className="flex max-h-64 shrink-0 flex-col border-t bg-muted/30">
            <div className="flex items-center gap-2 px-4 py-1.5">
              <Terminal className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {t('play.console')}
              </span>
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={clearLogs}
                    disabled={logs.length === 0}
                  >
                    <Trash2 />
                    <span className="sr-only">{t('play.clearConsole')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('play.clearConsole')}</TooltipContent>
              </Tooltip>
            </div>
            <div
              ref={scrollRef}
              onScroll={onConsoleScroll}
              className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 font-mono text-xs leading-relaxed"
            >
              {logs.length === 0 ? (
                <p className="py-1 text-muted-foreground">{t('play.noLogs')}</p>
              ) : (
                logs.map((l) => (
                  <pre
                    key={l.id}
                    className={cn(
                      'whitespace-pre-wrap break-words py-0.5',
                      l.level === 'error' && 'text-destructive',
                      l.level === 'warn' && 'text-amber-600 dark:text-amber-500',
                      (l.level === 'log' || l.level === 'info') && 'text-muted-foreground',
                    )}
                  >
                    {l.text}
                  </pre>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Idle stage when a game IS built but not yet running. */
function PlayStub({ onPlay }: { onPlay: () => void }) {
  const t = useT();
  return (
    <div className="flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card/50">
      <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
        <Play className="size-5" />
      </span>
      <p className="text-sm text-muted-foreground">{t('play.press')}</p>
      <Button size="sm" onClick={onPlay}>
        <Play />
        {t('play.play')}
      </Button>
    </div>
  );
}

/** Tasteful empty state when there's no served index.html yet. */
function EmptyState({ probing, onRetry }: { probing: boolean; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Gamepad2 className="size-5" />
      </span>
      {probing ? (
        <p className="text-sm text-muted-foreground">{t('play.looking')}</p>
      ) : (
        <>
          <div className="text-sm font-medium">{t('play.empty.title')}</div>
          <p className="max-w-xs text-sm text-muted-foreground">
            {t('play.empty.body')}
          </p>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RotateCw />
            {t('play.checkAgain')}
          </Button>
        </>
      )}
    </div>
  );
}
