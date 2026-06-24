import { NextRequest } from "next/server";
import { serveProjectFile, recordPlay } from "@/lib/publish/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public play page — serves a PUBLISHED game's files straight from storage.
 *
 * GET /play/<slug>                 → index.html (the game entry point)
 * GET /play/<slug>/game.js         → game.js
 * GET /play/<slug>/assets/foo.png  → that asset
 * GET /play/<slug>/data/level.json → that data file
 *
 * No auth — this is the share URL. The ENTIRE game is served from one slug
 * namespace so relative URLs inside the game ("game.js", "assets/foo.png",
 * "data/level.json") just work. The play count is bumped once per index load
 * (no path / index.html), never per asset.
 *
 * Robustness: the requested path is sanitized before it reaches storage (no
 * `..` traversal — see lib/publish/content-type.ts), and the storage adapter
 * only ever reads under the project's own prefix. 404 when the project isn't
 * published or the file is missing.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await ctx.params;
  // The gallery embeds each game in a thumbnail iframe with `?preview=1`; those
  // loads must NOT inflate play_count (only real plays count).
  const isPreview = req.nextUrl.searchParams.get("preview") === "1";

  const result = await serveProjectFile(slug, path);

  if ("error" in result) {
    const status = result.error === "bad_path" ? 400 : 404;
    const message =
      result.error === "not_published"
        ? "This game isn't published."
        : result.error === "bad_path"
          ? "Bad path."
          : "Not found.";
    return new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Count one play per index/entry load (not per asset, not a gallery preview).
  // Best-effort + awaited so the registry write lands before we return (matters
  // for the test); it never throws.
  if (result.isIndex && !isPreview) {
    await recordPlay(slug);
  }

  // HTML is dynamic (publish state can change); static assets cache briefly.
  const cacheControl = result.isIndex
    ? "no-cache"
    : "public, max-age=300, stale-while-revalidate=86400";

  // Copy into a fresh ArrayBuffer-backed Uint8Array — an unambiguous BodyInit.
  // (A Node Buffer / a Buffer.subarray view is typed over `ArrayBufferLike`,
  // which includes SharedArrayBuffer and so isn't assignable to BodyInit under
  // the DOM lib typing. The explicit slice yields a plain ArrayBuffer.) The copy
  // also detaches from any pooled backing buffer, so we never over-read.
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
      // Lock down framing/sniffing for the public game surface.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
