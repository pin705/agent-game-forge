import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Gamepad2 } from "lucide-react";
import { resolvePublishedProject } from "@/lib/publish/core";
import { Button } from "@/components/ui/button";
import { RemixButton } from "@/components/remix-button";

export const dynamic = "force-dynamic";

/**
 * Thin PUBLIC share wrapper (SAAS_ARCHITECTURE §8 P4 — "share a link; others
 * play + remix"). The raw game is served at `/play/<slug>`; this is an optional
 * sharable landing: it embeds the game in an iframe and offers a one-click
 * "Remix this game" (deep-links remix → editor for authed users; bounces to
 * login otherwise). Minimal + on-brand.
 */
export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await resolvePublishedProject(slug);
  if (!project) notFound();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Gamepad2 className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
            <p className="truncate text-xs text-muted-foreground">Made with the Game Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <a href={`/play/${slug}/`} target="_blank" rel="noreferrer">
              <ExternalLink />
              Fullscreen
            </a>
          </Button>
          <RemixButton srcRef={slug} variant="default" label="Remix this game" />
        </div>
      </header>

      {/* The published game, served from storage at /play/<slug>. */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <iframe
          src={`/play/${slug}/`}
          title={project.name}
          className="block h-[70svh] w-full"
          // Sandbox the embedded game: allow it to run scripts + same-origin (it
          // IS our origin) but nothing escalatory.
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        />
      </div>

      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Like it? Remix it and make it your own.</span>
        <Link href="/" className="underline-offset-4 hover:underline">
          Build your own game
        </Link>
      </footer>
    </main>
  );
}
