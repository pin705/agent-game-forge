import { NextRequest } from "next/server";
import { authorizeProject, serveDraftFile } from "@/lib/editor/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DRAFT preview — serves a project's CURRENT (unpublished) files straight from
 * storage so the live-preview iframe shows the in-progress game. This is the
 * editor twin of the public `/play/<slug>` route: same byte-accurate serving +
 * Content-Type logic, but addressed by project id and OWNER-ONLY.
 *
 *   GET /build/<id>/preview/                  → index.html (entry point)
 *   GET /build/<id>/preview/game.js           → game.js
 *   GET /build/<id>/preview/assets/foo.png    → that asset
 *
 * Serving the whole game under one path namespace means relative URLs inside
 * the game ("game.js", "assets/foo.png", "data/level.json") just resolve. The
 * requested path is sanitized before it reaches storage (no `..` traversal),
 * and the storage adapter only ever reads under the project's own prefix.
 *
 * Owner-only when Supabase is configured; open in local-dev. Never cached for
 * HTML (the draft changes on every build/save); static assets cache briefly.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id, path } = await ctx.params;

  const access = await authorizeProject(id);
  if (!access.ok) {
    return new Response(access.error === "unauthorized" ? "Unauthorized." : "Not found.", {
      status: access.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const result = await serveDraftFile(id, path);

  if ("error" in result) {
    const status = result.error === "bad_path" ? 400 : 404;
    const message =
      result.error === "bad_path" ? "Bad path." : "No game yet — build one in the chat.";
    return new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const cacheControl = result.isIndex
    ? "no-store"
    : "private, max-age=30, stale-while-revalidate=300";

  // Copy into a fresh ArrayBuffer-backed Uint8Array — an unambiguous BodyInit
  // (mirrors the /play route; avoids the ArrayBufferLike vs BodyInit typing).
  const ab = result.body.buffer.slice(
    result.body.byteOffset,
    result.body.byteOffset + result.body.byteLength,
  ) as ArrayBuffer;
  const bytes = new Uint8Array(ab);

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": cacheControl,
      "Content-Length": String(result.body.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
