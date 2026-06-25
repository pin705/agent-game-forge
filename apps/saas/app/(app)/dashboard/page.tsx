import { getSessionUser, isLocalDev } from "@/lib/auth/current-user";
import * as projectsRegistry from "@/lib/projects/registry";
import { DashboardCreate } from "@/components/dashboard-create";
import { DashboardGames, type DashboardProject } from "@/components/dashboard-games";
import { DashboardHeroText, DashboardGamesHeading } from "@/components/dashboard-hero-text";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  engine: string | null;
  updated_at: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  let rows: ProjectRow[] = [];
  let queryError: { message: string } | null = null;

  if (isLocalDev()) {
    // Local-dev: list from the on-disk projects registry (the dev user owns all).
    const user = await getSessionUser();
    const recs = user ? await projectsRegistry.listProjects(user.id) : [];
    rows = recs.map((r) => ({
      id: r.id,
      name: r.name,
      engine: r.engine,
      updated_at: new Date(r.updatedAt).toISOString(),
    }));
  } else {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    // RLS scopes this to the current user; ordered newest-first.
    const { data, error: qErr } = await supabase
      .from("projects")
      .select("id, name, engine, updated_at")
      .order("updated_at", { ascending: false, nullsFirst: false });
    rows = (data ?? []) as ProjectRow[];
    queryError = qErr;
  }

  const projects: DashboardProject[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    engine: r.engine || "canvas",
    updatedAtMs: r.updated_at ? Date.parse(r.updated_at) : null,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      {/* Hero — prompt-first creation (studio parity) */}
      <section className="flex flex-col items-center text-center">
        <DashboardHeroText />
        <DashboardCreate />
      </section>

      {(error || queryError) && (
        <p className="mx-auto mt-6 max-w-xl rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
          {error
            ? decodeURIComponent(error)
            : "Couldn't load projects yet — run the database migration (supabase/migrations/0001_init.sql)."}
        </p>
      )}

      {/* Games list */}
      <section className="mt-14">
        <DashboardGamesHeading />
        <DashboardGames projects={projects} />
      </section>
    </main>
  );
}
