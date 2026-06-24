"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser, isLocalDev } from "@/lib/auth/current-user";
import * as projects from "@/lib/projects/registry";

/** Lowercase, hyphenated, ascii slug with a short random suffix for uniqueness. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "game"}-${suffix}`;
}

/**
 * Creates a new project for the current user and redirects into its builder.
 *
 *   • prod      → insert a `projects` row (RLS-scoped), R2 prefix = projects/<id>.
 *   • local-dev → create a record in the on-disk projects registry (no Supabase),
 *     so the "New game" → build loop works with ZERO accounts. Files for that
 *     id land under projects/<id>/ in LocalStorage exactly as in prod.
 */
export async function createProject(formData: FormData) {
  const rawName = String(formData.get("name") ?? "").trim();
  const name = rawName || "Untitled game";

  const user = await getSessionUser();
  if (!user) redirect("/login");

  // ⚠️ LOCAL-DEV PROJECT CREATE — registry-backed; unreachable in prod.
  if (isLocalDev()) {
    const rec = await projects.createProject({ userId: user.id, name });
    revalidatePath("/dashboard");
    redirect(`/build/${rec.id}`);
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const slug = slugify(name);

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name,
      slug,
      engine: "canvas",
      // r2_prefix is finalised with the row id below; seed with the slug so the
      // column is never null even before we know the id.
      r2_prefix: `projects/${slug}`,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Surface failure on the dashboard rather than crashing the action.
    redirect(`/dashboard?error=${encodeURIComponent(error?.message ?? "create_failed")}`);
  }

  // Now that we have the canonical id, lock the R2 prefix to projects/<id>.
  await supabase
    .from("projects")
    .update({ r2_prefix: `projects/${data.id}` })
    .eq("id", data.id);

  revalidatePath("/dashboard");
  redirect(`/build/${data.id}`);
}
