import { NextRequest } from "next/server";
import { remixProject, supabaseConfigured, PublishError } from "@/lib/publish/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/projects/:id/remix — clone a published (or owned) project for the
 * current user. `:id` is the SOURCE project id OR slug. Creates a new project
 * (name "<orig> (remix)", remixed_from = source, NOT published) and copies all
 * the source's files via the storage adapter. Returns { projectId } so the UI
 * can open it in the editor.
 *
 * Auth: required in prod (the remix is owned by the signed-in user). In
 * local-dev (no Supabase) it runs without auth against the local registry so the
 * loop is verifiable with zero accounts.
 *
 * Guard: only a PUBLISHED source may be remixed, unless the source is owned by
 * the caller (own unpublished projects are remixable too).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: srcRef } = await ctx.params;

  let userId: string | undefined;
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    userId = user.id;
  }

  try {
    const result = await remixProject({ srcRef, userId, allowOwned: true });
    return Response.json({
      ok: true,
      projectId: result.projectId,
      name: result.name,
      slug: result.slug,
    });
  } catch (err) {
    if (err instanceof PublishError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "remix_failed" },
      { status: 500 },
    );
  }
}
