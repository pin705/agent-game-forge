import Link from "next/link";
import { ExternalLink, Gamepad2, Play, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listPublishedProjects } from "@/lib/publish/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RemixButton } from "@/components/remix-button";

// Public discovery surface — reads live publish state per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gallery — games built with Footage",
  description: "Play games the community built with AI, then remix one into your own.",
};

/** Best-effort auth probe — the gallery is PUBLIC, but authed users get a
 *  one-click Remix on each card. Never redirects; never throws. */
async function currentUserId(): Promise<string | null> {
  // Local-dev (no/placeholder Supabase): treat as signed-out, but the local
  // remix route still works without auth, so we show Remix anyway (see below).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.includes("placeholder")) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

export default async function GalleryPage() {
  const [projects, userId] = await Promise.all([listPublishedProjects(60), currentUserId()]);
  // Show Remix when signed in (prod) OR in local-dev (no auth needed there).
  const canRemix = userId !== null || !supabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <Sparkles className="size-3.5" />
            Gallery
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Games built with Footage</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Play what the community made with AI — then remix one into your own.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">
            <Gamepad2 />
            Build your own
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.projectId}>
              <Card className="group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
                {/* Live preview — the published game itself, served at /play/<slug>.
                    Pointer events are disabled so the whole tile reads as a link
                    target; "Play" opens the full game. */}
                <Link
                  href={`/play/${p.slug}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-[16/10] overflow-hidden border-b bg-muted/40"
                >
                  <iframe
                    src={`/play/${p.slug}/?preview=1`}
                    title={p.name}
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none h-full w-full"
                    sandbox="allow-scripts allow-same-origin"
                    loading="lazy"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-all group-hover:bg-foreground/10 group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm">
                      <Play className="size-3.5" />
                      Play
                    </span>
                  </span>
                </Link>

                {/* Meta + actions */}
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium leading-tight">{p.name}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      <Play className="size-3" />
                      {p.playCount.toLocaleString()} {p.playCount === 1 ? "play" : "plays"}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center gap-2">
                    <Button asChild size="sm" variant="secondary" className="flex-1">
                      <a href={`/play/${p.slug}/`} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        Play
                      </a>
                    </Button>
                    {canRemix && <RemixButton srcRef={p.slug} variant="outline" />}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Gamepad2 className="size-6" />
      </div>
      <div>
        <p className="font-medium">No published games yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Be the first — build a game and hit Publish to share it here.
        </p>
      </div>
      <Button asChild size="sm" className="mt-1">
        <Link href="/dashboard">
          <Sparkles />
          Build a game
        </Link>
      </Button>
    </Card>
  );
}
