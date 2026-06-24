import { NextRequest } from "next/server";
import { authorizeProject } from "@/lib/editor/access";
import { storeRefImage } from "@/lib/conversations/refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap on a single uploaded reference image (8 MB) — generous for sprites/refs. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upload a reference image into the project's storage prefix (Batch 2
 * attachments). Owner-only when Supabase is configured; open in local-dev.
 *
 *   POST /api/projects/:id/upload
 *     body: multipart/form-data with a `file` field
 *        OR JSON { filename, base64 }
 *   → { path: string, bytes: number }
 *
 * The returned project-relative `path` is passed back in the run's
 * `refImagePaths`, where runAgent surfaces it to the agent as context.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await authorizeProject(id);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

  let filename = "image";
  let bytes: Uint8Array | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "file_required" }, { status: 400 });
      }
      if (!file.type.startsWith("image/")) {
        return Response.json({ error: "not_an_image" }, { status: 400 });
      }
      filename = file.name || "image";
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await req.json()) as { filename?: unknown; base64?: unknown };
      if (typeof body.base64 !== "string") {
        return Response.json({ error: "base64_required" }, { status: 400 });
      }
      filename = typeof body.filename === "string" ? body.filename : "image";
      bytes = new Uint8Array(Buffer.from(body.base64, "base64"));
    }
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (!bytes || bytes.byteLength === 0) {
    return Response.json({ error: "empty_file" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "too_large", maxBytes: MAX_BYTES }, { status: 413 });
  }

  const path = await storeRefImage(id, filename, bytes);
  return Response.json({ path, bytes: bytes.byteLength });
}
