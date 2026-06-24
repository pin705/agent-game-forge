"use client";

import { useCallback, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Rocket,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

type PublishState = {
  isPublished: boolean;
  url: string | null;
  playCount: number;
};

/**
 * Publish control for the builder header (SAAS_ARCHITECTURE §8 P4). Publishes a
 * project to a public `/play/<slug>` URL, shows the share link + copy + open +
 * play-count, and can unpublish. On-brand: reuses Button/DropdownMenu + the warm
 * theme; matches the copy-to-clipboard affordance from the top-up panel.
 *
 * Initial state is rendered server-side and passed in, so the button reflects
 * publish status on first paint without a client round-trip.
 */
export function PublishButton({
  projectId,
  initial,
}: {
  projectId: string;
  initial: PublishState;
}) {
  const [state, setState] = useState<PublishState>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const publish = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't publish.");
        return;
      }
      setState({ isPublished: true, url: data.url, playCount: data.playCount ?? 0 });
      toast.success("Published — your game has a public link.");
    } catch {
      toast.error("Network error while publishing.");
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const unpublish = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't unpublish.");
        return;
      }
      setState((s) => ({ ...s, isPublished: false }));
      toast.success("Unpublished — the link is now private.");
    } catch {
      toast.error("Network error while unpublishing.");
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const copy = useCallback(() => {
    if (!state.url) return;
    void navigator.clipboard?.writeText(state.url).then(() => {
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 1500);
    });
  }, [state.url]);

  // ── Not published: a single Publish button ──
  if (!state.isPublished) {
    return (
      <Button size="sm" onClick={publish} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
        Publish
      </Button>
    );
  }

  // ── Published: a "Shared" dropdown with link / copy / open / count / unpublish ──
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Globe className="text-success" />
          Shared
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Share2 className="size-4 text-muted-foreground" />
          Public link
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Anyone with this link can play your game.
        </p>

        <div className="mt-2 flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{state.url}</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={copy}
            aria-label="Copy link"
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button asChild size="sm" variant="secondary" className="flex-1">
            <a href={state.url ?? "#"} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open
            </a>
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
            {state.playCount} {state.playCount === 1 ? "play" : "plays"}
          </span>
        </div>

        <Separator className="my-3" />

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground hover:text-destructive"
          onClick={unpublish}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          Unpublish
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
