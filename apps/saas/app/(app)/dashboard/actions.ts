"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
 * Creates a new project row for the current user and redirects into its
 * builder. The R2 prefix is derived once here (files live under
 * projects/<id>/… in R2 — see SAAS_ARCHITECTURE.md §4).
 */
export async function createProject(formData: FormData) {
  const rawName = String(formData.get("name") ?? "").trim();
  const name = rawName || "Untitled game";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
