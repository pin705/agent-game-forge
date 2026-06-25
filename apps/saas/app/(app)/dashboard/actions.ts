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

/** Derive a short, readable project name from the idea prompt (studio parity:
 *  first ~4 words). Falls back to a sensible default for an empty idea. */
function nameFromIdea(idea: string): string {
  const trimmed = idea.trim();
  if (!trimmed) return "Untitled game";
  const words = trimmed.split(/\s+/).slice(0, 4).join(" ");
  return words.slice(0, 60);
}

/**
 * Creates a new project for the current user and redirects into its builder
 * with the idea attached as `?idea=` so the build Chat auto-sends it once.
 *
 *   • prod      → insert a `projects` row (RLS-scoped), R2 prefix = projects/<id>.
 *   • local-dev → create a record in the on-disk projects registry (no Supabase),
 *     so the "New game" → build loop works with ZERO accounts. Files for that
 *     id land under projects/<id>/ in LocalStorage exactly as in prod.
 *
 * The form field is `idea` (the dashboard hero textarea / a genre chip). The
 * project name is derived from the idea (studio behaviour); the idea itself is
 * carried to the builder via the redirect query so the first chat turn fires.
 */
export async function createProject(formData: FormData) {
  // Accept the new `idea` field; fall back to the legacy `name` field so any
  // older caller / the bare form still works.
  const idea = String(formData.get("idea") ?? formData.get("name") ?? "").trim();
  const name = nameFromIdea(idea);
  const ideaQuery = idea ? `?idea=${encodeURIComponent(idea)}` : "";

  const user = await getSessionUser();
  if (!user) redirect("/login");

  // ⚠️ LOCAL-DEV PROJECT CREATE — registry-backed; unreachable in prod.
  if (isLocalDev()) {
    const rec = await projects.createProject({ userId: user.id, name });
    revalidatePath("/dashboard");
    redirect(`/build/${rec.id}${ideaQuery}`);
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
  redirect(`/build/${data.id}${ideaQuery}`);
}

/**
 * Rename a project the current user owns. Works in both local-dev (registry)
 * and prod (Supabase; the WHERE user_id clause + RLS scope it to the owner).
 */
export async function renameProject(id: string, rawName: string) {
  const name = rawName.trim();
  if (!name) return;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (isLocalDev()) {
    await projects.renameProject({ userId: user.id, id, name });
    revalidatePath("/dashboard");
    return;
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.from("projects").update({ name }).eq("id", id).eq("user_id", user.id);
  revalidatePath("/dashboard");
}

/**
 * Delete a project the current user owns. Works in both local-dev (registry)
 * and prod (Supabase; owner-scoped). The build files remain in storage but the
 * project disappears from the dashboard — matching studio's remove behaviour.
 */
export async function deleteProject(id: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (isLocalDev()) {
    await projects.deleteProject({ userId: user.id, id });
    revalidatePath("/dashboard");
    return;
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/dashboard");
}
