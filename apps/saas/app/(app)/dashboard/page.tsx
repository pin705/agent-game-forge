import Link from "next/link";
import { ArrowRight, Gamepad2, Plus } from "lucide-react";
import { getSessionUser, isLocalDev } from "@/lib/auth/current-user";
import * as projectsRegistry from "@/lib/projects/registry";
import { createProject } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

type Project = {
  id: string;
  name: string;
  slug: string;
  updated_at: string | null;
  created_at: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  let projects: Project[] = [];
  let queryError: { message: string } | null = null;

  if (isLocalDev()) {
    // Local-dev: list from the on-disk projects registry (the dev user owns all).
    const user = await getSessionUser();
    const recs = user ? await projectsRegistry.listProjects(user.id) : [];
    projects = recs.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      updated_at: new Date(r.updatedAt).toISOString(),
      created_at: new Date(r.createdAt).toISOString(),
    }));
  } else {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    // RLS scopes this to the current user; ordered newest-first.
    const { data, error: qErr } = await supabase
      .from("projects")
      .select("id, name, slug, updated_at, created_at")
      .order("updated_at", { ascending: false, nullsFirst: false });
    projects = (data ?? []) as Project[];
    queryError = qErr;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your games</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new game or jump back into one you&apos;re building.
          </p>
        </div>
      </div>

      {/* Prompt box → creates a project, then redirects to its builder. */}
      <Card className="mb-8">
        <CardContent className="p-4">
          <form action={createProject} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              name="name"
              placeholder="Describe your game… e.g. “a cozy fishing roguelike”"
              className="h-10 flex-1 text-sm"
              aria-label="New game name or prompt"
            />
            <Button type="submit" size="lg" className="shrink-0">
              <Plus />
              New game
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Describe your game and we&apos;ll spin up a project — then build it with you in the editor.
          </p>
        </CardContent>
      </Card>

      {(error || queryError) && (
        <p className="mb-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error
            ? decodeURIComponent(error)
            : "Couldn't load projects yet — run the database migration (supabase/migrations/0001_init.sql)."}
        </p>
      )}

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Gamepad2 className="size-6" />
            </div>
            <div>
              <p className="font-medium">No games yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the box above to start your first game.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/build/${p.id}`} className="group block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">/{p.slug}</p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
