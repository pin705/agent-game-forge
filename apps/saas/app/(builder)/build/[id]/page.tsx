import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublishState, resolveSiteOrigin } from "@/lib/publish/core";
import { getSessionUser, isLocalDev } from "@/lib/auth/current-user";
import { DEV_CREDITS } from "@/lib/billing/credits";
import { BuildWorkspace } from "@/components/build-workspace";
import { BuilderHeader } from "@/components/builder-header";

export const dynamic = "force-dynamic";

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/** Best-effort request origin for building absolute play URLs (SSR). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let project: { name: string; slug: string } = { name: "Local project", slug: id };
  // Credits + account email for the single compact header (folds in the old
  // TopNav chrome). local-dev surfaces the standing dev balance.
  let credits: number | null = isLocalDev() ? DEV_CREDITS : null;

  const user = await getSessionUser();
  const email = user?.email ?? "account";

  if (supabaseConfigured()) {
    const supabase = await createClient();
    // RLS ensures a user can only load their own project.
    const { data } = await supabase
      .from("projects")
      .select("id, name, slug, engine, r2_prefix")
      .eq("id", id)
      .maybeSingle();
    if (!data) notFound();
    project = { name: data.name, slug: data.slug };

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits_balance")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) credits = profile.credits_balance as number;
    }
  } else {
    // Local-dev: read the project name/slug from the on-disk registry so the
    // builder header shows the real project. Unregistered ids (e.g. a remix)
    // still render via the "Local project" default above — the editor is open.
    const projectsRegistry = await import("@/lib/projects/registry");
    const rec = await projectsRegistry.getProject(id);
    if (rec) project = { name: rec.name, slug: rec.slug };
  }

  const origin = resolveSiteOrigin(await requestOrigin());
  const publishState = await getPublishState(id, origin);

  return (
    <div className="flex h-[calc(100svh-3rem)] flex-col">
      <BuilderHeader
        projectId={id}
        projectName={project.name}
        projectSlug={project.slug}
        email={email}
        credits={credits}
        publishInitial={{
          isPublished: publishState.isPublished,
          url: publishState.url,
          playCount: publishState.playCount,
        }}
      />

      <BuildWorkspace projectId={id} projectName={project.name} />
    </div>
  );
}
