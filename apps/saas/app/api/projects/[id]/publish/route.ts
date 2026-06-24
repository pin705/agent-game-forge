import { NextRequest } from "next/server";
import {
  publishProject,
  unpublishProject,
  resolveSiteOrigin,
  supabaseConfigured,
  PublishError,
} from "@/lib/publish/core";
import { exportToCloudflarePages } from "@/lib/publish/cf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify the caller owns `projectId` (prod only). Returns the project name on
 * success, or a Response to short-circuit. In local-dev (no Supabase) ownership
 * is not enforced — the flow operates on a simulated local project so it's
 * runnable with zero accounts.
 */
async function requireOwner(
  projectId: string,
): Promise<{ name: string } | { response: Response }> {
  if (!supabaseConfigured()) return { name: "Local game" };
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  // RLS scopes this to the owner; a non-owner simply gets no row → 404.
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return { response: Response.json({ error: "project_not_found" }, { status: 404 }) };
  return { name: (data.name as string) ?? "game" };
}

/**
 * POST /api/projects/:id/publish — publish (owner-only). Ensures a unique slug,
 * flips is_published, stamps published_at, sets published_url to the absolute
 * `/play/<slug>` URL. Optionally kicks the (gated) Cloudflare Pages export.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const owner = await requireOwner(id);
  if ("response" in owner) return owner.response;

  const origin = resolveSiteOrigin(req.nextUrl.origin);

  try {
    const result = await publishProject({ projectId: id, origin, fallbackName: owner.name });

    // OPTIONAL secondary path — no-op unless CLOUDFLARE_* creds are set.
    const cf = await exportToCloudflarePages(result.slug, id);

    return Response.json({
      ok: true,
      projectId: result.projectId,
      slug: result.slug,
      url: result.publishedUrl,
      playCount: result.playCount,
      isPublished: true,
      cloudflare: { exported: cf.exported, url: cf.url },
    });
  } catch (err) {
    if (err instanceof PublishError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "publish_failed" },
      { status: 500 },
    );
  }
}

/** DELETE /api/projects/:id/publish — unpublish (owner-only). Idempotent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const owner = await requireOwner(id);
  if ("response" in owner) return owner.response;

  await unpublishProject(id);
  return Response.json({ ok: true, isPublished: false });
}
