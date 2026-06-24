import { NextRequest } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/** GET /api/projects/:id/files → { files: string[] } from storage. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!project) return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const files = await getStorage().listProjectFiles(id);
  return Response.json({ files: files.sort() });
}
