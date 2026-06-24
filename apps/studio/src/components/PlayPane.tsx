import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Gamepad2, Play, RotateCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { gameUrl, hasPlayableIndex } from '@/lib/play';
import { useT } from '@/lib/i18n';

interface Props {
  /** Absolute path of the web project, as registered with the OGF daemon. */
  projectPath: string;
}

/**
 * Live preview of a WEB-engine game.
 *
 * The OGF daemon serves the project root as static files under
 * `/api/web-play/<base64url(projectPath)>/` (reached via the Vite `/api`
 * proxy). We run the game by pointing an <iframe> at the served
 * `index.html`. See `@/lib/play`.
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

  const src = gameUrl(projectPath, reloadTick);

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

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

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
              className="aspect-video h-full w-full max-w-3xl rounded-xl bg-background shadow-md"
              sandbox="allow-scripts allow-same-origin allow-modals"
            />
          ) : hasIndex ? (
            <PlayStub onPlay={() => setRunning(true)} />
          ) : (
            <EmptyState probing={hasIndex === null} onRetry={reload} />
          )}
        </div>
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
