"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Gamepad2,
  Monitor,
  RotateCw,
  Smartphone,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface Props {
  projectId: string;
  /** Whether the project currently has a playable index.html (from the file list). */
  hasGame: boolean;
}

/** A single captured console line from the running game. */
interface LogLine {
  id: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

/** Cap scrollback so a chatty game (per-frame logging) can't grow state forever. */
const MAX_LOGS = 2000;

type Device = "desktop" | "mobile";

/** Best-effort stringify of a console argument for display. */
function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (a === undefined) return "undefined";
  if (a === null) return "null";
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/**
 * Live preview of the project's CURRENT (draft) game, ported from the studio's
 * PlayPane. The iframe is pointed at the owner-only draft route
 * (`/build/<id>/preview/`), which serves the project's in-progress files from
 * storage with correct Content-Types. Same-origin, so we mirror the game's
 * `console.*` + runtime errors into a collapsible Console panel.
 *
 * Reload bumps a cache-busting tick (and remounts the iframe). A device-width
 * toggle frames the stage at desktop vs. mobile.
 */
export function PlayPane({ projectId, hasGame }: Props) {
  const t = useT();
  const [reloadTick, setReloadTick] = useState(0);
  const [device, setDevice] = useState<Device>("desktop");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  // Point at index.html explicitly (not the bare dir): this avoids Next's
  // trailing-slash 308 AND fixes the iframe base URL so the game's RELATIVE
  // asset URLs ("src/game.js", "assets/foo.png") resolve under
  // /build/<id>/preview/ instead of /build/<id>/. The `?t=` busts the cache so
  // Reload always re-fetches the latest draft.
  const src = `/build/${projectId}/preview/index.html?t=${reloadTick}`;

  const pushLog = useCallback((level: LogLine["level"], text: string) => {
    setLogs((prev) => {
      const next = prev.concat({ id: logIdRef.current++, level, text });
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
  }, []);

  const reload = useCallback(() => {
    setLogs([]);
    logIdRef.current = 0;
    autoScrollRef.current = true;
    setReloadTick((n) => n + 1);
  }, []);

  // Auto-scroll the console to the newest line while pinned to the bottom.
  useEffect(() => {
    if (!consoleOpen || !autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, consoleOpen]);

  /** Mirror the iframe game's console + runtime errors into our `logs` state. */
  const hookConsole = useCallback(() => {
    const win = iframeRef.current?.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return;
    try {
      const c = win.console;
      (["log", "info", "warn", "error"] as const).forEach((level) => {
        const original = c[level]?.bind(c);
        c[level] = (...args: unknown[]) => {
          try {
            pushLog(level, args.map(formatArg).join(" "));
          } catch {
            /* never break the game's own logging */
          }
          original?.(...args);
        };
      });
    } catch {
      /* cross-origin / timing — errors below may still attach */
    }

    try {
      win.addEventListener("error", (e: ErrorEvent) => {
        try {
          const where =
            e.filename || e.lineno
              ? ` (${(e.filename || "").split("/").pop() ?? ""}:${e.lineno}:${e.colno})`
              : "";
          const msg = e.error?.stack || e.message || "Uncaught error";
          pushLog("error", `${msg}${where}`);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }

    try {
      win.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
        try {
          const r = e.reason;
          const text = r instanceof Error ? r.stack || `${r.name}: ${r.message}` : formatArg(r);
          pushLog("error", `Unhandled promise rejection: ${text}`);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  }, [pushLog]);

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
        <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
          <Gamepad2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("play.play")}</span>
          <div className="flex-1" />

          {/* Device-width toggle */}
          <div className="mr-1 flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  onClick={() => setDevice("desktop")}
                  aria-pressed={device === "desktop"}
                >
                  <Monitor />
                  <span className="sr-only">{t("play.device.desktop")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("play.device.desktop")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  onClick={() => setDevice("mobile")}
                  aria-pressed={device === "mobile"}
                >
                  <Smartphone />
                  <span className="sr-only">{t("play.device.mobile")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("play.device.mobile")}</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={consoleOpen ? "secondary" : "ghost"}
                size="icon"
                className="size-7"
                onClick={() => setConsoleOpen((o) => !o)}
                aria-pressed={consoleOpen}
              >
                <Terminal />
                <span className="sr-only">Console</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Console</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={reload}
                disabled={!hasGame}
              >
                <RotateCw />
                <span className="sr-only">{t("play.reload")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("play.reload")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => window.open(src, "_blank", "noopener")}
                disabled={!hasGame}
              >
                <ExternalLink />
                <span className="sr-only">{t("play.openNewTab")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("play.openNewTab")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Stage */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
          {hasGame ? (
            <iframe
              ref={iframeRef}
              key={reloadTick}
              src={src}
              title={t("play.preview")}
              onLoad={hookConsole}
              className={cn(
                "h-full rounded-xl border bg-background shadow-md",
                device === "mobile" ? "aspect-[9/16] w-auto max-w-[420px]" : "w-full",
              )}
              sandbox="allow-scripts allow-same-origin allow-modals allow-pointer-lock"
            />
          ) : (
            <EmptyState onRetry={reload} />
          )}
        </div>

        {/* Console — collapsible. */}
        {consoleOpen && (
          <div className="flex max-h-64 shrink-0 flex-col border-t bg-muted/30">
            <div className="flex items-center gap-2 px-4 py-1.5">
              <Terminal className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Console</span>
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
                    <span className="sr-only">{t("common.clear")}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.clear")}</TooltipContent>
              </Tooltip>
            </div>
            <div
              ref={scrollRef}
              onScroll={onConsoleScroll}
              className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 font-mono text-xs leading-relaxed"
            >
              {logs.length === 0 ? (
                <p className="py-1 text-muted-foreground">—</p>
              ) : (
                logs.map((l) => (
                  <pre
                    key={l.id}
                    className={cn(
                      "whitespace-pre-wrap break-words py-0.5",
                      l.level === "error" && "text-destructive",
                      l.level === "warn" && "text-amber-600 dark:text-amber-500",
                      (l.level === "log" || l.level === "info") && "text-muted-foreground",
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

/** Tasteful empty state when there's no draft index.html yet. */
function EmptyState({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 p-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Gamepad2 className="size-5" />
      </span>
      <div className="text-sm font-medium">{t("play.empty.title")}</div>
      <p className="max-w-xs text-sm text-muted-foreground">{t("play.empty.body")}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <RotateCw />
        {t("play.checkAgain")}
      </Button>
    </div>
  );
}
