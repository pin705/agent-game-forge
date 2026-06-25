"use client";

import { useEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live game thumbnail for a project card. Renders a sandboxed,
 * `pointer-events-none` iframe of the project's DRAFT preview entry
 * (/build/<id>/preview/) so the card shows the actual in-progress game. The
 * preview route returns plain-text 404 copy ("No game yet…") when nothing has
 * been built — we probe that route first and only mount the iframe when an
 * HTML index is actually being served, otherwise we show the gradient +
 * gamepad placeholder (studio's GameCover fallback).
 */
export function GameCover({ projectId, className }: { projectId: string; className?: string }) {
  const [state, setState] = useState<"loading" | "game" | "empty">("loading");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setState("loading");
    // HEAD-ish probe: a successful index is HTML; the no-game case is text/plain
    // with a 404. Use GET (HEAD isn't implemented on the route) and inspect.
    fetch(`/build/${projectId}/preview/`, { cache: "no-store" })
      .then((r) => {
        if (cancelled.current) return;
        const type = r.headers.get("content-type") ?? "";
        setState(r.ok && type.includes("text/html") ? "game" : "empty");
      })
      .catch(() => {
        if (!cancelled.current) setState("empty");
      });
    return () => {
      cancelled.current = true;
    };
  }, [projectId]);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/20 to-emerald-500/10",
        className,
      )}
    >
      {state === "game" ? (
        <iframe
          src={`/build/${projectId}/preview/`}
          title=""
          aria-hidden
          tabIndex={-1}
          sandbox="allow-scripts"
          // Scale a 1400px-ish viewport down into the card so the whole game is
          // visible as a static-looking thumbnail; pointer-events off → inert.
          className="pointer-events-none size-full select-none border-0 bg-background"
          loading="lazy"
        />
      ) : (
        <Gamepad2 className="size-8 text-primary/70" />
      )}
    </div>
  );
}
