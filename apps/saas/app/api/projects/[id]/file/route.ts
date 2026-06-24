import { NextRequest } from "next/server";
import { getStorage } from "@/lib/storage";
import { authorizeProject, sanitizeFilePath } from "@/lib/editor/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single-file read/write for the code editor (CodePanel). Owner-only when
 * Supabase is configured; open in local-dev (same posture as the file-list
 * route). The path is sanitized against traversal before it reaches storage.
 *
 *   GET    /api/projects/:id/file?path=game.js → { path, content }  (text)
 *   PUT    /api/projects/:id/file              → { ok: true, bytes }
 *          body: { path, content }
 *   DELETE /api/projects/:id/file?path=…       → { ok: true }  (assets panel)
 *
 * Text-only by design: the editor edits text files. Binary files (png/jpg/…)
 * are surfaced as a non-editable notice in the UI and never POSTed here.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const path = sanitizeFilePath(req.nextUrl.searchParams.get("path"));
  if (path === null) return Response.json({ error: "bad_path" }, { status: 400 });

  const content = await getStorage().readProjectFileText(id, path);
  if (content === null) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json({ path, content });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  let payload: { path?: unknown; content?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const path = sanitizeFilePath(typeof payload.path === "string" ? payload.path : null);
  if (path === null) return Response.json({ error: "bad_path" }, { status: 400 });
  if (typeof payload.content !== "string") {
    return Response.json({ error: "content_required" }, { status: 400 });
  }

  const bytes = new TextEncoder().encode(payload.content);
  await getStorage().writeProjectFile(id, path, bytes);

  return Response.json({ ok: true, bytes: bytes.byteLength });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  const path = sanitizeFilePath(req.nextUrl.searchParams.get("path"));
  if (path === null) return Response.json({ error: "bad_path" }, { status: 400 });

  await getStorage().deleteProjectFile(id, path);

  return Response.json({ ok: true });
}
